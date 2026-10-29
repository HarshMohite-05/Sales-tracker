'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { LEGACY_REQUIREMENT_TYPES, REQUIREMENT_TYPES } from '@/lib/requirementTypes';

interface RequirementTypeFieldProps {
  categories: string[];
  categoryOther: string;
  onCategoriesChange: (value: string[]) => void;
  onCategoryOtherChange: (value: string) => void;
  inputClassName: string;
}

/**
 * Requirement types as tick boxes, since one requirement can cover several (e.g. Plant + Basic Chemicals).
 * Ticking Other shows a box to type the type in. A legacy type shows only on a requirement that has it.
 */
export default function RequirementTypeField({
  categories,
  categoryOther,
  onCategoriesChange,
  onCategoryOtherChange,
  inputClassName,
}: RequirementTypeFieldProps) {
  function toggle(value: string) {
    onCategoriesChange(categories.includes(value) ? categories.filter((c) => c !== value) : [...categories, value]);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {[...REQUIREMENT_TYPES, ...LEGACY_REQUIREMENT_TYPES.filter((t) => categories.includes(t.value))].map((t) => {
          const on = categories.includes(t.value);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => toggle(t.value)}
              aria-pressed={on}
              className={`px-2.5 py-1 rounded-full border text-xs font-semibold flex items-center gap-1 transition ${
                on ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-sky-400'
              }`}
            >
              {on && <Check className="h-3 w-3" />}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
      {categories.includes('OTHER') && (
        <input
          type="text"
          placeholder="Type of requirement"
          value={categoryOther}
          onChange={(e) => onCategoryOtherChange(e.target.value)}
          maxLength={80}
          className={inputClassName}
          required
          autoFocus
        />
      )}
    </div>
  );
}
