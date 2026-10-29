'use client';

import React from 'react';
import { formatINR } from '@/lib/utils';
import {
  QuotationTermKey,
  amountInWords,
  changedTerms,
  formatQuotationNumber,
  transportationLabel,
  versionTerms,
  gstPercentOf,
} from '@/lib/quotation';

interface QuotationTermsProps {
  quotation: any; // with versions included
  versionNumber?: number; // defaults to the current version
}

/**
 * A quotation version's product, amount, payment terms, transportation and remark.
 * Whatever changed from the previous revision is shown in bold.
 */
export default function QuotationTerms({ quotation, versionNumber = quotation.currentVersionNumber }: QuotationTermsProps) {
  const versions: any[] = quotation.versions || [];
  const version = versions.find((v) => v.versionNumber === versionNumber) || quotation;
  // Nearest earlier version, in case a revision in between was deleted
  const previous = versions
    .filter((v) => v.versionNumber < versionNumber)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const terms = versionTerms(version);
  const changed = changedTerms(version, previous);

  const weight = (key: QuotationTermKey) => (changed.has(key) ? 'font-bold text-slate-900' : 'font-normal');

  return (
    <div className="space-y-0.5 text-slate-600">
      {terms.product && <p className={weight('product')}>{terms.product}</p>}
      <p className={weight('amount')}>
        {Number(version.taxAmount) > 0 && (
          <span className="font-normal text-slate-500">
            {formatINR(terms.amount - Number(version.taxAmount))} + GST {gstPercentOf(version)}% {formatINR(version.taxAmount)} ={' '}
          </span>
        )}
        {formatINR(terms.amount)}
        <span className="italic"> · {amountInWords(terms.amount)}</span>
      </p>
      {(terms.paymentTerms || terms.transportation || terms.remarks) && (
        <p className="text-[11px]">
          {terms.paymentTerms && <span className={weight('paymentTerms')}>Payment: {terms.paymentTerms}</span>}
          {terms.paymentTerms && terms.transportation && ' | '}
          {terms.transportation && (
            <span className={weight('transportation')}>Transport: {transportationLabel(terms.transportation)}</span>
          )}
          {(terms.paymentTerms || terms.transportation) && terms.remarks && ' | '}
          {terms.remarks && <span className={weight('remarks')}>Remark: {terms.remarks}</span>}
        </p>
      )}
      {previous && (
        <p className="text-[10px] text-slate-500">
          {changed.size > 0
            ? `Bold = changed from ${formatQuotationNumber(quotation.quotationNumber, previous.versionNumber)}`
            : `No changes from ${formatQuotationNumber(quotation.quotationNumber, previous.versionNumber)}`}
        </p>
      )}
    </div>
  );
}
