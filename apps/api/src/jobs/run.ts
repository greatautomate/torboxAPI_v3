/** Entrypoint for the Render cron service: runs all due jobs once and exits. */
import { buildServices } from '../app.js';
import { JobRunner } from './index.js';

const force = process.argv.includes('--all') ? undefined : process.argv.find((a) => a.startsWith('--job='))?.slice(6);
const svc = await buildServices();
try {
  const runner = new JobRunner(svc);
  const r = force ? await runner.runDue(force) : await (process.argv.includes('--all') ? runAll(runner) : runner.runDue());
  console.log(JSON.stringify({ ok: true, ...r }));
} finally { await svc.db.close(); }
async function runAll(runner: JobRunner) { const { JOBS } = await import('./index.js'); const ran: string[] = []; for (const j of JOBS) ran.push(...(await runner.runDue(j.name)).ran); return { ran }; }
