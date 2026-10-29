export function passwordError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 8) return 'Use at least 8 characters for the new password';
  // bcrypt only distinguishes the first 72 UTF-8 bytes.
  if (new TextEncoder().encode(value).length > 72) return 'Password must be at most 72 UTF-8 bytes';
  return null;
}
