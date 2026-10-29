'use client';

import React, { useState } from 'react';
import { AlertTriangle, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { formatQuotationNumber } from '@/lib/quotation';

interface QuotationActionsProps {
  quotation: any; // with versions included
  versionNumber?: number; // defaults to the current version
  onEdit: (quotation: any, versionNumber: number) => void;
  onRevise?: (quotation: any) => void; // only offered on the current version
  onChanged: () => void;
}

/**
 * Edit / Revise / Delete for one version of a quotation. Deleting the original removes the whole
 * quotation with its revisions; deleting a revision removes just that one. Both go to the recycle bin.
 */
export default function QuotationActions({
  quotation,
  versionNumber = quotation.currentVersionNumber,
  onEdit,
  onRevise,
  onChanged,
}: QuotationActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once an order is confirmed the quotation is fixed
  if (quotation.approvalStatus === 'ACCEPTED') return null;

  const isOriginal = versionNumber === 0;
  const isCurrent = versionNumber === quotation.currentVersionNumber;
  const label = formatQuotationNumber(quotation.quotationNumber, versionNumber);
  const revisionCount = Math.max((quotation.versions?.length || 1) - 1, 0);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const url = isOriginal
        ? `/api/quotations/${quotation.id}`
        : `/api/quotations/${quotation.id}/versions/${versionNumber}`;
      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete');
      setConfirming(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setDeleting(false);
  }

  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => onEdit(quotation, versionNumber)}
          className="text-slate-600 hover:text-sky-700 font-semibold flex items-center space-x-1"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span>Edit</span>
        </button>
        {onRevise && isCurrent && (
          <button
            type="button"
            onClick={() => onRevise(quotation)}
            className="text-sky-700 hover:text-sky-900 font-semibold flex items-center space-x-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Revise</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          className="text-slate-500 hover:text-rose-600 font-semibold flex items-center space-x-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>
      </div>

      {confirming && (
        <div className="mt-2 p-2.5 rounded-lg border border-rose-200 bg-rose-50 space-y-2 text-left">
          <p className="font-bold text-rose-800 flex items-center space-x-1.5">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {isOriginal
                ? `Delete quotation ${quotation.quotationNumber}${revisionCount > 0 ? ` and its ${revisionCount} revision${revisionCount === 1 ? '' : 's'}` : ''}?`
                : `Delete ${label}?`}
            </span>
          </p>
          <p className="text-rose-700">
            {!isOriginal && isCurrent && 'The revision before it becomes the current one again. '}
            It moves to the Recycle Bin, where you can restore it for 5 days.
          </p>
          {error && <p className="font-semibold text-rose-700">{error}</p>}
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
            >
              No, keep it
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Yes, delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
