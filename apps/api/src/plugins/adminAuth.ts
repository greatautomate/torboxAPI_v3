import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../db.js';
import { randomId, sha256 } from '../crypto.js';
import type { AdminCtx } from '../context.js';
import { clientIp } from './consumerAuth.js';

export const SESSION_COOKIE = 'tbg_admin';
export const SESSION_TTL_MS = 12 * 3600e3;
export type Role = 'owner' | 'admin' | 'viewer';
const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 };

export type AdminDoc = { _id: ObjectId; email: string; passwordHash: string; role: Role; totpSecretEnc: string | null; totpEnabled: boolean; mustChangePassword: boolean; disabled: boolean; lastLoginAt: Date | null; createdAt: Date; updatedAt: Date };
export type SessionDoc = { _id: ObjectId; adminId: ObjectId; tokenHash: string; ip: string; userAgent: string; createdAt: Date; expiresAt: Date; lastSeenAt: Date };

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin(minRole?: Role): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    createAdminSession(adminId: ObjectId, req: FastifyRequest, reply: FastifyReply): Promise<string>;
    destroyAdminSession(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

export function registerAdminAuth(app: FastifyInstance) {
  const svc = app.svc;
  const sessions = () => svc.db.col<SessionDoc>(COLLECTIONS.adminSessions);
  const admins = () => svc.db.col<AdminDoc>(COLLECTIONS.admins);

  app.decorate('createAdminSession', async function (adminId: ObjectId, req: FastifyRequest, reply: FastifyReply) {
    const token = randomId(48); const now = new Date();
    await sessions().insertOne({ _id: new ObjectId(), adminId, tokenHash: sha256(token), ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300), createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastSeenAt: now });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: svc.cfg.NODE_ENV === 'production', path: '/', maxAge: SESSION_TTL_MS / 1000, signed: true });
    return token;
  });
  app.decorate('destroyAdminSession', async function (req: FastifyRequest, reply: FastifyReply) {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) { const u = req.unsignCookie(raw); if (u.valid && u.value) await sessions().deleteOne({ tokenHash: sha256(u.value) }); }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });

  app.decorate('requireAdmin', function (minRole: Role = 'viewer') {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      const raw = req.cookies[SESSION_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      if (!unsigned?.valid || !unsigned.value) return reply.code(401).send({ ok: false, error: 'UNAUTHENTICATED', message: 'Please sign in.' });
      const sess = await sessions().findOne({ tokenHash: sha256(unsigned.value) });
      if (!sess || sess.expiresAt < new Date()) { reply.clearCookie(SESSION_COOKIE, { path: '/' }); return reply.code(401).send({ ok: false, error: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' }); }
      const admin = await admins().findOne({ _id: sess.adminId });
      if (!admin || admin.disabled) return reply.code(401).send({ ok: false, error: 'UNAUTHENTICATED', message: 'Account disabled.' });
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-tbg-csrf'] !== '1') return reply.code(403).send({ ok: false, error: 'CSRF', message: 'Missing x-tbg-csrf header.' });
      if (RANK[admin.role] < RANK[minRole]) return reply.code(403).send({ ok: false, error: 'FORBIDDEN', message: `This action requires the ${minRole} role.` });
      if (admin.role === 'viewer' && req.method !== 'GET' && req.method !== 'HEAD' && !req.url.startsWith('/admin/api/auth/')) return reply.code(403).send({ ok: false, error: 'FORBIDDEN', message: 'Viewers have read-only access.' });
      if (admin.mustChangePassword && !req.url.startsWith('/admin/api/auth/')) return reply.code(403).send({ ok: false, error: 'PASSWORD_CHANGE_REQUIRED', message: 'You must change your password first.' });
      req.admin = { id: admin._id.toHexString(), email: admin.email, role: admin.role, sessionId: sess._id.toHexString(), mustChangePassword: admin.mustChangePassword, totpEnabled: admin.totpEnabled } satisfies AdminCtx;
      if (Date.now() - sess.lastSeenAt.getTime() > 60_000) sessions().updateOne({ _id: sess._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    };
  });
}
