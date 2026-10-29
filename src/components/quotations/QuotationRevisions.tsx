'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { formatQuotationNumber } from '@/lib/quotation';
import QuotationTerms from './QuotationTerms';
import QuotationActions from './QuotationActions';

interface QuotationRevisionsProps {
  // A quotation with its versions included
  quotation: any;
  // Edit / Delete on each earlier revision; left out, the list is read-only
  onEdit?: (quotation: any, versionNumber: number) => void;
  onChanged?: () => void;
}

/**
 * Collapsible list of a quotation's earlier revisions, newest first.
 * Renders nothing until the quotation has been revised.
 */
export default function QuotationRevisions({ quotation, onEdit, onChanged }: QuotationRevisionsProps) {
  const [open, setOpen] = useState(false);
  const older = (quotation.versions || [])
    .filter((v: any) => v.versionNumber !== quotation.currentVersionNumber)
    .sort((a: any, b: any) => b.versionNumber - a.versionNumber);

  if (older.length === 0) return null;

  return (
    <div className="mt-2 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-slate-500 hover:text-slate-800 font-semibold flex items-center space-x-1"
      >
        <History className="h-3.5 w-3.5" />
        <span>Older revisions ({older.length})</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="mt-2 border-l-2 border-slate-200 pl-3 space-y-2">
          {older.map((v: any) => {
            return (
              <div key={v.id} className="rounded-lg bg-white border border-slate-200 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-800">
                    {formatQuotationNumber(quotation.quotationNumber, v.versionNumber)}
                  </span>
                  <span className="text-slate-500">{formatDate(v.proposalDate)}</span>
                </div>
                <div className="mt-1">
                  <QuotationTerms quotation={quotation} versionNumber={v.versionNumber} />
                </div>
                {onEdit && onChanged && !v.isImmutable && (
                  <div className="mt-1.5">
                    <QuotationActions
                      quotation={quotation}
                      versionNumber={v.versionNumber}
                      onEdit={onEdit}
                      onChanged={onChanged}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
