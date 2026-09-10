import { cpSync, existsSync, mkdirSync } from 'node:fs';
mkdirSync('dist/torbox', { recursive: true });
cpSync('src/torbox/openapi.json', 'dist/torbox/openapi.json');
if (existsSync('src/mock/fixtures.json')) { mkdirSync('dist/mock', { recursive: true }); cpSync('src/mock/fixtures.json', 'dist/mock/fixtures.json'); }
