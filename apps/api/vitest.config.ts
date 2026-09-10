import { defineConfig } from 'vitest/config';
// mongodb-memory-server needs a binary that exists for this host; arm64 hosts have no debian12 build, so pin an Ubuntu one.
process.env.MONGOMS_VERSION ??= '8.0.4';
process.env.MONGOMS_DISTRO ??= 'ubuntu-22.04';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 60000, hookTimeout: 180000, fileParallelism: false } });
