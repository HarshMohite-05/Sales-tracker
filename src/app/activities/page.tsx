'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import LoadError from '@/components/ui/LoadError';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import {
  CalendarCheck,
  Clock,
  ShieldAlert,
  CheckCircle,
  AlertCircle,
  Calendar,
  Check,
  CalendarClock,
} from 'lucide-react';
import { formatDateTime, formatDate, humanize, TIMEZONE } from '@/lib/utils';
import CompleteTaskModal from '@/components/modals/CompleteTaskModal';
import RescheduleTaskModal from '@/components/modals/RescheduleTaskModal';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';
import { EMPTY_FILTERS, presetFilters } from '@/lib/recordFilters';

export default function ActivitiesPage() {
  return <Suspense fallback={<AppShell><p className="p-6 text-xs text-slate-500">Loading follow-ups…</p></AppShell>}><ActivitiesContent /></Suspense>;
}

function ActivitiesContent() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const [activeTab, setActiveTab] = useState<'tasks' | 'missing' | 'activities'>(requestedView === 'missing_action' ? 'missing' : 'tasks');

  const [tasks, setTasks] = useState<any[]>([]);
  const [missingEnquiries, setMissingEnquiries] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const taskFilter = useRecordFilters(tasks);
  const activityFilter = useRecordFilters(activities);
  const missingFilter = useRecordFilters(missingEnquiries);
  useEffect(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
    let preset = EMPTY_FILTERS;
    if (requestedView === 'overdue') preset = presetFilters('followUpTiming', 'text', 'equals', 'OVERDUE');
    if (requestedView === 'completed') preset = presetFilters('status', 'text', 'equals', 'COMPLETED');
    if (requestedView === 'today' || requestedView === 'upcoming') {
      preset = { mode: 'all', rules: [
        ...presetFilters('status', 'text', 'equals', 'PENDING').rules,
        ...presetFilters('dueDateTime', 'date', requestedView === 'today' ? 'equals' : 'gt', today).rules,
      ] };
    }
    taskFilter.onChange(preset);
    setActiveTab(requestedView === 'missing_action' ? 'missing' : 'tasks');
  }, [requestedView]);
  const [userRole, setUserRole] = useState<string | null>(null);
  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(data => setUserRole(data.user?.role || null)).catch(() => {}); }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Selected task for complete or reschedule
  const [selectedTaskForComplete, setSelectedTaskForComplete] = useState<any>(null);
  const [selectedTaskForReschedule, setSelectedTaskForReschedule] = useState<any>(null);

  async function loadTasks() {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/tasks?view=all');
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
        setMissingEnquiries(data.missingActionEnquiries || []);
      }
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  async function loadActivities() {
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/activities');
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities || []);
      }
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  useEffect(() => {
    if (activeTab !== 'activities') {
      loadTasks();
    } else {
      loadActivities();
    }
  }, [activeTab]);

  return (
    <AppShell>
      <div className="space-y-5">
        <LoadError message={loadError} onRetry={() => activeTab === 'activities' ? loadActivities() : loadTasks()} />
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Follow-ups</h1>
          </div>

          <div className="flex bg-white p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'tasks' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Follow-ups
            </button>
            <button type="button" onClick={() => setActiveTab('missing')} className={`px-3 py-1.5 rounded-lg transition ${activeTab === 'missing' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>Without follow-up</button>
            <button
              onClick={() => setActiveTab('activities')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'activities' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Activity history
            </button>
          </div>
        </div>

        {/* Content Table / Cards */}
        <RecordSearch {...(activeTab === 'activities' ? activityFilter : activeTab === 'missing' ? missingFilter : taskFilter)} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {activeTab !== 'activities' ? (
            activeTab === 'missing' ? (
              /* Missing Next Action Enquiries List */
              <div className="divide-y divide-slate-100">
                {missingFilter.rows.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Every open requirement has a follow-up.
                  </div>
                ) : (
                  missingFilter.rows.map((enq) => (
                    <div key={enq.id} className="p-4 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900">{enq.client.name}</span>
                        <p className="text-slate-500 mt-0.5">
                          {enq.title} · {enq.assignedTo.name}
                        </p>
                      </div>
                      <Link
                        href={`/clients/${enq.clientId}?followup=${enq.id}`}
                        className="bg-sky-50 text-sky-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-sky-100"
                      >
                        Add Follow-up
                      </Link>
                    </div>
                  ))
                )}
              </div>
            ) : (
              /* Tasks Table */
              <div className="divide-y divide-slate-100">
                {taskFilter.rows.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Nothing here.
                  </div>
                ) : (
                  taskFilter.rows.map((task) => {
                    const isOverdue = task.status === 'PENDING' && new Date(task.dueDateTime).getTime() < Date.now();
                    return (
                      <div
                        key={task.id}
                        className={`p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs ${
                          isOverdue ? 'bg-rose-50/30' : 'hover:bg-slate-50/60'
                        }`}
                      >
                        <div className="min-w-0 pr-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-slate-900">{task.client.name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                              {humanize(task.actionType)}
                            </span>
                            {isOverdue && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white">
                                Overdue
                              </span>
                            )}
                          </div>
                          <p className="text-slate-700 font-medium mt-1">{task.description}</p>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                            <strong className={isOverdue ? 'text-rose-600' : 'text-slate-800'}>
                              {formatDateTime(task.dueDateTime)}
                            </strong>
                            <span>{task.assignedSalesperson.name}</span>
                            {task.completionOutcome && (
                              <span className="text-emerald-700">{task.completionOutcome}</span>
                            )}
                          </div>

                          {/* Reschedule provenance note */}
                          {task.rescheduleHistory && task.rescheduleHistory.length > 0 && (
                            <p className="text-[10px] text-slate-500 italic mt-1">
                              Moved {task.rescheduleHistory.length}x: &ldquo;{task.rescheduleHistory[0].reason}&rdquo;
                            </p>
                          )}
                        </div>

                        {task.status === 'PENDING' && (
                          <div className="flex items-center space-x-2 shrink-0">
                            <button
                              onClick={() => setSelectedTaskForReschedule(task)}
                              className="border border-slate-300 hover:border-slate-400 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1"
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                              <span>Reschedule</span>
                            </button>
                            {userRole === 'SALESPERSON' && (                            <button
                              onClick={() => setSelectedTaskForComplete(task)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1 shadow-xs"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Mark Done</span>
                            </button>)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )
          ) : (
            /* Activities History Log */
            <div className="divide-y divide-slate-100">
              {activityFilter.rows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No activities logged yet.</div>
              ) : (
                activityFilter.rows.map((act) => (
                  <div key={act.id} className="p-4 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900 text-xs">{act.client.name}</span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold text-[10px]">
                          {humanize(act.activityType)}
                        </span>
                      </div>
                      <span>{formatDateTime(act.activityDate)} · {act.salesperson.name}</span>
                    </div>
                    <p className="font-semibold text-slate-800">{act.outcome}</p>
                    <p className="text-slate-600">{act.keyPoints}</p>
                    {act.nextAction && (
                      <p className="text-[11px] text-sky-800 pt-1">
                        <strong>Next:</strong> {act.nextAction} ({formatDate(act.nextActionDate)})
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {selectedTaskForComplete && (
        <CompleteTaskModal
          isOpen={!!selectedTaskForComplete}
          onClose={() => setSelectedTaskForComplete(null)}
          onSuccess={() => {
            setSelectedTaskForComplete(null);
            loadTasks();
          }}
          task={selectedTaskForComplete}
        />
      )}

      {selectedTaskForReschedule && (
        <RescheduleTaskModal
          isOpen={!!selectedTaskForReschedule}
          onClose={() => setSelectedTaskForReschedule(null)}
          onSuccess={() => {
            setSelectedTaskForReschedule(null);
            loadTasks();
          }}
          task={selectedTaskForReschedule}
        />
      )}
    </AppShell>
  );
}
