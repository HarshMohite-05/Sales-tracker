'use client';
export default function LoadError({message,onRetry}:{message:string|null;onRetry:()=>void}) {
  if (!message) return null;
  return <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{message}</span><button type="button" onClick={onRetry} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold focus-visible:outline-2 focus-visible:outline-rose-600">Try again</button></div>;
}
