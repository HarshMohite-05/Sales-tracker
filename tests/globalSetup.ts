import { execSync } from 'node:child_process';
import { testDatabaseUrl } from './testDatabaseUrl';

// Before each test run: wipe the test database (never the real one, see testDatabaseUrl),
// load fresh sample data, and make sure every record in it links up correctly
export default function setup() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  execSync('npx prisma db push --force-reset --skip-generate', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
  execSync('npx tsx scripts/check-links.ts', { env, stdio: 'inherit' });
}
