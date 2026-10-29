import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { testDatabaseUrl } from './tests/testDatabaseUrl';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    env: { DATABASE_URL: testDatabaseUrl() },
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
  },
});
