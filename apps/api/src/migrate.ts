/** Render preDeployCommand: connects to MongoDB and (re)creates indexes/TTLs. Idempotent. */
import { buildServices } from './app.js';
const svc = await buildServices();
try { const s = await svc.settings.get(true); await svc.db.ensureIndexes(s.retention); await svc.keys.ensureDefaultPolicy(); console.log('migrate: indexes ensured'); }
finally { await svc.db.close(); }
