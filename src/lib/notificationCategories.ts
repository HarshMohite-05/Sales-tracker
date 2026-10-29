/**
 * Kinds of update directors are told about. Every update goes to their notification list; the kinds a
 * director ticks in Settings also buzz their phone. Safe to use in the browser.
 */
export const UPDATE_CATEGORIES = [
  { key: 'CLIENTS', label: 'Clients added or changed' },
  { key: 'ENQUIRIES', label: 'Requirements added or moved' },
  { key: 'FOLLOW_UPS', label: 'Discussions logged and follow-ups set, done or rescheduled' },
  { key: 'QUOTATIONS', label: 'Quotations and approval requests' },
  { key: 'ORDERS', label: 'Orders' },
  { key: 'PAYMENTS', label: 'Invoices and payments' },
  { key: 'TARGETS', label: 'Targets and incentives' },
  { key: 'TEAM', label: 'Team and settings' },
  { key: 'DELETIONS', label: 'Deletions and restores' },
  { key: 'ESCALATIONS', label: 'Overdue follow-up escalations' },
] as const;

export type UpdateCategory = (typeof UPDATE_CATEGORIES)[number]['key'];

// Phone alerts for a director who has not chosen yet
export const DEFAULT_PUSH_CATEGORIES: UpdateCategory[] = ['QUOTATIONS', 'ORDERS', 'PAYMENTS', 'DELETIONS', 'ESCALATIONS'];

/** The kinds that buzz this director's phone. */
export function pushCategoriesOf(saved: unknown): string[] {
  return Array.isArray(saved) ? saved.filter((c): c is string => typeof c === 'string') : DEFAULT_PUSH_CATEGORIES;
}
