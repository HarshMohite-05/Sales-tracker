/**
 * Runs during each Vercel build, after the tables are created. Makes sure the offices exist, and on the very
 * first deploy (no users yet) creates the team from BOOTSTRAP_DATA: base64 JSON of
 *   { offices: [{ code, name, address?, phone?, email?, gstin? }],
 *     users: [{ email, name, passwordHash, role, mobile?, designation?, isActive, office? }] }
 * set as a secret Vercel environment variable (never committed). Once users exist it changes nothing, so
 * the variable can be removed after the first deploy.
 */
import { Role } from '@prisma/client';
import prisma from '../src/lib/prisma';

const DEFAULT_OFFICES = [
  { code: 'MUM', name: 'Mumbai' },
  { code: 'AMD', name: 'Ahmedabad' },
];

type Data = {
  offices?: { code: string; name: string; address?: string | null; phone?: string | null; email?: string | null; gstin?: string | null }[];
  users?: { email: string; name: string; passwordHash: string; role: Role; mobile?: string | null; designation?: string | null; isActive?: boolean; office?: string | null }[];
};

async function main() {
  const data: Data = process.env.BOOTSTRAP_DATA ? JSON.parse(Buffer.from(process.env.BOOTSTRAP_DATA, 'base64').toString('utf8')) : {};

  // Offices: the defaults, plus any details given; existing offices keep what directors entered
  const officeIds: Record<string, string> = {};
  const offices: NonNullable<Data['offices']> = data.offices?.length ? data.offices : DEFAULT_OFFICES;
  for (const { code, name, ...details } of offices) {
    const saved = await prisma.office.upsert({ where: { code }, update: {}, create: { code, name, ...details } });
    officeIds[code] = saved.id;
  }

  const existing = await prisma.user.count();
  if (existing > 0 || !data.users?.length) {
    console.log(`Bootstrap: offices ready; ${existing} users already, nothing else to do.`);
    return;
  }
  for (const u of data.users) {
    await prisma.user.create({
      data: {
        email: u.email.toLowerCase(),
        name: u.name,
        passwordHash: u.passwordHash,
        role: u.role,
        mobile: u.mobile ?? null,
        designation: u.designation ?? null,
        isActive: u.isActive ?? true,
        officeId: u.office ? officeIds[u.office] ?? null : null,
      },
    });
  }
  console.log(`Bootstrap: created ${data.users.length} users.`);
}

main()
  .catch((e) => {
    console.error('Bootstrap failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
