// Starts an in-memory MongoDB for local development (no Docker needed) and prints its URI. Keep it running.
process.env.MONGOMS_VERSION ??= '8.0.4'; process.env.MONGOMS_DISTRO ??= 'ubuntu-22.04';
const { MongoMemoryServer } = await import('mongodb-memory-server');
const m = await MongoMemoryServer.create({ instance: { port: Number(process.env.DEV_MONGO_PORT || 27017), dbName: 'torbox_gateway' } });
console.log(`[dev-mongo] MONGODB_URI=${m.getUri()}`);
process.on('SIGINT', async () => { await m.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);
