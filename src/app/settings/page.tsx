'use client';

import React, { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';
import ChangePassword from '@/components/settings/ChangePassword';
import EmployeeAccountActions from '@/components/settings/EmployeeAccountActions';
import PaymentRulesSettings from '@/components/settings/PaymentRulesSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import OfficeSettings from '@/components/settings/OfficeSettings';
import {
  Settings,
  Users,
  FileSpreadsheet,
  Shield,
  UserPlus,
  CheckCircle,
  AlertCircle,
  Upload,
  ArrowRight,
  Database,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'offices' | 'import' | 'audit' | 'payments'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [offices, setOffices] = useState<{ id: string; name: string }[]>([]);
  const teamFilter = useRecordFilters(users);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<any>(null);

  // New User Form Modal
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('Nirmaan@2026');
  const [newUserMobile, setNewUserMobile] = useState('');
  const [newUserDesignation, setNewUserDesignation] = useState('Sales Engineer');
  const [newUserOfficeId, setNewUserOfficeId] = useState('');
  const [userError, setUserError] = useState<string | null>(null);

  // Excel Import Wizard States
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<1 | 2 | 3 | 4>(1); // 1: Upload, 2: Preview, 3: Executing, 4: Results
  const [uploadedSheets, setUploadedSheets] = useState<any>(null);
  const [selectedSheetName, setSelectedSheetName] = useState('');
  const [importAssignToId, setImportAssignToId] = useState('');
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setOffices(data.offices || []);
        const sps = (data.users || []).filter((u: any) => u.role === 'SALESPERSON');
        if (sps.length > 0 && !importAssignToId) setImportAssignToId(sps[0].id);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
    fetch('/api/auth/me').then((response) => response.json()).then((data) => setAccount(data.user || null)).catch(() => {});
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setUserError(null);
    try {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          mobile: newUserMobile,
          designation: newUserDesignation,
          officeId: newUserOfficeId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');

      setShowAddUser(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserOfficeId('');
      loadUsers();
    } catch (err: any) {
      setUserError(err.message);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setImportFile(file);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      if (res.ok) {
        setUploadedSheets(data.sheets || {});
        const firstSheet = Object.keys(data.sheets || {})[0];
        if (firstSheet) setSelectedSheetName(firstSheet);
        setImportStep(2);
      }
    } catch (error: any) { setImportResult({ error: error.message || 'Upload failed. Try again.' }); }
  }

  async function handleExecuteImport() {
    if (!selectedSheetName || !uploadedSheets[selectedSheetName]) return;
    setImporting(true);

    try {
      const rows = uploadedSheets[selectedSheetName].rows || [];
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: importFile?.name || 'legacy_tracker.xlsx',
          sheetType: uploadedSheets[selectedSheetName].detectedType,
          rows,
          assignToSalespersonId: importAssignToId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Import failed');
      setImportResult(data);
      setImportStep(4);
    } catch (error: any) { setImportResult({ error: error.message || 'Import failed. Try again.' }); }
    setImporting(false);
  }

  if (!account) return <AppShell><p className="p-6 text-xs text-slate-500">Loading account…</p></AppShell>;
  if (account.role !== 'DIRECTOR') return <AppShell><div className="max-w-xl space-y-5"><h1 className="text-xl font-bold text-slate-900">My account</h1><div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm"><p className="font-semibold text-slate-900">{account.name}</p><p className="text-slate-500">{account.email}</p><p className="text-xs text-slate-500">{account.designation || 'Salesperson'}{account.mobile ? ` · ${account.mobile}` : ''}</p><span className="inline-flex rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">Salesperson</span></div><NotificationSettings /><ChangePassword /></div></AppShell>;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Settings</h1>
          </div>

          <div className="flex bg-white p-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'users' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Team ({users.length})
            </button>
            <button
              onClick={() => setActiveTab('offices')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'offices' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Offices
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'import' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Import Excel
            </button>
            <button
              onClick={() => setActiveTab('payments')}
              className={`px-3 py-1.5 rounded-lg transition ${
                activeTab === 'payments' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              TDS & Retention
            </button>
          </div>
        </div>

        {activeTab === 'payments' && <PaymentRulesSettings />}
        {activeTab === 'offices' && <OfficeSettings />}

        {users.some(u => u.passwordResetRequestedAt) && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Password recovery requested by {users.filter(u => u.passwordResetRequestedAt).map(u => u.name).join(', ')}. Verify the employee’s identity (call them on their registered mobile), then use Reset password on their row in the Team tab.</p>}
        <NotificationSettings />
        <ChangePassword />

        {/* Tab 1: Sales Accounts */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">Team</h2>

              <button
                onClick={() => setShowAddUser(true)}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center space-x-1"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add Salesperson</span>
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              <RecordSearch {...teamFilter} label="Search records" />
              {teamFilter.rows.length === 0 && <p className="py-4 text-xs text-slate-500">No team members match these filters.</p>}
              {teamFilter.rows.map((u) => (
                <div key={u.id} className="py-3.5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between text-xs">
                  <div className="flex items-center space-x-3">
                    <div className="h-8 w-8 rounded-full bg-slate-100 font-bold text-slate-700 flex items-center justify-center">
                      {u.name.split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900">{u.name}</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            u.role === 'DIRECTOR'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {u.role === 'DIRECTOR' ? 'Director' : 'Sales'}
                        </span>
                        {!u.isActive && (
                          <span className="text-[10px] bg-rose-100 text-rose-800 px-1 rounded">Inactive</span>
                        )}
                        {u.passwordResetRequestedAt && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 rounded">Password reset requested · {formatDate(u.passwordResetRequestedAt)}</span>
                        )}
                      </div>
                      <p className="text-slate-500 text-[11px] mt-0.5">
                        {u.email}{u.mobile && ` · ${u.mobile}`}
                      </p>
                      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                        Office
                        <select
                          aria-label={`Office of ${u.name}`}
                          value={u.office?.id || ''}
                          onChange={async (e) => {
                            const res = await fetch('/api/settings/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id, officeId: e.target.value || null }) });
                            if (res.ok) loadUsers();
                          }}
                          className={`rounded border px-1.5 py-0.5 ${u.office ? 'border-slate-300' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
                        >
                          <option value="">Not set</option>
                          {offices.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {u.id !== account.id && <EmployeeAccountActions employee={u} users={users} onChanged={loadUsers} />}
                    </div>
                  </div>

                  <div className="text-slate-500 text-[11px] text-right">
                    <span><strong>{u._count?.assignedClients || 0}</strong> clients</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Excel Import Wizard (Supports 6 Sheets) */}
        {activeTab === 'import' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Import from Excel</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload your old Excel tracker to bring its data in.
              </p>
            </div>

            {/* Step Wizard Progress */}
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                { step: 1, label: '1. Upload' },
                { step: 2, label: '2. Pick Sheet' },
                { step: 3, label: '3. Check' },
                { step: 4, label: '4. Done' },
              ].map((s) => (
                <div
                  key={s.step}
                  className={`p-2.5 rounded-xl border font-semibold ${
                    importStep === s.step
                      ? 'bg-sky-50 border-sky-400 text-sky-800 shadow-xs'
                      : importStep > s.step
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  {s.label}
                </div>
              ))}
            </div>

            {/* Step 1: File Upload */}
            {importStep === 1 && (
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-3">
                <Upload className="h-10 w-10 text-slate-500 mx-auto" />
                <div>
                  <label className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-4 py-2 rounded-xl cursor-pointer shadow-xs inline-block">
                    <span>Choose Excel File</span>
                    <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            {/* Step 2 & 3: Sheet Selection and Preview */}
            {importResult?.error && <div role="alert" className="p-4 bg-rose-50 text-rose-700 rounded-xl">{importResult.error}</div>}
            {(importStep === 2 || importStep === 3) && uploadedSheets && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="settings-page-field-1" className="block font-semibold text-slate-700 mb-1">Detected Sheet</label>
                    <select id="settings-page-field-1"
                      value={selectedSheetName}
                      onChange={(e) => setSelectedSheetName(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                    >
                      {Object.keys(uploadedSheets).map((name) => (
                        <option key={name} value={name}>
                          {name} ({uploadedSheets[name].detectedType}) - {uploadedSheets[name].rowCount} rows
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="settings-page-field-2" className="block font-semibold text-slate-700 mb-1">
                      Assign Records to Sales Engineer
                    </label>
                    <select id="settings-page-field-2"
                      value={importAssignToId}
                      onChange={(e) => setImportAssignToId(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                    >
                      {users
                        .filter((u) => u.role === 'SALESPERSON')
                        .map((sp) => (
                          <option key={sp.id} value={sp.id}>{sp.name}</option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Sample Rows Preview */}
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-60">
                  <table className="w-full text-left divide-y divide-slate-100 text-[11px]">
                    <thead className="bg-slate-50 font-bold text-slate-700">
                      <tr>
                        {uploadedSheets[selectedSheetName]?.headers?.map((h: string) => (
                          <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {uploadedSheets[selectedSheetName]?.sampleRows?.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {uploadedSheets[selectedSheetName]?.headers?.map((h: string) => (
                            <td key={h} className="px-3 py-1.5 whitespace-nowrap text-slate-600">
                              {row[h] || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setImportStep(1)}
                    className="text-slate-500 font-semibold"
                  >
                    Back to Upload
                  </button>
                  <button
                    onClick={handleExecuteImport}
                    disabled={importing}
                    className="bg-sky-600 hover:bg-sky-700 text-white font-semibold px-4 py-2 rounded-xl shadow-xs"
                  >
                    {importing ? 'Importing Rows...' : 'Confirm & Execute Import'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Summary Report */}
            {importStep === 4 && importResult && (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div>
                    <h4 className="font-bold">Import finished</h4>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="text-slate-500 font-semibold text-[11px]">Total Rows</span>
                    <p className="text-lg font-bold text-slate-900">{importResult.summary?.total || 0}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                    <span className="text-emerald-700 font-semibold text-[11px]">Imported</span>
                    <p className="text-lg font-bold text-emerald-800">{importResult.summary?.importedCount || 0}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                    <span className="text-amber-700 font-semibold text-[11px]">Skipped / Empty</span>
                    <p className="text-lg font-bold text-amber-800">{importResult.summary?.skippedCount || 0}</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setImportStep(1);
                    setImportFile(null);
                    setImportResult(null);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2 rounded-xl"
                >
                  Import Another Sheet
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 border border-slate-200">
            <h3 className="font-bold text-sm text-slate-900 mb-3">Add Salesperson</h3>
            {userError && <p className="text-xs text-rose-600 mb-2">{userError}</p>}
            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label htmlFor="settings-page-field-3" className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                <input id="settings-page-field-3"
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  required
                />
              </div>

              <div>
                <label htmlFor="settings-page-field-4" className="block font-semibold text-slate-700 mb-1">Email *</label>
                <input id="settings-page-field-4"
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  required
                />
              </div>

              <div>
                <label htmlFor="settings-page-field-5" className="block font-semibold text-slate-700 mb-1">Designation</label>
                <input id="settings-page-field-5"
                  type="text"
                  value={newUserDesignation}
                  onChange={(e) => setNewUserDesignation(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                />
              </div>

              <div>
                <label htmlFor="settings-page-field-office" className="block font-semibold text-slate-700 mb-1">Office *</label>
                <select id="settings-page-field-office" value={newUserOfficeId} onChange={(e) => setNewUserOfficeId(e.target.value)} className="w-full border border-slate-300 rounded px-2.5 py-1.5" required>
                  <option value="">Choose office</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="settings-page-field-6" className="block font-semibold text-slate-700 mb-1">Mobile</label>
                <input id="settings-page-field-6"
                  type="text"
                  value={newUserMobile}
                  onChange={(e) => setNewUserMobile(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                />
              </div>

              <div>
                <label htmlFor="settings-page-field-7" className="block font-semibold text-slate-700 mb-1">Password</label>
                <input id="settings-page-field-7"
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddUser(false)}
                  className="px-3 py-1.5 font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-sky-600 text-white font-semibold px-4 py-1.5 rounded-lg shadow-xs"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
