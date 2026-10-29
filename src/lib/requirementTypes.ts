// Requirement types offered when adding a requirement. Shared by the forms and the API.
// A requirement can have several, e.g. Plant + Basic Chemicals quoted together.
export const REQUIREMENT_TYPES = [
  { value: 'PLANT', label: 'Plant' },
  { value: 'BASIC_CHEMICALS', label: 'Basic Chemicals' },
  { value: 'SPECIAL_CHEMICALS', label: 'Special Chemicals' },
  { value: 'SPARES', label: 'Spares' },
  { value: 'AMC', label: 'O&M & AMC' },
  { value: 'OTHER', label: 'Other' },
] as const;

// Types no longer offered for new requirements; existing requirements keep them and can still be saved
export const LEGACY_REQUIREMENT_TYPES = [
  { value: 'CHEMICALS', label: 'Chemicals' },
  { value: 'EVALUATION', label: 'Evaluation' },
] as const;

function typeLabel(category: string, categoryOther?: string | null): string {
  if (category === 'OTHER') return categoryOther?.trim() || 'Other';
  return [...REQUIREMENT_TYPES, ...LEGACY_REQUIREMENT_TYPES].find((t) => t.value === category)?.label || category;
}

/**
 * Display name of a requirement's types, e.g. "Plant + Basic Chemicals"; Other shows the type that was typed in.
 * Requirements saved before multiple types existed only have `category`.
 */
export function requirementTypeLabel(enquiry: {
  category?: string | null;
  categories?: string[] | null;
  categoryOther?: string | null;
}): string {
  const list = enquiry.categories?.length ? enquiry.categories : enquiry.category ? [enquiry.category] : [];
  return list.map((c) => typeLabel(c, enquiry.categoryOther)).join(' + ');
}

/**
 * Check the types ticked in a form. Returns the values to store, or an error message.
 * Also accepts a single `category` from older callers.
 */
export function parseRequirementTypes(
  categories: unknown,
  categoryOther: unknown
): { category: string; categories: string[]; categoryOther: string | null } | { error: string } {
  const picked = Array.isArray(categories) ? categories : categories ? [categories] : [];
  // Keep the order of the lists above, without duplicates; a legacy type stays only on a requirement that had it
  const valid = [...REQUIREMENT_TYPES, ...LEGACY_REQUIREMENT_TYPES].map((t) => t.value as string).filter((v) => picked.includes(v));

  if (valid.length === 0 || valid.length !== new Set(picked).size) {
    return { error: `Choose at least one requirement type: ${REQUIREMENT_TYPES.map((t) => t.label).join(', ')}` };
  }

  let other: string | null = null;
  if (valid.includes('OTHER')) {
    other = String(categoryOther ?? '').trim().slice(0, 80);
    if (!other) return { error: 'Type in what the "Other" requirement is' };
  }
  return { category: valid[0], categories: valid, categoryOther: other };
}
