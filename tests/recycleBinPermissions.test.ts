import { describe, expect, it } from 'vitest';
import { canPermanentlyDelete } from '@/lib/recycleBinPermissions';

describe('Recycle bin permanent deletion permissions', () => {
  it('allows directors and admin-designated employees', () => {
    expect(canPermanentlyDelete({ role: 'DIRECTOR' })).toBe(true);
    expect(canPermanentlyDelete({ role: 'SALESPERSON', designation: 'Admin' })).toBe(true);
    expect(canPermanentlyDelete({ role: 'SALESPERSON', designation: ' admin ' })).toBe(true);
  });

  it('refuses ordinary employees and admin-like job titles', () => {
    for (const designation of [null, undefined, '', 'Sales Executive', 'Technician', 'Administrative Assistant']) {
      expect(canPermanentlyDelete({ role: 'SALESPERSON', designation })).toBe(false);
    }
  });
});
