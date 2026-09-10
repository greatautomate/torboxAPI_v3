import type { FastifyInstance } from 'fastify';
import authRoutes from './auth.js';
import resourceRoutes from './resources.js';
import logRoutes from './logs.js';
import opsRoutes from './ops.js';

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => { req.surface = 'public'; req.skipLog = true; });
  await app.register(authRoutes);
  await app.register(resourceRoutes);
  await app.register(logRoutes);
  await app.register(opsRoutes);
}

export const okr = <T>(data: T) => ({ ok: true as const, data });
export function pageParams(q: any) { const page = Math.max(1, Number(q.page) || 1); const limit = Math.min(500, Math.max(1, Number(q.limit) || 50)); return { page, limit, skip: (page - 1) * limit }; }
export function dateRange(q: any) { const f: any = {}; if (q.from) f.$gte = new Date(q.from); if (q.to) f.$lte = new Date(q.to); return Object.keys(f).length ? f : undefined; }
export function httpError(status: number, error: string, message: string) { return Object.assign(new Error(message), { status, code: error }); }
