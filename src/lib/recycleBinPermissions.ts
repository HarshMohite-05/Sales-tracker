/** Admin is currently stored as a director-managed employee designation. */
export function canPermanentlyDelete(user: { role: string; designation?: string | null }): boolean {
  return user.role === 'DIRECTOR' || user.designation?.trim().toLowerCase() === 'admin';
}
