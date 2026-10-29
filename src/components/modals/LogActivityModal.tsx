'use client';

import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { stageLabel } from '@/lib/utils';

interface LogActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clientId: string;
  clientName: string;
  enquiries?: Array<{ id: string; enquiryNumber: string; title: string; stage?: string }>;
  contacts?: Array<{ id: string; name: string }>;
}

export default function LogActivityModal({
  isOpen,
  onClose,
  onSuccess,
  clientId,
  clientName,
  enquiries = [],
  contacts = [],
}: LogActivityModalProps) {
  const [activityType, setActivityType] = useState('CALL');
  const [outcome, setOutcome] = useState('Discussion Held - Positive');
  const [discussionType, setDiscussionType] = useState('INTRODUCTORY');
  // Default to the newest requirement that is still open
  const defaultEnquiry = enquiries.find((e) => e.stage !== 'WON' && e.stage !== 'LOST') || enquiries[0];
  const [enquiryId, setEnquiryId] = useState(defaultEnquiry?.id || '');
  const [contactId, setContactId] = useState(contacts[0]?.id || '');
  const [keyPoints, setKeyPoints] = useState('');
  const [remarks, setRemarks] = useState('');
  const [stageUpdate, setStageUpdate] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!keyPoints.trim()) throw new Error('Key discussion points are required');
      if (nextAction && !nextActionDate) throw new Error('Next action requires a scheduled date & time');

      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          enquiryId: enquiryId || null,
          contactId: contactId || null,
          activityType,
          outcome,
          discussionType,
          keyPoints,
          remarks,
          stageUpdate: stageUpdate || undefined,
          nextAction: nextAction || undefined,
          nextActionDate: nextActionDate ? new Date(nextActionDate).toISOString() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to log activity');

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Log Call/Visit</h3>
            <p className="text-xs text-slate-300 mt-0.5">{clientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="modals-LogActivityModal-field-1" className="block text-xs font-semibold text-slate-700 mb-1">Activity</label>
              <select id="modals-LogActivityModal-field-1"
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <option value="CALL">Call</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="MEETING">Meeting</option>
                <option value="SITE_VISIT">Site Visit</option>
              </select>
            </div>

            <div>
              <label htmlFor="modals-LogActivityModal-field-2" className="block text-xs font-semibold text-slate-700 mb-1">Discussion Type</label>
              <select id="modals-LogActivityModal-field-2"
                value={discussionType}
                onChange={(e) => setDiscussionType(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <option value="INTRODUCTORY">Introductory</option>
                <option value="TECHNICAL">Technical</option>
                <option value="COMMERCIAL">Commercial</option>
              </select>
            </div>
          </div>

          {enquiries.length > 0 && (
            <div>
              <label htmlFor="modals-LogActivityModal-field-3" className="block text-xs font-semibold text-slate-700 mb-1">Which requirement?</label>
              <select id="modals-LogActivityModal-field-3"
                value={enquiryId}
                onChange={(e) => setEnquiryId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
              >
                <option value="">General (not about one requirement)</option>
                {enquiries.map((enq) => (
                  <option key={enq.id} value={enq.id}>
                    {enq.title}{enq.stage ? ` (${stageLabel(enq.stage)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="modals-LogActivityModal-field-4" className="block text-xs font-semibold text-slate-700 mb-1">Outcome</label>
            <input id="modals-LogActivityModal-field-4"
              type="text"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
              required
            />
          </div>

          <div>
            <label htmlFor="modals-LogActivityModal-field-5" className="block text-xs font-semibold text-slate-700 mb-1">What was discussed *</label>
            <textarea id="modals-LogActivityModal-field-5"
              rows={3}
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              placeholder="What was agreed? Technical specifications, timeline, decision makers..."
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
              required
            />
          </div>

          <div className="bg-sky-50/60 p-3 rounded-xl border border-sky-100 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-sky-900 block">
              Schedule Next Follow-up Task
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Next action (e.g. Call for commercial closure)"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
              />
              <input
                type="datetime-local"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm"
            >
              {loading ? 'Saving...' : 'Save Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
