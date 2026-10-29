import { Prisma, TransportationTerms } from '@prisma/client';
import { DEFAULT_GST_PERCENT, formatPaymentStages, parsePaymentStages, quotationValues } from '@/lib/quotation';

/**
 * Check the fields of the quotation form (create, revise and edit all send the same ones)
 * and turn them into the columns stored on a quotation version.
 */
export function parseQuotationInput(body: any):
  | { error: string }
  | { values: ReturnType<typeof quotationValues>; terms: {
      product: string;
      paymentTerms: string | null;
      paymentStages: any;
      transportation: TransportationTerms;
      remarks: string | null;
    } } {
  const { product, price, gstPercent, paymentStages, transportation, remarks } = body ?? {};

  if (!product?.trim()) return { error: 'Product is required' };
  const priceValue = Number(price);
  if (!Number.isFinite(priceValue) || !(priceValue > 0) || priceValue > 999999999999.99) return { error: 'Enter a price greater than zero' };
  if (!(transportation in TransportationTerms)) return { error: 'Choose transportation: Extra at actual or Included' };
  // GST %: 18 by default; 0 for a quotation without GST
  const gst = gstPercent === undefined || gstPercent === null || gstPercent === '' ? DEFAULT_GST_PERCENT : Number(gstPercent);
  if (Number.isNaN(gst) || gst < 0 || gst > 28) return { error: 'GST must be between 0% and 28%' };
  const parsedStages = parsePaymentStages(paymentStages);
  if ('error' in parsedStages) return { error: parsedStages.error };

  return {
    values: quotationValues(product.trim(), priceValue, gst),
    terms: {
      product: product.trim(),
      paymentTerms: formatPaymentStages(parsedStages.stages) || null,
      paymentStages: parsedStages.stages.length > 0 ? (parsedStages.stages as any[]) : Prisma.JsonNull,
      transportation: transportation as TransportationTerms,
      remarks: remarks?.trim() || null,
    },
  };
}
