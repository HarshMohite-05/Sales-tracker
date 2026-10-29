'use client';

import React, { useState } from 'react';
import { Building2, FileText, Pin, Send } from 'lucide-react';
import { formatDateTime, stageLabel } from '@/lib/utils';

interface ClientNotesProps {
  clientId: string;
  clientAssignedToId?: string | null;
  notes: any[];
  enquiries: any[];
  quotations: any[];
  isDirector: boolean;
  // Requirement whose notes to show first, e.g. opened from a requirement card
  focusEnquiryId?: string | null;
  onPosted: () => void;
}

/**
 * The requirement a note belongs to: notes on a requirement, or on its quotation. Null for general
 * (client-wide) notes.
 */
export function noteEnquiryId(note: any, quotations: any[]): string | null {
  if (note.entityType === 'ENQUIRY') return note.entityId;
  if (note.entityType === 'QUOTATION') return quotations.find((q) => q.id === note.entityId)?.enquiryId ?? null;
  return null;
}

/**
 * A client's notes: general notes about the client first, then notes on each requirement.
 * Salespeople and directors add notes, choosing whether one is general or for a requirement.
 */
export default function ClientNotes({
  clientId,
  clientAssignedToId,
  notes,
  enquiries,
  quotations,
  isDirector,
  focusEnquiryId,
  onPosted,
}: ClientNotesProps) {
  const general = notes.filter((n) => n.entityType === 'CLIENT');
  const byEnquiry = new Map<string, any[]>();
  for (const n of notes) {
    const enquiryId = noteEnquiryId(n, quotations);
    if (enquiryId) byEnquiry.set(enquiryId, [...(byEnquiry.get(enquiryId) || []), n]);
  }
  // Requirements with notes, most recently noted first
  const noted = enquiries
    .filter((e) => byEnquiry.has(e.id))
    .sort((a, b) => new Date(byEnquiry.get(b.id)![0].createdAt).getTime() - new Date(byEnquiry.get(a.id)![0].createdAt).getTime());

  const [showFor, setShowFor] = useState<string>(focusEnquiryId && byEnquiry.has(focusEnquiryId) ? focusEnquiryId : 'ALL');
  const shown = showFor === 'ALL' ? noted : noted.filter((e) => e.id === showFor);

  return (
    <div className="space-y-5">
      <NoteComposer
        clientId={clientId}
        clientAssignedToId={clientAssignedToId}
        enquiries={enquiries}
        defaultEnquiryId={focusEnquiryId || null}
        isDirector={isDirector}
        onPosted={onPosted}
      />

      {/* General: about the client as a whole, always on top */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
            <Pin className="h-4 w-4 text-amber-600" />
            General notes
            <span className="font-normal text-slate-500">· about this client</span>
          </h3>
          <span className="text-[11px] font-semibold text-slate-500">{general.length}</span>
        </div>
        {general.length === 0 ? (
          <p className="text-xs text-slate-500">No general notes yet.</p>
        ) : (
          <div className="space-y-2">
            {general.map((n) => (
              <NoteItem key={n.id} note={n} tone="amber" />
            ))}
          </div>
        )}
      </section>

      {/* Requirement-specific: grouped under each requirement */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-sky-600" />
            Requirement notes
          </h3>
          {noted.length > 0 && (
            <select
              value={showFor}
              onChange={(e) => setShowFor(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white"
              aria-label="Show notes for"
            >
              <option value="ALL">All requirements ({noted.length})</option>
              {noted.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.enquiryNumber} · {e.title} ({byEnquiry.get(e.id)!.length})
                </option>
              ))}
            </select>
          )}
        </div>
        {noted.length === 0 ? (
          <p className="text-xs text-slate-500">No notes on any requirement yet.</p>
        ) : (
          <div className="space-y-4">
            {shown.map((e) => (
              <div key={e.id} id={`notes-${e.id}`} className="scroll-mt-24 rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs">
                  <span className="text-[11px] font-bold tracking-wider text-sky-700">{e.enquiryNumber}</span>
                  <span className="font-semibold text-slate-800">{e.title}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      e.stage === 'WON'
                        ? 'bg-emerald-100 text-emerald-800'
                        : e.stage === 'LOST'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    {stageLabel(e.stage)}
                  </span>
                  <span className="ml-auto text-[11px] text-slate-500">{byEnquiry.get(e.id)!.length} notes</span>
                </div>
                <div className="p-3 space-y-2">
                  {byEnquiry.get(e.id)!.map((n) => (
                    <NoteItem key={n.id} note={n} tone="sky" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function NoteItem({ note, tone, compact = false }: { note: any; tone: 'amber' | 'sky'; compact?: boolean }) {
  const style = tone === 'amber' ? 'bg-amber-50/70 border-amber-200' : 'bg-sky-50/50 border-sky-100';
  return (
    <div className={`${compact ? 'p-2' : 'p-3'} border rounded-xl text-xs ${style}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-500">
        <span>
          <strong className="text-slate-700">{note.director?.name}</strong>
          {note.targetSalesperson?.name && <> → {note.targetSalesperson.name}</>}
          {note.entityType === 'QUOTATION' && <> · on the quotation</>}
        </span>
        <span>{formatDateTime(note.createdAt)}</span>
      </div>
      <p className={`text-slate-800 mt-1 whitespace-pre-line ${compact ? 'line-clamp-2' : ''}`}>{note.instruction}</p>
    </div>
  );
}

// Add a note: general (the client) or for one requirement
function NoteComposer({
  clientId,
  clientAssignedToId,
  enquiries,
  defaultEnquiryId,
  isDirector,
  onPosted,
}: {
  clientId: string;
  clientAssignedToId?: string | null;
  enquiries: any[];
  defaultEnquiryId: string | null;
  isDirector: boolean;
  onPosted: () => void;
}) {
  const [about, setAbout] = useState<'GENERAL' | 'REQUIREMENT'>(defaultEnquiryId ? 'REQUIREMENT' : 'GENERAL');
  const [enquiryId, setEnquiryId] = useState(defaultEnquiryId || enquiries[0]?.id || '');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enquiry = enquiries.find((e) => e.id === enquiryId);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!text.trim()) {
      setError('Write the note');
      return;
    }
    if (about === 'REQUIREMENT' && !enquiry) {
      setError('Choose the requirement');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          about === 'GENERAL'
            ? { entityType: 'CLIENT', entityId: clientId, instruction: text.trim(), targetSalespersonId: clientAssignedToId }
            : { entityType: 'ENQUIRY', entityId: enquiry.id, instruction: text.trim(), targetSalespersonId: enquiry.assignedToId }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not post the note');
      setText('');
      onPosted();
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }

  const option = (value: 'GENERAL' | 'REQUIREMENT', label: string, Icon: typeof Building2) => (
    <button
      type="button"
      onClick={() => setAbout(value)}
      aria-pressed={about === value}
      disabled={value === 'REQUIREMENT' && enquiries.length === 0}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition disabled:opacity-40 ${
        about === value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <form onSubmit={post} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-sm text-slate-900 mr-auto">Add a note</h3>
        <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Note is about">
          {option('GENERAL', 'General', Building2)}
          {option('REQUIREMENT', 'Requirement', FileText)}
        </div>
      </div>
      {about === 'REQUIREMENT' && (
        <select
          value={enquiryId}
          onChange={(e) => setEnquiryId(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white"
          aria-label="Requirement"
        >
          {enquiries.map((e) => (
            <option key={e.id} value={e.id}>
              {e.enquiryNumber} · {e.title} · {stageLabel(e.stage)}
            </option>
          ))}
        </select>
      )}
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          about === 'GENERAL'
            ? 'A note about the client as a whole, e.g. payment habits, key contact, standing instructions'
            : `A note for ${enquiry ? `${enquiry.enquiryNumber} ${enquiry.title}` : 'this requirement'}`
        }
        className="w-full border border-slate-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-sky-500"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {about === 'GENERAL' ? 'Shown at the top of Notes for everyone on this client.' : 'Shown under this requirement, and on its card.'}
          {isDirector && ' The salesperson responsible is notified.'}
        </p>
        <button
          type="submit"
          disabled={saving}
          className="bg-navy-900 hover:bg-navy-800 text-white px-4 py-2 rounded-xl font-semibold shadow-sm flex items-center gap-1.5 disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" />
          {saving ? 'Posting...' : 'Post note'}
        </button>
      </div>
      {error && <p className="font-semibold text-rose-700">{error}</p>}
    </form>
  );
}
