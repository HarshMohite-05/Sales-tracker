'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, MessageSquare, ArrowRight, Trash2, AlertTriangle, Plus, FileText, CheckCircle2, CalendarClock } from 'lucide-react';
import CompleteTaskModal from '@/components/modals/CompleteTaskModal';
import RescheduleTaskModal from '@/components/modals/RescheduleTaskModal';
import { stageLabel, formatINR, formatDate, formatDateTime, humanize } from '@/lib/utils';
import { formatQuotationNumber } from '@/lib/quotation';
import { requirementTypeLabel } from '@/lib/requirementTypes';
import QuotationTerms from '@/components/quotations/QuotationTerms';
import QuotationRevisions from '@/components/quotations/QuotationRevisions';
import QuotationActions from '@/components/quotations/QuotationActions';
import { NoteItem } from '@/components/clients/ClientNotes';

// Main path of a deal; LOST and ON_HOLD are shown as side states
const PIPELINE = ['NEW', 'PROPOSAL', 'NEGOTIATION', 'WON'];

interface RequirementCardProps {
  enquiry: any;
  notes?: any[]; // notes on this requirement (and its quotation), newest first
  onOpenNotes?: () => void;
  clientName?: string; // shown in the follow-up done / reschedule dialogs
  activities: any[]; // this client's activities, filtered here by enquiry
  defaultExpanded?: boolean;
  openFollowUp?: boolean; // open the add-follow-up form on load (linked from the Follow-ups page)
  onChanged: () => void;
  onCreateQuotation?: () => void;
  onReviseQuotation?: (quotation: any) => void;
  onEditQuotation?: (quotation: any, versionNumber: number) => void;
}

