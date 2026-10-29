'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { stageLabel } from '@/lib/utils';
import { cleanAmountInput, formatAmountInput } from '@/lib/quotation';
import RequirementTypeField from '@/components/clients/RequirementTypeField';

interface AddRequirementModalProps {
  onClose: () => void;
  onSuccess: () => void;
  clientId: string;
  clientName: string;
  contactId?: string;
}

// A new requirement starts open; Won/Lost/On hold are set later from its card
const OPENING_STAGES = ['NEW', 'PROPOSAL', 'NEGOTIATION'];

export default function AddRequirementModal({ onClose, onSuccess, clientId, clientName, contactId }: AddRequirementModalProps) {
  const [title, setTitle] = useState('');
  const [categories, setCategories] = useState<string[]>(['PLANT']);
  const [categoryOther, setCategoryOther] = useState('');
  const [value, setValue] = useState('');
  const [stage, setStage] = useState('NEW');
  const [summary, setSummary] = useState('');
  const [activityType, setActivityType] = useState('CALL');
  const [discussionNotes, setDiscussionNotes] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (nextAction.trim() && !nextActionDate) {
      setError('Pick a date and time for the next follow-up');
      return;
    }
    if (categories.length === 0) {
      setError('Tick at least one requirement type');
      return;
    }
    if (categories.includes('OTHER') && !categoryOther.trim()) {
      setError('Type in what the "Other" requirement is');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          contactId,
          title,
          categories,
          categoryOther,
          estimatedValue: parseFloat(value) || 0,
          requirementSummary: summary,
          stage,
          activityType,
          discussionNotes,
          nextAction,
          nextActionDate: nextActionDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save requirement');
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  const input = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-sky-500 focus:outline-none';
  const label = 'block font-semibold text-slate-700 mb-1';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">New Requirement</h3>
            <p className="text-xs text-slate-300 mt-0.5">{clientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 text-xs max-h-[75vh] overflow-y-auto">
          {error && <p className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">{error}</p>}

          {/* Requirement */}
          <div className="space-y-3">
            <div>
              <label htmlFor="modals-AddRequirementModal-field-1" className={label}>What do they need? *</label>
              <input id="modals-AddRequirementModal-field-1"
                type="text"
                placeholder="e.g. 15 m3/hr EDI Plant Supply"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={input}
                required
              />
            </div>
            <div>
              <label className={label}>Type * (tick all that apply)</label>
              <RequirementTypeField
                categories={categories}
                categoryOther={categoryOther}
                onCategoriesChange={setCategories}
                onCategoryOtherChange={setCategoryOther}
                inputClassName={input}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="modals-AddRequirementModal-field-2" className={label}>Approx. Value (₹)</label>
                <input id="modals-AddRequirementModal-field-2"
                  type="text"
                  inputMode="decimal"
                  value={formatAmountInput(value)}
                  onChange={(e) => setValue(cleanAmountInput(e.target.value))}
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="modals-AddRequirementModal-field-3" className={label}>Stage</label>
                <select id="modals-AddRequirementModal-field-3" value={stage} onChange={(e) => setStage(e.target.value)} className={input}>
                  {OPENING_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="modals-AddRequirementModal-field-4" className={label}>Details (optional)</label>
              <textarea id="modals-AddRequirementModal-field-4" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={input} />
            </div>
          </div>

          {/* Conversation */}
          <div className="space-y-3 pt-4 border-t border-slate-200">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">What was discussed</h4>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="modals-AddRequirementModal-field-5" className={label}>How</label>
                <select id="modals-AddRequirementModal-field-5" value={activityType} onChange={(e) => setActivityType(e.target.value)} className={input}>
                  <option value="CALL">Call</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                  <option value="MEETING">Meeting</option>
                  <option value="SITE_VISIT">Site Visit</option>
                </select>
              </div>
              <div className="col-span-2">
                <label htmlFor="modals-AddRequirementModal-field-6" className={label}>Notes</label>
                <input id="modals-AddRequirementModal-field-6"
                  type="text"
                  placeholder="Leave empty if nothing to log"
                  value={discussionNotes}
                  onChange={(e) => setDiscussionNotes(e.target.value)}
                  className={input}
                />
              </div>
            </div>
          </div>

          {/* Next follow-up */}
          <div className="space-y-3 p-3 rounded-xl bg-sky-50/70 border border-sky-100">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-sky-900">Next follow-up</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="e.g. Send quotation"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className={`${input} bg-white`}
              />
              <input
                type="datetime-local"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                className={`${input} bg-white`}
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 font-semibold text-slate-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-4 py-1.5 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Requirement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
