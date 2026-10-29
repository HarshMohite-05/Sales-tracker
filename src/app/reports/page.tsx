'use client';

import React, { useState, useEffect } from 'react';
import LoadError from '@/components/ui/LoadError';
import AppShell from '@/components/layout/AppShell';
import {
  FileBarChart,
  Download,
  Filter,
  Calendar,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';
import { EMPTY_FILTERS } from '@/lib/recordFilters';

export default function ReportsPage() {
  const [reportType, setReportType] = useState('pipeline');
  const [reportResult, setReportResult] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Directors: one office (Mumbai, Ahmedabad) or both
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const [officeId, setOfficeId] = useState('');
  const reportFilter = useRecordFilters<any>(reportResult?.data || []);

  async function loadReport() {
    setLoadError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: reportType,
        allDates: '1',
        ...(officeId ? { officeId } : {}),
      });

      const res = await fetch(`/api/reports?${params.toString()}`);
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) {
        const data = await res.json();
        setReportResult(data);
      }
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  useEffect(() => {
    loadReport();
  }, [reportType, officeId]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (me) => {
        if (me?.user?.role !== 'DIRECTOR') return;
        const res = await fetch('/api/settings/offices');
        if (res.ok) setOffices((await res.json()).offices || []);
      })
      .catch(() => {});
  }, []);

  function handleExcelExport() {
    const params = new URLSearchParams({
      type: reportType,
        allDates: '1',
      export: 'excel',
      filters: JSON.stringify(reportFilter.filters),
      ...(officeId ? { officeId } : {}),
    });
    window.open(`/api/reports?${params.toString()}`, '_blank');
  }

  const dataList = reportFilter.rows;
  const columns = reportResult?.data?.length ? Object.keys(reportResult.data[0]) : [];

  return (
    <AppShell>
      <div className="space-y-5">
        <LoadError message={loadError} onRetry={loadReport} />
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Reports</h1>
          </div>

          <button
            onClick={handleExcelExport}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-xs transition flex items-center space-x-1.5 self-start md:self-auto"
          >
            <Download className="h-4 w-4" />
            <span>Download Excel</span>
          </button>
        </div>

        {/* Report Type Selector */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
              Report
            </label>
            <select
              aria-label="Report type"
              value={reportType}
              onChange={(e) => { setReportType(e.target.value); reportFilter.onChange(EMPTY_FILTERS); }}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800"
            >
              <option value="pipeline">Requirements</option>
              <option value="activities">Activities</option>
              <option value="orders">Orders</option>
              <option value="receivables">Payments due</option>
              <option value="quotations">Quotations</option>
              <option value="followups">Follow-ups</option>
            </select>
          </div>
          {offices.length > 0 && (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">Office</label>
              <select
                aria-label="Office"
                value={officeId}
                onChange={(e) => setOfficeId(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800"
              >
                <option value="">All offices</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}

        </div>

        {/* Report Output Table */}
        <RecordSearch {...reportFilter} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800">
              {dataList.length} rows
            </h3>
          </div>

          <div className="overflow-x-auto max-h-[60vh]" tabIndex={0} role="region" aria-label="Report rows">
            {loadError ? null : loading ? (
              <div className="p-12 text-center text-xs text-slate-500">Loading report records...</div>
            ) : dataList.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500">No records found for selected criteria.</div>
            ) : (
              <table className="w-full text-left text-xs divide-y divide-slate-100">
                <thead className="bg-slate-50 sticky top-0 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <tr>
                    {columns.map((col) => (
                      <th key={col} className="px-4 py-2.5 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataList.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60 transition">
                      {columns.map((col) => {
                        const val = row[col];
                        const isCurrency =
                          col.toLowerCase().includes('value') ||
                          col.toLowerCase().includes('amount') ||
                          col.toLowerCase().includes('balance');

                        return (
                          <td key={col} className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                            {isCurrency && typeof val === 'number' ? (
                              <span className="font-semibold text-slate-900">{formatINR(val)}</span>
                            ) : (
                              val ?? '-'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