export default function RequirementCard({
  enquiry,
  notes = [],
  onOpenNotes,
  clientName,
  activities,
  defaultExpanded = false,
  openFollowUp = false,
  onChanged,
  onCreateQuotation,
  onReviseQuotation,
  onEditQuotation,
}: RequirementCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(openFollowUp);
  const [followUpText, setFollowUpText] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpType, setFollowUpType] = useState('CALL');
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [taskDialog, setTaskDialog] = useState<'done' | 'reschedule' | null>(null);

  useEffect(() => {
    if (openFollowUp) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [openFollowUp]);

  const stage = enquiry.stage;
  const isClosed = stage === 'WON' || stage === 'LOST';
  const stageIndex = PIPELINE.indexOf(stage);
  const stageSince = enquiry.stageHistory?.[0]?.createdAt || enquiry.createdAt;

  const myActivities = activities.filter((a) => a.enquiryId === enquiry.id || a.enquiry?.id === enquiry.id);
  const lastActivity = myActivities[0];
  const quotation = enquiry.quotations?.[0];
  const nextTask = (enquiry.tasks || []).find((t: any) => t.status === 'PENDING');
  const nextTaskOverdue = nextTask && new Date(nextTask.dueDateTime).getTime() < Date.now();

  // Combined timeline of conversations and stage changes, newest first
  const timeline = [
    ...myActivities.map((a) => ({ kind: 'activity', date: a.activityDate, item: a })),
    ...(enquiry.stageHistory || []).map((h: any) => ({ kind: 'stage', date: h.createdAt, item: h })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  async function saveFollowUp() {
    setFollowUpError(null);
    if (!followUpText.trim()) {
      setFollowUpError('Say what needs to be done');
      return;
    }
    if (!followUpDate) {
      setFollowUpError('Pick a date and time');
      return;
    }
    setSavingFollowUp(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: enquiry.clientId,
          enquiryId: enquiry.id,
          assignedSalespersonId: enquiry.assignedToId, // needed when a director adds it
          actionType: followUpType,
          description: followUpText,
          dueDateTime: new Date(followUpDate).toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add follow-up');
      setShowFollowUp(false);
      setFollowUpText('');
      setFollowUpDate('');
      onChanged();
    } catch (err: any) {
      setFollowUpError(err.message);
    }
    setSavingFollowUp(false);
  }

  async function deleteRequirement() {
    setDeleteError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/enquiries/${enquiry.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete requirement');
      onChanged();
    } catch (err: any) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  return (
    <div ref={cardRef} className={`rounded-xl border p-4 text-xs ${isClosed ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200'}`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[11px] font-bold tracking-wider text-sky-700">{enquiry.enquiryNumber}</span>
          <h4 className="font-bold text-sm text-slate-900">{enquiry.title}</h4>
          <p className="text-slate-500 mt-0.5">
            Started {formatDate(enquiry.createdAt)} · {requirementTypeLabel(enquiry)}
            {quotation ? (
              // Once quoted, the quotation's latest price is the requirement's value
              <>
                {' · '}
                <strong className="text-slate-700">{formatINR(enquiry.estimatedValue)}</strong> quoted
                {Number(enquiry.approxValue) > 0 && Number(enquiry.approxValue) !== Number(enquiry.estimatedValue) && (
                  <span className="text-slate-500"> (approx. {formatINR(enquiry.approxValue)})</span>
                )}
              </>
            ) : (
              Number(enquiry.estimatedValue) > 0 && (
                <>
                  {' · '}approx. <strong className="text-slate-700">{formatINR(enquiry.estimatedValue)}</strong>
                </>
              )
            )}
            {enquiry.assignedTo?.name && <> · {enquiry.assignedTo.name}</>}
          </p>
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">
          {stageLabel(stage)} since {formatDate(stageSince)}
        </span>
      </div>

      {/* Stage tracker */}
      <div className="mt-3 flex items-center flex-wrap gap-1">
        {PIPELINE.map((s, i) => {
          const done = stageIndex >= 0 && i < stageIndex;
          const current = s === stage;
          return (
            <React.Fragment key={s}>
              {i > 0 && <span className={`h-px w-4 ${done || current ? 'bg-sky-400' : 'bg-slate-200'}`} />}
              <span
                className={`px-2 py-1 rounded-full text-[11px] font-semibold flex items-center space-x-1 ${
                  current
                    ? s === 'WON'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-sky-600 text-white'
                    : done
                    ? 'bg-sky-50 text-sky-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done && <Check className="h-3 w-3" />}
                <span>{stageLabel(s)}</span>
              </span>
            </React.Fragment>
          );
        })}
        {(stage === 'LOST' || stage === 'ON_HOLD') && (
          <span
            className={`ml-2 px-2 py-1 rounded-full text-[11px] font-semibold ${
              stage === 'LOST' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
            }`}
          >
            {stageLabel(stage)}
          </span>
        )}
      </div>
      {stage === 'LOST' && enquiry.lostReason && <p className="mt-1.5 text-rose-700">Reason: {enquiry.lostReason}</p>}
      {stage === 'ON_HOLD' && (
        <p className="mt-1.5 text-amber-700">
          {enquiry.holdReason}
          {enquiry.holdReviewDate && <> · Check back {formatDate(enquiry.holdReviewDate)}</>}
        </p>
      )}

      {/* This requirement's quotation */}
      {quotation ? (
        <div className="mt-3 rounded-lg p-2.5 border border-sky-100 bg-sky-50/50">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-sky-600" />
          <span className="font-bold text-slate-900">
            {formatQuotationNumber(quotation.quotationNumber, quotation.currentVersionNumber)}
          </span>
          <span className="text-slate-500">{humanize(quotation.approvalStatus)}</span>
        </div>
        <div className="mt-1">
          <QuotationTerms quotation={quotation} />
        </div>
        {onEditQuotation && (
          <div className="mt-1.5">
            <QuotationActions
              quotation={quotation}
              onEdit={(q, versionNumber) => onEditQuotation({ ...q, enquiry }, versionNumber)}
              onRevise={onReviseQuotation ? (q) => onReviseQuotation({ ...q, enquiry }) : undefined}
              onChanged={onChanged}
            />
          </div>
        )}
        <QuotationRevisions
          quotation={quotation}
          onEdit={onEditQuotation ? (q, versionNumber) => onEditQuotation({ ...q, enquiry }, versionNumber) : undefined}
          onChanged={onChanged}
        />
        </div>
      ) : (
        onCreateQuotation &&
        !isClosed && (
          <div className="mt-3 flex items-center gap-2 rounded-lg p-2.5 border border-dashed border-slate-200">
            <span className="text-slate-500">No quotation yet</span>
            <button
              onClick={onCreateQuotation}
              className="ml-auto text-sky-700 hover:text-sky-900 font-semibold flex items-center space-x-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create quotation</span>
            </button>
          </div>
        )
      )}

      {/* Last conversation & next step */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1">
            <MessageSquare className="h-3 w-3" />
            <span>Last conversation</span>
          </span>
          {lastActivity ? (
            <>
              <p className="text-slate-500 mt-1">
                {formatDateTime(lastActivity.activityDate)} · {humanize(lastActivity.activityType)} · {lastActivity.salesperson?.name}
              </p>
              <p className="font-semibold text-slate-800 mt-0.5">{lastActivity.outcome}</p>
              {lastActivity.keyPoints && <p className="text-slate-600 line-clamp-2">{lastActivity.keyPoints}</p>}
            </>
          ) : (
            <p className="text-slate-500 mt-1">Nothing logged for this requirement yet</p>
          )}
        </div>

        <div className={`rounded-lg p-2.5 border ${nextTaskOverdue ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1">
            <Clock className="h-3 w-3" />
            <span>Next step</span>
          </span>
          {nextTask ? (
            <>
              <p className={`mt-1 font-semibold ${nextTaskOverdue ? 'text-rose-700' : 'text-slate-500'}`}>
                {nextTaskOverdue ? 'Overdue · ' : ''}
                {formatDateTime(nextTask.dueDateTime)}
              </p>
              <p className="text-slate-800 mt-0.5">{nextTask.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTaskDialog('done')}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => setTaskDialog('reschedule')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Reschedule
                </button>
              </div>
            </>
          ) : showFollowUp ? (
            <div className="mt-1.5 space-y-1.5">
              <input
                type="text"
                placeholder="What to do, e.g. Call for feedback"
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                autoFocus={openFollowUp}
                className="w-full border border-slate-300 rounded px-2 py-1 bg-white"
              />
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="flex-1 min-w-0 border border-slate-300 rounded px-2 py-1 bg-white"
                />
                <select
                  value={followUpType}
                  onChange={(e) => setFollowUpType(e.target.value)}
                  className="border border-slate-300 rounded px-1.5 py-1 bg-white"
                >
                  <option value="CALL">Call</option>
                  <option value="MEETING">Meeting</option>
                  <option value="SITE_VISIT">Site Visit</option>
                  <option value="QUOTATION_FOLLOWUP">Quotation follow-up</option>
                </select>
              </div>
              {followUpError && <p className="text-rose-600">{followUpError}</p>}
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => {
                    setShowFollowUp(false);
                    setFollowUpError(null);
                  }}
                  className="px-2 py-0.5 font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={saveFollowUp}
                  disabled={savingFollowUp}
                  className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-2.5 py-0.5 rounded disabled:opacity-60"
                >
                  {savingFollowUp ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className={`mt-1 ${isClosed ? 'text-slate-500' : 'text-amber-700 font-semibold'}`}>
                {isClosed ? 'Closed' : 'No follow-up set'}
              </p>
              <button
                onClick={() => setShowFollowUp(true)}
                className="mt-1.5 text-sky-700 hover:text-sky-900 font-semibold flex items-center space-x-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add follow-up</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* This requirement's notes: the latest, with a link to all of them */}
      {notes.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Notes ({notes.length})</span>
            {onOpenNotes && (
              <button onClick={onOpenNotes} className="text-[11px] font-semibold text-sky-700 hover:text-sky-900">
                {notes.length > 1 ? `View all ${notes.length}` : 'Open in Notes'}
              </button>
            )}
          </div>
          <NoteItem note={notes[0]} tone="sky" compact />
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setConfirmDelete(true);
            setDeleteError(null);
          }}
          className="text-slate-500 hover:text-rose-600 font-semibold flex items-center space-x-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>

        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto text-sky-700 hover:text-sky-900 font-semibold flex items-center space-x-1"
        >
          <span>History ({timeline.length})</span>
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {confirmDelete && (
        <div className="mt-2 p-3 rounded-lg border border-rose-200 bg-rose-50 space-y-2">
          <p className="font-bold text-rose-800 flex items-center space-x-1.5">
            <AlertTriangle className="h-4 w-4" />
            <span>Delete &ldquo;{enquiry.title}&rdquo;?</span>
          </p>
          <p className="text-rose-700">
            It moves to the Recycle Bin with its pending follow-ups, and you can restore it from there for 5 days.
            Past calls and visits stay in the client&apos;s history.
          </p>
          {deleteError && <p className="font-semibold text-rose-700">{deleteError}</p>}
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
            >
              No, keep it
            </button>
            <button
              onClick={deleteRequirement}
              disabled={deleting}
              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
            >
              {deleting ? 'Deleting...' : 'Yes, delete it'}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2.5">
          {timeline.length === 0 ? (
            <p className="text-slate-500">No history yet.</p>
          ) : (
            timeline.map((entry) =>
              entry.kind === 'stage' ? (
                <div key={`s-${entry.item.id}`} className="flex items-start space-x-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-sky-500 shrink-0" />
                  <div>
                    <p className="text-slate-500">{formatDateTime(entry.date)} · {entry.item.changedBy?.name}</p>
                    {/* Creation entries (incl. older "Enquiry created" wording) read as one event */}
                    {/creat/i.test(entry.item.reason || '') || entry.item.fromStage === entry.item.toStage ? (
                      <p className="font-semibold text-slate-800">
                        Requirement created
                        {entry.item.toStage !== 'NEW' && <> at {stageLabel(entry.item.toStage)}</>}
                      </p>
                    ) : (
                      <>
                        <p className="font-semibold text-slate-800 flex items-center space-x-1">
                          <span>{stageLabel(entry.item.fromStage)}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span>{stageLabel(entry.item.toStage)}</span>
                        </p>
                        {entry.item.reason && entry.item.reason !== 'Stage updated' && (
                          <p className="text-slate-600">{entry.item.reason}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div key={`a-${entry.item.id}`} className="flex items-start space-x-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                  <div>
                    <p className="text-slate-500">
                      {formatDateTime(entry.date)} · {humanize(entry.item.activityType)} · {entry.item.salesperson?.name}
                    </p>
                    <p className="font-semibold text-slate-800">{entry.item.outcome}</p>
                    {entry.item.keyPoints && <p className="text-slate-600">{entry.item.keyPoints}</p>}
                  </div>
                </div>
              )
            )
          )}
        </div>
      )}

      {nextTask && taskDialog === 'done' && (
        <CompleteTaskModal
          isOpen
          onClose={() => setTaskDialog(null)}
          onSuccess={() => {
            setTaskDialog(null);
            onChanged();
          }}
          task={{
            id: nextTask.id,
            taskNumber: nextTask.taskNumber || '',
            description: nextTask.description,
            client: { name: clientName || enquiry.client?.name || '' },
            enquiry: { id: enquiry.id, title: enquiry.title, stage: enquiry.stage },
          }}
        />
      )}

      {nextTask && taskDialog === 'reschedule' && (
        <RescheduleTaskModal
          isOpen
          onClose={() => setTaskDialog(null)}
          onSuccess={() => {
            setTaskDialog(null);
            onChanged();
          }}
          task={{
            id: nextTask.id,
            taskNumber: nextTask.taskNumber || '',
            description: nextTask.description,
            dueDateTime: nextTask.dueDateTime,
            client: { name: clientName || enquiry.client?.name || '' },
          }}
        />
      )}
    </div>
  );
}
