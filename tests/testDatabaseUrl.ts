import { loadEnv } from 'vite';

/**
 * Tests run against their own database so they never touch CRM data.
 * Uses TEST_DATABASE_URL if set, otherwise DATABASE_URL with "_test" added to the database name.
 */
export function testDatabaseUrl(): string {
  const env = loadEnv('test', process.cwd(), '');
  const mainUrl = env.DATABASE_URL;
  if (!mainUrl) throw new Error('DATABASE_URL is not set');

  const url = new URL(env.TEST_DATABASE_URL || mainUrl);
  if (!env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;

  const testUrl = url.toString();
  if (testUrl === mainUrl || !url.pathname.endsWith('_test')) {
    throw new Error('Refusing to run tests: the test database must be separate and end in "_test"');
  }
  return testUrl;
}
