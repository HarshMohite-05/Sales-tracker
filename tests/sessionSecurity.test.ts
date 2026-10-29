import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createSessionToken, verifySessionToken } from '@/lib/auth';
const user={id:'qa-user',email:'qa@example.test',name:'QA',role:'SALESPERSON' as const};
afterEach(()=>vi.unstubAllEnvs());
describe('Session cryptography and production configuration',()=>{
 it('accepts its signed session and rejects modified signatures',async()=>{
  vi.stubEnv('AUTH_SECRET','qa-test-only-secret-of-at-least-32-characters');
  const token=await createSessionToken(user);expect(await verifySessionToken(token)).toMatchObject(user);
  const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...user,role:'DIRECTOR'})).toString('base64url');
  expect(await verifySessionToken(parts.join('.'))).toBeNull();
 });
 it('rejects expired sessions',async()=>{
  const secret='qa-test-only-secret-of-at-least-32-characters';vi.stubEnv('AUTH_SECRET',secret);
  const expired=await new SignJWT(user).setProtectedHeader({alg:'HS256'}).setExpirationTime(Math.floor(Date.now()/1000)-1).sign(new TextEncoder().encode(secret));
  expect(await verifySessionToken(expired)).toBeNull();
 });
 it('refuses a known default production signing key',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('AUTH_SECRET','nirmaan-watertech-super-secure-jwt-auth-session-key-2026');
  await expect(createSessionToken(user)).rejects.toThrow('Configure a random AUTH_SECRET');
 });
});
