import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../../db.js';
import { decrypt, encrypt, generateTotpSecret, hashPassword, otpauthUrl, verifyPassword, verifyTotp } from '../../crypto.js';
import type { AdminDoc, SessionDoc } from '../../plugins/adminAuth.js';
import { clientIp } from '../../plugins/consumerAuth.js';
import { okr, httpError } from './index.js';

export default async function authRoutes(app: FastifyInstance) {
  const svc = app.svc; const admins = () => svc.db.col<AdminDoc>(COLLECTIONS.admins); const sessions = () => svc.db.col<SessionDoc>(COLLECTIONS.adminSessions);
  const dto = (a: AdminDoc) => ({ id: a._id.toHexString(), email: a.email, role: a.role, totpEnabled: a.totpEnabled, mustChangePassword: a.mustChangePassword, disabled: a.disabled, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt });

  app.post('/auth/login', async (req, reply) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional() }).parse(req.body || {});
    const ip = clientIp(req); const subject = `login:${ip}:${b.email.toLowerCase()}`;
    const lock = await svc.limiter.peek(subject, 'hour', 10);
    if (!lock.allowed) return reply.code(429).send({ ok: false, error: 'LOCKED', message: 'Too many failed attempts. Try again later.' });
    const admin = await admins().findOne({ email: b.email.toLowerCase() });
    if (!admin || admin.disabled || !verifyPassword(b.password, admin.passwordHash)) { await svc.limiter.consume(subject, 'hour', 10); await svc.audit.record({ adminId: admin?._id.toHexString() ?? null, adminEmail: b.email, action: 'auth.login_failed', ip }); return reply.code(401).send({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }); }
    if (admin.totpEnabled) {
      if (!b.totp) return reply.code(401).send({ ok: false, error: 'TOTP_REQUIRED', message: 'Enter your 6-digit authenticator code.' });
      if (!verifyTotp(decrypt(svc.cfg.MASTER_ENCRYPTION_KEY, admin.totpSecretEnc!), b.totp)) { await svc.limiter.consume(subject, 'hour', 10); return reply.code(401).send({ ok: false, error: 'TOTP_INVALID', message: 'Invalid authenticator code.' }); }
    }
    await app.createAdminSession(admin._id, req, reply);
    await admins().updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });
    await svc.audit.record({ adminId: admin._id.toHexString(), adminEmail: admin.email, action: 'auth.login', ip });
    return okr({ admin: dto(admin) });
  });
  app.post('/auth/logout', async (req, reply) => { await app.destroyAdminSession(req, reply); return okr(null); });
  app.get('/auth/me', { preHandler: app.requireAdmin() }, async (req) => { const a = await admins().findOne({ _id: new ObjectId(req.admin!.id) }); return okr({ admin: dto(a!) }); });
  app.post('/auth/change-password', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const b = z.object({ currentPassword: z.string(), newPassword: z.string().min(10, 'Use at least 10 characters') }).parse(req.body || {});
    const a = await admins().findOne({ _id: new ObjectId(req.admin!.id) });
    if (!a || !verifyPassword(b.currentPassword, a.passwordHash)) return reply.code(400).send({ ok: false, error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
    if (b.currentPassword === b.newPassword) return reply.code(400).send({ ok: false, error: 'SAME_PASSWORD', message: 'Choose a different password.' });
    await admins().updateOne({ _id: a._id }, { $set: { passwordHash: hashPassword(b.newPassword), mustChangePassword: false, updatedAt: new Date() } });
    await sessions().deleteMany({ adminId: a._id, _id: { $ne: new ObjectId(req.admin!.sessionId) } });
    await svc.audit.record({ adminId: a._id.toHexString(), adminEmail: a.email, action: 'auth.change_password', ip: clientIp(req) });
    return okr(null);
  });
  app.post('/auth/totp/setup', { preHandler: app.requireAdmin() }, async (req) => {
    const secret = generateTotpSecret(); const s = await svc.settings.get();
    await admins().updateOne({ _id: new ObjectId(req.admin!.id) }, { $set: { pendingTotpSecretEnc: encrypt(svc.cfg.MASTER_ENCRYPTION_KEY, secret) } as any });
    return okr({ secret, otpauthUrl: otpauthUrl(s.branding.name || 'TorBox Gateway', req.admin!.email, secret) });
  });
  app.post('/auth/totp/enable', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const b = z.object({ code: z.string().min(6) }).parse(req.body || {});
    const a: any = await admins().findOne({ _id: new ObjectId(req.admin!.id) });
    if (!a?.pendingTotpSecretEnc) return reply.code(400).send({ ok: false, error: 'NO_SETUP', message: 'Start the setup first.' });
    if (!verifyTotp(decrypt(svc.cfg.MASTER_ENCRYPTION_KEY, a.pendingTotpSecretEnc), b.code)) return reply.code(400).send({ ok: false, error: 'TOTP_INVALID', message: 'Invalid code. Check your authenticator time.' });
    await admins().updateOne({ _id: a._id }, { $set: { totpSecretEnc: a.pendingTotpSecretEnc, totpEnabled: true, updatedAt: new Date() }, $unset: { pendingTotpSecretEnc: '' } });
    await svc.audit.record({ adminId: a._id.toHexString(), adminEmail: a.email, action: 'auth.totp_enabled', ip: clientIp(req) });
    return okr(null);
  });
  app.post('/auth/totp/disable', { preHandler: app.requireAdmin() }, async (req, reply) => {
    const b = z.object({ code: z.string().min(6) }).parse(req.body || {});
    const a = await admins().findOne({ _id: new ObjectId(req.admin!.id) });
    if (!a?.totpEnabled || !verifyTotp(decrypt(svc.cfg.MASTER_ENCRYPTION_KEY, a.totpSecretEnc!), b.code)) return reply.code(400).send({ ok: false, error: 'TOTP_INVALID', message: 'Invalid code.' });
    await admins().updateOne({ _id: a._id }, { $set: { totpSecretEnc: null, totpEnabled: false, updatedAt: new Date() } });
    await svc.audit.record({ adminId: a._id.toHexString(), adminEmail: a.email, action: 'auth.totp_disabled', ip: clientIp(req) });
    return okr(null);
  });
  app.get('/auth/sessions', { preHandler: app.requireAdmin() }, async (req) => { const items = await sessions().find({ adminId: new ObjectId(req.admin!.id) }).sort({ createdAt: -1 }).toArray(); return okr({ items: items.map((s) => ({ id: s._id.toHexString(), ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, expiresAt: s.expiresAt, lastSeenAt: s.lastSeenAt, current: s._id.toHexString() === req.admin!.sessionId })) }); });
  app.delete('/auth/sessions/:id', { preHandler: app.requireAdmin() }, async (req) => { await sessions().deleteOne({ _id: new ObjectId((req.params as any).id), adminId: new ObjectId(req.admin!.id) }); return okr(null); });

  // ---- admin user management (owner) ----
  app.get('/admins', { preHandler: app.requireAdmin('admin') }, async () => okr({ items: (await admins().find({}).sort({ createdAt: 1 }).toArray()).map(dto) }));
  app.post('/admins', { preHandler: app.requireAdmin('owner') }, async (req, reply) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(10), role: z.enum(['owner', 'admin', 'viewer']) }).parse(req.body || {});
    if (await admins().findOne({ email: b.email.toLowerCase() })) return reply.code(409).send({ ok: false, error: 'DUPLICATE', message: 'An admin with this email exists.' });
    const now = new Date(); const doc: AdminDoc = { _id: new ObjectId(), email: b.email.toLowerCase(), passwordHash: hashPassword(b.password), role: b.role, totpSecretEnc: null, totpEnabled: false, mustChangePassword: true, disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now };
    await admins().insertOne(doc); await svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action: 'admins.create', target: doc.email, after: { role: b.role }, ip: clientIp(req) });
    return reply.code(201).send(okr(dto(doc)));
  });
  app.patch('/admins/:id', { preHandler: app.requireAdmin('owner') }, async (req, reply) => {
    const b = z.object({ role: z.enum(['owner', 'admin', 'viewer']).optional(), disabled: z.boolean().optional() }).parse(req.body || {});
    const id = new ObjectId((req.params as any).id); if (id.toHexString() === req.admin!.id && (b.disabled || (b.role && b.role !== 'owner'))) return reply.code(400).send({ ok: false, error: 'SELF', message: 'You cannot demote or disable yourself.' });
    const before = await admins().findOne({ _id: id }); if (!before) throw httpError(404, 'NOT_FOUND', 'Admin not found');
    await admins().updateOne({ _id: id }, { $set: { ...b, updatedAt: new Date() } }); if (b.disabled) await sessions().deleteMany({ adminId: id });
    await svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action: 'admins.update', target: before.email, before: { role: before.role, disabled: before.disabled }, after: b, ip: clientIp(req) });
    return okr(dto((await admins().findOne({ _id: id }))!));
  });
  app.delete('/admins/:id', { preHandler: app.requireAdmin('owner') }, async (req, reply) => {
    const id = new ObjectId((req.params as any).id); if (id.toHexString() === req.admin!.id) return reply.code(400).send({ ok: false, error: 'SELF', message: 'You cannot delete yourself.' });
    const a = await admins().findOne({ _id: id }); if (!a) throw httpError(404, 'NOT_FOUND', 'Admin not found');
    await admins().deleteOne({ _id: id }); await sessions().deleteMany({ adminId: id });
    await svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action: 'admins.delete', target: a.email, ip: clientIp(req) }); return okr(null);
  });
  app.post('/admins/:id/reset-totp', { preHandler: app.requireAdmin('owner') }, async (req) => { const id = new ObjectId((req.params as any).id); await admins().updateOne({ _id: id }, { $set: { totpSecretEnc: null, totpEnabled: false } }); await svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action: 'admins.reset_totp', target: id.toHexString(), ip: clientIp(req) }); return okr(null); });
  app.post('/admins/:id/reset-password', { preHandler: app.requireAdmin('owner') }, async (req) => { const b = z.object({ password: z.string().min(10) }).parse(req.body || {}); const id = new ObjectId((req.params as any).id); await admins().updateOne({ _id: id }, { $set: { passwordHash: hashPassword(b.password), mustChangePassword: true } }); await sessions().deleteMany({ adminId: id }); await svc.audit.record({ adminId: req.admin!.id, adminEmail: req.admin!.email, action: 'admins.reset_password', target: id.toHexString(), ip: clientIp(req) }); return okr(null); });
}
