import { loadConfig } from './config.js';
import { bootstrap, buildApp, buildServices } from './app.js';

const cfg = loadConfig();
const svc = await buildServices(cfg);
const app = await buildApp(svc);
await bootstrap(svc, app.log);
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info({ url: cfg.publicBaseUrl, upstream: cfg.TORBOX_API_BASE }, 'torbox-gateway ready');
const shutdown = async (sig: string) => { app.log.info({ sig }, 'shutting down'); try { await app.close(); await svc.db.close(); } finally { process.exit(0); } };
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT', () => shutdown('SIGINT'));
