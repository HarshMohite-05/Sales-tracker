import { describe, expect, it } from 'vitest';
import { passwordError } from '@/lib/passwordPolicy';

describe('Password input boundaries', () => {
  it('requires a string and at least eight characters', () => {
    for (const value of [null, undefined, 12345678, '', '1234567']) expect(passwordError(value)).not.toBeNull();
    expect(passwordError('12345678')).toBeNull();
  });
  it('rejects data bcrypt would silently truncate, including multi-byte characters', () => {
    expect(passwordError('a'.repeat(72))).toBeNull();
    expect(passwordError('a'.repeat(73))).not.toBeNull();
    expect(passwordError('😀'.repeat(18))).toBeNull();
    expect(passwordError('😀'.repeat(19))).not.toBeNull();
  });
});
