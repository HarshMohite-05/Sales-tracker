import { NextResponse } from 'next/server';

/** A request that can't be carried out as sent; answered with 400 and the message. */
export class ValidationError extends Error {
  name = 'ValidationError';
}

export class ConflictError extends Error {
  name = 'ConflictError';
}

/**
 * Standard JSON error response for the auth, permission and validation errors routes throw.
 */
export function errorResponse(error: any) {
  if (error?.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (error?.message === 'FORBIDDEN_DIRECTOR_ONLY') {
    return NextResponse.json({ error: 'Only a director can do this' }, { status: 403 });
  }
  if (error?.name === 'AuthorizationError') return NextResponse.json({ error: error.message }, { status: 403 });
  if (error?.name === 'ValidationError') return NextResponse.json({ error: error.message }, { status: 400 });
  if (error?.name === 'ConflictError' || error?.code === 'P2002' || error?.code === 'P2034') {
    return NextResponse.json({ error: error?.name === 'ConflictError' ? error.message : 'The record changed or already exists. Refresh and try again.' }, { status: 409 });
  }
  if (error?.code === 'P2025') return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  if (error instanceof SyntaxError || error?.name === 'PrismaClientValidationError' || error?.code === 'P2003') {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
  }
  console.error('API request failed:', error);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
