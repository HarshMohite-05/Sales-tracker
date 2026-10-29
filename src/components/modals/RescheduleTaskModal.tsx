'use client';

import React, { useState } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

interface RescheduleTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  task: {
    id: string;
    taskNumber: string;
    description: string;
    dueDateTime: string | Date;
    client: { name: string };
  };
}

export default function RescheduleTaskModal({
  isOpen,
  onClose,
  onSuccess,
  task,
}: RescheduleTaskModalProps) {
  const [newDueDateTime, setNewDueDateTime] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!newDueDateTime) throw new Error('New deadline date & time is required');
      if (!reason.trim()) throw new Error('A valid reason is required for rescheduling');

      const res = await fetch(`/api/tasks/${task.id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newDueDateTime,
          reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reschedule task');

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-navy-900 text-white px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm tracking-wide">Reschedule</h3>
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
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
            <p className="text-slate-500 font-medium">Current Deadline:</p>
            <p className="font-bold text-slate-800">{formatDateTime(task.dueDateTime)}</p>
            <p className="mt-1 text-slate-600 truncate">{task.description}</p>
          </div>

          <div>
            <label htmlFor="modals-RescheduleTaskModal-field-1" className="block text-xs font-semibold text-slate-700 mb-1">
              New Date & Time *
            </label>
            <input id="modals-RescheduleTaskModal-field-1"
              type="datetime-local"
              value={newDueDateTime}
              onChange={(e) => setNewDueDateTime(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500"
              required
            />
          </div>

          <div>
            <label htmlFor="modals-RescheduleTaskModal-field-2" className="block text-xs font-semibold text-slate-700 mb-1">
              Reason for Rescheduling *
            </label>
            <textarea id="modals-RescheduleTaskModal-field-2"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client requested callback on Monday, technical team travelling..."
              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-sky-500"
              required
            />
            <span className="text-[10px] text-slate-500">
              Reason and previous deadline are permanently logged in audit history.
            </span>
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
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm flex items-center space-x-1"
            >
              <CalendarClock className="h-4 w-4" />
              <span>{loading ? 'Updating...' : 'Reschedule'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
