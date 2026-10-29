import { spawn } from 'node:child_process';
import { testDatabaseUrl } from '../tests/testDatabaseUrl';
const mode = process.argv[2] || 'dev';
const args = mode === 'build' ? ['build'] : [mode === 'production' ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3100'];
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...args], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testDatabaseUrl(), ENABLE_EMAIL_DISPATCH: 'false', AUTH_SECRET: 'qa-local-only-32-bytes-session-secret-2026', TZ: 'Asia/Kolkata' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
