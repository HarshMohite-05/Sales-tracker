import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { clientCodeError, firstFreeCode, normalizeClientCode, suggestClientCode } from '@/lib/clientCode';
import { takenCodesLike } from '@/lib/numbering';

type Db = typeof prisma | Prisma.TransactionClient;

export interface ClientCodeCheck {
  code: string;
  error: string | null;
  usedBy?: string; // name of the client that already has this code
  suggestion?: string; // a free variant, e.g. NGPL2
}

/** Validate a code and make sure no other client has it. */
export async function checkClientCode(db: Db, rawCode: string, excludeClientId?: string, revealOwner = true): Promise<ClientCodeCheck> {
  const code = normalizeClientCode(rawCode);
  const formatError = clientCodeError(code);
  if (formatError) return { code, error: formatError };

  const owner = await db.client.findUnique({ where: { code }, select: { id: true, name: true } });
  if (!owner || owner.id === excludeClientId) return { code, error: null };

  const suggestion = firstFreeCode(code, await takenCodesLike(db, code));
  return {
    code,
    error: revealOwner ? `${code} is already used by ${owner.name}. Try ${suggestion}.` : `${code} is already in use. Try ${suggestion}.`,
    usedBy: revealOwner ? owner.name : 'another client',
    suggestion,
  };
}

/** A free code for a client created without one (e.g. Excel import): initials, then NGPL2, NGPL3... */
export async function autoClientCode(db: Db, name: string): Promise<string> {
  let base = suggestClientCode(name);
  if (base.length < 2) base = `${base}CL`.slice(0, 10);
  return firstFreeCode(base, await takenCodesLike(db, base));
}
