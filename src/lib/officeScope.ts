import prisma from '@/lib/prisma';

/**
 * Whose records a director's view covers: one salesperson, everyone in an office (their records count
 * under the office they belong to), or everyone (null). Use it as the value of a salesperson field, e.g.
 * { assignedSalespersonId: scope }.
 */
export async function salespersonScope(salespersonId: string | null | undefined, officeId: string | null | undefined): Promise<string | { in: string[] } | null> {
  if (salespersonId) return salespersonId;
  if (!officeId) return null;
  const people = await prisma.user.findMany({ where: { officeId }, select: { id: true } });
  return { in: people.map((p) => p.id) };
}

/** Offices for the office pickers, in name order. */
export function listOffices() {
  return prisma.office.findMany({ orderBy: { name: 'asc' } });
}
