import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTorboxMock } from '../src/mock/torbox-mock.js';
import { loadConfig } from '../src/config.js';
import { bootstrap, buildApp, buildServices } from '../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { Services } from '../src/context.js';

export type TestEnv = { app: FastifyInstance; svc: Services; mock: ReturnType<typeof createTorboxMock>; mongo: MongoMemoryServer; stop: () => Promise<void> };

export async function startTestEnv(): Promise<TestEnv> {
  const mongo = await MongoMemoryServer.create();
  const mock = createTorboxMock({ keys: ['mock-torbox-key', 'second-key'] });
  const mockPort = await mock.listen();
  const cfg = loadConfig({
    NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), MONGODB_DB_NAME: 'tbg_test', MASTER_ENCRYPTION_KEY: 'test-master-key-test-master-key', SESSION_SECRET: 'test-session-secret-123456', PERMALINK_SIGNING_SECRET: 'permalink-secret-123456', WEBHOOK_INBOUND_SECRET: 'inbound-secret',
    ADMIN_BOOTSTRAP_EMAIL: 'owner@example.com', ADMIN_BOOTSTRAP_PASSWORD: 'bootstrap-password', TORBOX_API_KEY: 'mock-torbox-key', TORBOX_API_BASE: `http://127.0.0.1:${mockPort}`, PUBLIC_BASE_URL: 'http://gateway.test', LOG_LEVEL: 'silent', RUN_JOBS_IN_PROCESS: 'false',
  });
  const svc = await buildServices(cfg);
  const app = await buildApp(svc, { serveStatic: false, jobs: false });
  await bootstrap(svc, { info: () => {}, warn: () => {} });
  await app.ready();
  return { app, svc, mock, mongo, stop: async () => { await app.close(); await svc.db.close(); await mock.close(); await mongo.stop(); } };
}

/** Logs in as the bootstrap owner (completing the forced password change) and returns a cookie header. */
export async function adminLogin(env: TestEnv): Promise<string> {
  let res = await env.app.inject({ method: 'POST', url: '/admin/api/auth/login', payload: { email: 'owner@example.com', password: 'bootstrap-password' } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  let cookie = res.cookies.find((c) => c.name === 'tbg_admin')!;
  let hdr = `${cookie.name}=${cookie.value}`;
  const me = await env.app.inject({ method: 'GET', url: '/admin/api/auth/me', headers: { cookie: hdr } });
  if (JSON.parse(me.body).data.admin.mustChangePassword) {
    const ch = await env.app.inject({ method: 'POST', url: '/admin/api/auth/change-password', headers: { cookie: hdr, 'x-tbg-csrf': '1' }, payload: { currentPassword: 'bootstrap-password', newPassword: 'new-strong-password-1' } });
    if (ch.statusCode !== 200) throw new Error(`change pw failed: ${ch.body}`);
  }
  return hdr;
}
export const admin = (env: TestEnv, cookie: string) => ({
  get: (url: string) => env.app.inject({ method: 'GET', url, headers: { cookie } }),
  post: (url: string, payload?: any) => env.app.inject({ method: 'POST', url, headers: { cookie, 'x-tbg-csrf': '1' }, payload }),
  patch: (url: string, payload?: any) => env.app.inject({ method: 'PATCH', url, headers: { cookie, 'x-tbg-csrf': '1' }, payload }),
  del: (url: string, payload?: any) => env.app.inject({ method: 'DELETE', url, headers: { cookie, 'x-tbg-csrf': '1' }, payload }),
});
export async function createKey(env: TestEnv, cookie: string, overrides: any = {}) {
  const a = admin(env, cookie);
  const ups = JSON.parse((await a.get('/admin/api/upstreams')).body).data.items;
  const clients = JSON.parse((await a.get('/admin/api/clients')).body).data.items;
  const res = await a.post('/admin/api/keys', { name: 'test key', clientId: clients[0].id, upstreamAccountId: ups[0].id, scopes: ['general', 'torrents:read', 'torrents:write', 'usenet:read', 'usenet:write', 'webdl:read', 'webdl:write', 'downloads:link', 'stream', 'user:read', 'notifications:read', 'webhooks'], ...overrides });
  if (res.statusCode !== 201) throw new Error(`createKey failed: ${res.body}`);
  return JSON.parse(res.body).data as { key: any; secret: string };
}
