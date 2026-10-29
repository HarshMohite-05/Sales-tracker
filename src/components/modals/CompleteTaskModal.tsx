'use client';

import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';

interface CompleteTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  task: {
    id: string;
    taskNumber: string;
    description: string;
    client: { name: string };
    enquiry?: { id: string; title: string; stage: string } | null;
  };
}

export default function CompleteTaskModal({
  isOpen,
  onClose,
  onSuccess,
  task,
}: CompleteTaskModalProps) {
  const [completionOutcome, setCompletionOutcome] = useState('');
  const [isFullyResolved, setIsFullyResolved] = useState(false);
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
      if (!completionOutcome.trim()) throw new Error('Completion outcome is required');
      if (!isFullyResolved && nextAction && !nextActionDate) {
        throw new Error('Next action requires a due date & time');
      }

      const res = await fetch(`/api/tasks/${task.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completionOutcome,
          isFullyResolved,
          nextAction: isFullyResolved ? undefined : nextAction,
          nextActionDate: isFullyResolved ? undefined : nextActionDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete task');

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Mark Follow-up Done</h3>
            <p className="text-xs text-slate-300 mt-0.5">{task.client.name}</p>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700">
            <span className="font-semibold text-slate-900">Original Task:</span> {task.description}
          </div>

          <div>
            <label htmlFor="modals-CompleteTaskModal-field-1" className="block text-xs font-semibold text-slate-700 mb-1">
              What happened? *
            </label>
            <textarea id="modals-CompleteTaskModal-field-1"
              rows={3}
              value={completionOutcome}
              onChange={(e) => setCompletionOutcome(e.target.value)}
              placeholder="What happened during this follow-up? Summary of client response..."
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500"
              required
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="fullyResolved"
              checked={isFullyResolved}
              onChange={(e) => setIsFullyResolved(e.target.checked)}
              className="rounded text-sky-600 focus:ring-sky-500 h-4 w-4"
            />
            <label htmlFor="fullyResolved" className="text-xs text-slate-700 font-medium">
              Task is completely closed (No further follow-up required)
            </label>
          </div>

          {!isFullyResolved && (
            <div className="bg-sky-50/70 p-3 rounded-xl border border-sky-100 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-900 block">
                Next Action Follow-up
              </span>
              <input
                type="text"
                placeholder="Next action description"
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
          )}

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
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm flex items-center space-x-1"
            >
              <CheckCircle className="h-4 w-4" />
              <span>{loading ? 'Completing...' : 'Mark Completed'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
