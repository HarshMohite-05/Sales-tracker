'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Search, AlertCircle, ChevronDown, ChevronUp, Check, Save } from 'lucide-react';
import RequirementTypeField from '@/components/clients/RequirementTypeField';
import { cleanAmountInput, formatAmountInput } from '@/lib/quotation';
import { DEFAULT_INDUSTRY_SEGMENTS } from '@/lib/industries';
import { ENQUIRY_STAGES, stageLabel } from '@/lib/utils';
import { suggestClientCode, normalizeClientCode, clientCodeError } from '@/lib/clientCode';

interface AddClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentUserRole: 'DIRECTOR' | 'SALESPERSON';
  currentUserId: string;
}

export default function AddClientModal({
  isOpen,
  onClose,
  onSuccess,
  currentUserRole,
  currentUserId,
}: AddClientModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<any[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form Fields
  // Section A: Client Details
  const [clientName, setClientName] = useState('');
  const [industrySegment, setIndustrySegment] = useState('Pharmaceutical');
  const [contactPerson, setContactPerson] = useState('');
  const [location, setLocation] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [emailAddress, setEmailAddress] = useState('');

  // Section B: Requirement and Discussion
  const [clientRequirement, setClientRequirement] = useState('');
  const [requirementCategories, setRequirementCategories] = useState<string[]>(['PLANT']);
  const [requirementCategoryOther, setRequirementCategoryOther] = useState('');
  const [requirementValue, setRequirementValue] = useState('');
  const [requirementDetails, setRequirementDetails] = useState('');
  const [stageOfLead, setStageOfLead] = useState('NEW');
  const [typeOfActivity, setTypeOfActivity] = useState('CALL');
  const [callOutcome, setCallOutcome] = useState('Connected - Discussion Held');
  const [meetingType, setMeetingType] = useState('INTRODUCTORY');
  const [keyDiscussionPoints, setKeyDiscussionPoints] = useState('');
  const [remarks, setRemarks] = useState('');

  // Section C: Next Follow-up
  const [nextAction, setNextAction] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');

  // Auto-filled & Visible
  const todayStr = new Date().toISOString().split('T')[0];
  const [entryDate, setEntryDate] = useState(todayStr);
  const [assignedSalespersonId, setAssignedSalespersonId] = useState(currentUserId);

  // Collapsed Details
  const [clientType, setClientType] = useState('End User');
  const [contactDesignation, setContactDesignation] = useState('');
  const [leadSource, setLeadSource] = useState('Direct Inbound');
  const [referredBy, setReferredBy] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [gstin, setGstin] = useState('');

  // Existing Client search & auto-fill
  const [existingClients, setExistingClients] = useState<any[]>([]);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);
  // 'new' = brand-new client; 'existing' = pick one of my clients and add a requirement
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || mode !== 'existing' || selectedExistingId) return;
    setPickerLoading(true);
    const timer = setTimeout(async () => {
      try {
        const q = pickerQuery.trim();
        const res = await fetch(`/api/clients${q ? `?search=${encodeURIComponent(q)}` : ''}`);
        if (res.ok) {
          const data = await res.json();
          setExistingClients((data.clients || []).slice(0, 25));
        }
      } catch {}
      setPickerLoading(false);
    }, pickerQuery ? 250 : 0);
    return () => clearTimeout(timer);
  }, [isOpen, mode, pickerQuery, selectedExistingId]);

  // Client code for requirement numbers (NGPL -> NGPL/001); suggested from the name until edited
  const [clientCode, setClientCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [codeProblem, setCodeProblem] = useState<{ error: string; suggestion?: string } | null>(null);

  useEffect(() => {
    if (!codeEdited) setClientCode(suggestClientCode(clientName));
  }, [clientName, codeEdited]);

  useEffect(() => {
    if (selectedExistingId || !clientCode) {
      setCodeProblem(null);
      return;
    }
    const formatError = clientCodeError(clientCode);
    if (formatError) {
      setCodeProblem({ error: formatError });
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/code-check?code=${encodeURIComponent(clientCode)}`);
        const data = await res.json();
        setCodeProblem(data.error ? { error: data.error, suggestion: data.suggestion } : null);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [clientCode, selectedExistingId]);

  // Industry dropdown (defaults + custom segments already used by clients)
  const [industryOptions, setIndustryOptions] = useState<string[]>(DEFAULT_INDUSTRY_SEGMENTS);
  const [customIndustry, setCustomIndustry] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/clients/industries')
      .then((res) => res.json())
      .then((data) => {
        if (data.industries) setIndustryOptions(data.industries);
      })
      .catch(() => {});
  }, [isOpen]);

  function addCustomIndustry() {
    const name = customIndustry.trim();
    if (!name) return;
    const existing = industryOptions.find((s) => s.toLowerCase() === name.toLowerCase());
    if (!existing) {
      setIndustryOptions((prev) => [...prev, name]);
    }
    setIndustrySegment(existing || name);
    setCustomIndustry('');
  }

  useEffect(() => {
    if (currentUserRole === 'DIRECTOR') {
      fetch('/api/settings/users')
        .then((res) => res.json())
        .then((data) => {
          const sps = (data.users || []).filter((u: any) => u.role === 'SALESPERSON' && u.isActive);
          setSalespeople(sps);
          if (sps.length > 0 && !assignedSalespersonId) {
            setAssignedSalespersonId(sps[0].id);
          }
        })
        .catch(() => {});
    }
  }, [currentUserRole, assignedSalespersonId]);

  // Duplicate Search as user types client name
  useEffect(() => {
    if (clientName.trim().length >= 3 && !selectedExistingId) {
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/clients?search=${encodeURIComponent(clientName.trim())}`);
          if (res.ok) {
            const data = await res.json();
            if (data.clients && data.clients.length > 0) {
              setDuplicateWarning(data.clients);
            } else {
              setDuplicateWarning(null);
            }
          }
        } catch {}
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setDuplicateWarning(null);
    }
  }, [clientName, selectedExistingId]);

  function selectExistingClient(client: any) {
    setMode('existing');
    setSelectedExistingId(client.id);
    setClientName(client.name);
    setIndustrySegment(client.industrySegment);
    if (client.industrySegment && client.industrySegment !== 'Other' && !industryOptions.includes(client.industrySegment)) {
      setIndustryOptions((prev) => [...prev, client.industrySegment]);
    }
    setLocation(client.city || '');
    if (client.contacts && client.contacts.length > 0) {
      setContactPerson(client.contacts[0].name);
      setMobileNumber(client.contacts[0].mobile);
      setEmailAddress(client.contacts[0].email || '');
    }
    setDuplicateWarning(null);
  }

  async function handleSubmit(saveMode: 'WITH_FOLLOWUP' | 'CLIENT_ONLY') {
    setError(null);
    setLoading(true);

    try {
      if (mode === 'existing' && !selectedExistingId) {
        throw new Error('Pick the client from the list first');
      }
      if (!clientName.trim()) {
        throw new Error('Client / Company Name is required');
      }

      if (!selectedExistingId) {
        const codeError = clientCodeError(clientCode);
        if (codeError) throw new Error(codeError);
        if (codeProblem) throw new Error(codeProblem.error);
      }

      // A new client can be saved without a requirement; adding one to an existing client needs it
      if (mode === 'existing' && !clientRequirement.trim()) {
        throw new Error('Enter the requirement: what does this client need?');
      }
      if (clientRequirement.trim() && requirementCategories.length === 0) {
        throw new Error('Tick at least one requirement type');
      }
      if (clientRequirement.trim() && requirementCategories.includes('OTHER') && !requirementCategoryOther.trim()) {
        throw new Error('Type in what the "Other" requirement is');
      }

      if (saveMode === 'WITH_FOLLOWUP' && nextAction && !nextActionDate) {
        throw new Error('A deadline date and time is required when creating a next action');
      }

      const payload = {
        clientName,
        // Typed-but-not-added custom segment still counts
        industrySegment: industrySegment === 'Other' && customIndustry.trim() ? customIndustry.trim() : industrySegment,
        contactPerson,
        location,
        mobileNumber,
        emailAddress,
        clientRequirement,
        requirementCategories,
        requirementCategoryOther,
        requirementValue: parseFloat(requirementValue) || 0,
        requirementDetails,
        stageOfLead,
        typeOfActivity: saveMode === 'WITH_FOLLOWUP' ? typeOfActivity : undefined,
        callOutcome: saveMode === 'WITH_FOLLOWUP' ? callOutcome : undefined,
        meetingType: saveMode === 'WITH_FOLLOWUP' ? meetingType : undefined,
        keyDiscussionPoints: saveMode === 'WITH_FOLLOWUP' ? keyDiscussionPoints : undefined,
        remarks,
        nextAction: saveMode === 'WITH_FOLLOWUP' ? nextAction : undefined,
        nextActionDate: saveMode === 'WITH_FOLLOWUP' && nextActionDate ? new Date(nextActionDate).toISOString() : undefined,
        entryDate,
        assignedSalespersonId: currentUserRole === 'DIRECTOR' ? assignedSalespersonId : currentUserId,
        clientType,
        contactDesignation,
        leadSource,
        referredBy,
        whatsappNumber,
        siteAddress,
        state,
        gstin,
        existingClientId: selectedExistingId,
        clientCode: selectedExistingId ? undefined : clientCode,
        saveMode,
      };

      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.suggestion) setCodeProblem({ error: data.error, suggestion: data.suggestion });
        throw new Error(data.error || 'Failed to save client');
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter((el) => el.getClientRects().length > 0);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const items = controls();
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    dialog?.addEventListener('keydown', onKey);
    return () => { dialog?.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="add-client-title" className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="bg-navy-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h3 id="add-client-title" className="font-bold text-base tracking-wide">
              {mode === 'existing' ? 'New Requirement for a Client' : 'Add Client'}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close add client"
            className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-navy-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center space-x-2 text-rose-700 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
          {/* Metadata Row: Entry Date & Sales Executive */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="modals-AddClientModal-field-1" className="block text-xs font-semibold text-slate-700 mb-1">
                Date
              </label>
              <input id="modals-AddClientModal-field-1"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
              />
            </div>

            {currentUserRole === 'DIRECTOR' && (
            <div>
              <label htmlFor="modals-AddClientModal-field-2" className="block text-xs font-semibold text-slate-700 mb-1">
                Salesperson
              </label>
                <select id="modals-AddClientModal-field-2"
                  value={assignedSalespersonId}
                  onChange={(e) => setAssignedSalespersonId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                >
                  {salespeople.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
            </div>
            )}
          </div>

          {/* Section A: Client Details */}
          <div>
            <div className="border-b border-slate-200 pb-2 mb-3 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
                Client
              </h4>
              {selectedExistingId && (
                <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">
                  Existing client
                </span>
              )}
            </div>

            {/* New vs existing client */}
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              {(['new', 'existing'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    if (m === 'new' && selectedExistingId) {
                      setSelectedExistingId(null);
                      setClientName('');
                      setContactPerson('');
                      setMobileNumber('');
                      setEmailAddress('');
                      setLocation('');
                    }
                  }}
                  className={`rounded-lg px-3 py-2 transition ${
                    mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m === 'new' ? 'New client' : 'Existing client · new requirement'}
                </button>
              ))}
            </div>

            {mode === 'existing' && !selectedExistingId ? (
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="search"
                    autoFocus
                    placeholder="Search your clients by name, contact, mobile or city"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
                <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {pickerLoading && existingClients.length === 0 ? (
                    <p className="p-4 text-center text-xs text-slate-500">Loading clients…</p>
                  ) : existingClients.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No client matches.{' '}
                      <button type="button" onClick={() => setMode('new')} className="font-semibold text-sky-700 hover:underline">
                        Add as a new client
                      </button>
                    </div>
                  ) : (
                    existingClients.map((c) => {
                      const open = (c.enquiries || []).filter((e: any) => e.stage !== 'WON' && e.stage !== 'LOST').length;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectExistingClient(c)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition hover:bg-sky-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-slate-900">
                              {c.name}
                              {c.code && <span className="ml-1.5 text-[10px] font-bold tracking-wider text-sky-700">{c.code}</span>}
                            </span>
                            <span className="block truncate text-slate-500">
                              {[c.contacts?.[0]?.name, c.city].filter(Boolean).join(' · ') || c.industrySegment}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-slate-500">
                            {open > 0 ? `${open} open` : `${c.enquiries?.length || 0} req.`}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : selectedExistingId ? (
              /* Existing client: details are already on file */
              <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 flex items-start justify-between text-xs">
                <div>
                  <p className="font-bold text-slate-900">{clientName}</p>
                  <p className="text-slate-600 mt-0.5">
                    {[industrySegment, contactPerson, mobileNumber, location].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-slate-500 mt-1">Just fill in the new requirement and follow-up below.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedExistingId(null)}
                  className="text-sky-700 hover:text-sky-900 font-semibold shrink-0 ml-3"
                >
                  Change
                </button>
              </div>
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 relative">
                <label htmlFor="modals-AddClientModal-field-3" className="block text-xs font-semibold text-slate-700 mb-1">
                  Company Name *
                </label>
                <input id="modals-AddClientModal-field-3"
                  type="text"
                  placeholder="e.g. Cipla Laboratories Ltd"
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    if (selectedExistingId) setSelectedExistingId(null);
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />

                {/* Duplicate Warning Box */}
                {duplicateWarning && duplicateWarning.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-amber-50 border border-amber-300 rounded-xl p-3 shadow-lg z-30 text-xs">
                    <p className="font-bold text-amber-800 flex items-center space-x-1.5">
                      <AlertCircle className="h-4 w-4" />
                      <span>Possible existing duplicate client(s) found:</span>
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {duplicateWarning.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between bg-white p-2 rounded-lg border border-amber-200 hover:border-sky-400 cursor-pointer"
                          onClick={() => selectExistingClient(c)}
                        >
                          <div>
                            <span className="font-semibold text-slate-800">{c.name}</span>
                            <span className="text-slate-500 ml-2">({c.city || 'No City'})</span>
                          </div>
                          <button
                            type="button"
                            className="bg-sky-50 text-sky-700 font-semibold text-[11px] px-2 py-0.5 rounded hover:bg-sky-100"
                          >
                            Use Existing
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-4" className="block text-xs font-semibold text-slate-700 mb-1">
                  Client Code *
                </label>
                <input id="modals-AddClientModal-field-4"
                  type="text"
                  placeholder="e.g. NGPL"
                  value={clientCode}
                  onChange={(e) => {
                    setCodeEdited(true);
                    setClientCode(normalizeClientCode(e.target.value).slice(0, 10));
                  }}
                  className={`w-full border rounded-lg px-3 py-2 text-xs font-semibold tracking-wider focus:ring-2 focus:ring-sky-500 focus:outline-none ${
                    codeProblem ? 'border-rose-400' : 'border-slate-300'
                  }`}
                />
                {codeProblem ? (
                  <p className="text-[11px] text-rose-600 mt-1">
                    {codeProblem.error}{' '}
                    {codeProblem.suggestion && (
                      <button
                        type="button"
                        onClick={() => {
                          setCodeEdited(true);
                          setClientCode(codeProblem.suggestion!);
                        }}
                        className="font-semibold text-sky-700 underline"
                      >
                        Use {codeProblem.suggestion}
                      </button>
                    )}
                  </p>
                ) : (
                  clientCode && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Requirements will be numbered {clientCode}/001, {clientCode}/002...
                    </p>
                  )
                )}
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-5" className="block text-xs font-semibold text-slate-700 mb-1">
                  Industry *
                </label>
                <select id="modals-AddClientModal-field-5"
                  value={industrySegment}
                  onChange={(e) => setIndustrySegment(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                >
                  {industryOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </select>
                {industrySegment === 'Other' && (
                  <div className="flex items-center space-x-2 mt-2">
                    <input
                      type="text"
                      placeholder="Enter new industry segment"
                      value={customIndustry}
                      onChange={(e) => setCustomIndustry(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomIndustry();
                        }
                      }}
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomIndustry}
                      disabled={!customIndustry.trim()}
                      className="bg-sky-600 text-white font-semibold text-xs px-3 py-2 rounded-lg hover:bg-sky-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-6" className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Person *
                </label>
                <input id="modals-AddClientModal-field-6"
                  type="text"
                  placeholder="e.g. Dr. Vivek Joshi"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-7" className="block text-xs font-semibold text-slate-700 mb-1">
                  City *
                </label>
                <input id="modals-AddClientModal-field-7"
                  type="text"
                  placeholder="e.g. Pithampur"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-8" className="block text-xs font-semibold text-slate-700 mb-1">
                  Mobile *
                </label>
                <input id="modals-AddClientModal-field-8"
                  type="text"
                  placeholder="e.g. +91 98930 11223"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label htmlFor="modals-AddClientModal-field-9" className="block text-xs font-semibold text-slate-700 mb-1">
                  Email
                </label>
                <input id="modals-AddClientModal-field-9"
                  type="email"
                  placeholder="e.g. v.joshi@cipla.com"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>
            )}
          </div>

          {/* Section B: New Requirement (optional for a new client) */}
          <div>
            <div className="border-b border-slate-200 pb-2 mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
                New Requirement{mode !== 'existing' && <span className="ml-1.5 normal-case tracking-normal font-semibold text-slate-500">(optional)</span>}
              </h4>
              {mode !== 'existing' && <p className="mt-1 text-[11px] text-slate-500">Leave blank if the client has no requirement yet. You can add one later from the client page.</p>}
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="modals-AddClientModal-field-10" className="block text-xs font-semibold text-slate-700 mb-1">
                  What do they need? {mode === 'existing' && '*'}
                </label>
                <input id="modals-AddClientModal-field-10"
                  type="text"
                  placeholder="e.g. 25 m3/hr Demineralization & UF System"
                  value={clientRequirement}
                  onChange={(e) => setClientRequirement(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  required={mode === 'existing'}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Type (tick all that apply)</label>
                <RequirementTypeField
                  categories={requirementCategories}
                  categoryOther={requirementCategoryOther}
                  onCategoriesChange={setRequirementCategories}
                  onCategoryOtherChange={setRequirementCategoryOther}
                  inputClassName="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="modals-AddClientModal-field-11" className="block text-xs font-semibold text-slate-700 mb-1">Approx. Value (₹)</label>
                  <input id="modals-AddClientModal-field-11"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={formatAmountInput(requirementValue)}
                    onChange={(e) => setRequirementValue(cleanAmountInput(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-12" className="block text-xs font-semibold text-slate-700 mb-1">
                    Stage
                  </label>
                  <select id="modals-AddClientModal-field-12"
                    value={stageOfLead}
                    onChange={(e) => setStageOfLead(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  >
                    {ENQUIRY_STAGES.filter((s) => ['NEW', 'PROPOSAL', 'NEGOTIATION'].includes(s)).map((s) => (
                      <option key={s} value={s}>
                        {stageLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-13" className="block text-xs font-semibold text-slate-700 mb-1">Details (optional)</label>
                <textarea id="modals-AddClientModal-field-13"
                  rows={2}
                  placeholder="Capacity, raw water quality, scope..."
                  value={requirementDetails}
                  onChange={(e) => setRequirementDetails(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Discussion */}
          <div>
            <div className="border-b border-slate-200 pb-2 mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
                Discussion
              </h4>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="modals-AddClientModal-field-14" className="block text-xs font-semibold text-slate-700 mb-1">
                    Activity
                  </label>
                  <select id="modals-AddClientModal-field-14"
                    value={typeOfActivity}
                    onChange={(e) => setTypeOfActivity(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  >
                    <option value="CALL">Call</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">Email</option>
                    <option value="MEETING">Meeting</option>
                    <option value="SITE_VISIT">Site Visit</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-15" className="block text-xs font-semibold text-slate-700 mb-1">
                    Outcome
                  </label>
                  <input id="modals-AddClientModal-field-15"
                    type="text"
                    placeholder="e.g. Commercial negotiation held"
                    value={callOutcome}
                    onChange={(e) => setCallOutcome(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-16" className="block text-xs font-semibold text-slate-700 mb-1">
                    Discussion Type
                  </label>
                  <select id="modals-AddClientModal-field-16"
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  >
                    <option value="INTRODUCTORY">Introductory</option>
                    <option value="TECHNICAL">Technical</option>
                    <option value="COMMERCIAL">Commercial</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-17" className="block text-xs font-semibold text-slate-700 mb-1">
                  What was discussed
                </label>
                <textarea id="modals-AddClientModal-field-17"
                  rows={2}
                  placeholder="Summary of discussion, raw water specs, delivery expectations..."
                  value={keyDiscussionPoints}
                  onChange={(e) => setKeyDiscussionPoints(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-18" className="block text-xs font-semibold text-slate-700 mb-1">
                  Remarks
                </label>
                <input id="modals-AddClientModal-field-18"
                  type="text"
                  placeholder="Special instructions, competitor details, urgency..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section C: Next Follow-up */}
          <div className="bg-sky-50/60 p-4 rounded-xl border border-sky-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-900 mb-3">
              Next Follow-up
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="modals-AddClientModal-field-19" className="block text-xs font-semibold text-slate-700 mb-1">
                  Next Action
                </label>
                <input id="modals-AddClientModal-field-19"
                  type="text"
                  placeholder="e.g. Submit revised proposal with PLC automation option"
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="modals-AddClientModal-field-20" className="block text-xs font-semibold text-slate-700 mb-1">
                  Due Date & Time
                </label>
                <input id="modals-AddClientModal-field-20"
                  type="datetime-local"
                  value={nextActionDate}
                  onChange={(e) => setNextActionDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Collapsible Additional Details */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full px-4 py-2.5 bg-slate-50 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
            >
              <span>More details (optional)</span>
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showAdvanced && (
              <div className="p-4 bg-white grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-slate-200">
                <div>
                  <label htmlFor="modals-AddClientModal-field-21" className="block text-[11px] font-semibold text-slate-600 mb-1">Client Type</label>
                  <select id="modals-AddClientModal-field-21"
                    value={clientType}
                    onChange={(e) => setClientType(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
                  >
                    <option value="End User">End User</option>
                    <option value="OEM / EPC Contractor">OEM / EPC Contractor</option>
                    <option value="Consultant">Consultant</option>
                    <option value="Trader">Trader</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-22" className="block text-[11px] font-semibold text-slate-600 mb-1">Contact Designation</label>
                  <input id="modals-AddClientModal-field-22"
                    type="text"
                    placeholder="e.g. Plant Head"
                    value={contactDesignation}
                    onChange={(e) => setContactDesignation(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-23" className="block text-[11px] font-semibold text-slate-600 mb-1">GSTIN Number</label>
                  <input id="modals-AddClientModal-field-23"
                    type="text"
                    placeholder="e.g. 27AABCT8899K1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs uppercase"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="modals-AddClientModal-field-24" className="block text-[11px] font-semibold text-slate-600 mb-1">Site Address</label>
                  <input id="modals-AddClientModal-field-24"
                    type="text"
                    placeholder="Plot / MIDC Area..."
                    value={siteAddress}
                    onChange={(e) => setSiteAddress(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="modals-AddClientModal-field-25" className="block text-[11px] font-semibold text-slate-600 mb-1">State</label>
                  <input id="modals-AddClientModal-field-25"
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full md:w-auto px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>

          <div className="w-full md:w-auto flex items-center space-x-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleSubmit('CLIENT_ONLY')}
              className="flex-1 md:flex-none border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-4 py-2 rounded-xl transition"
            >
              {mode === 'existing' ? 'Save Requirement' : 'Save Client'}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleSubmit('WITH_FOLLOWUP')}
              className="flex-1 md:flex-none bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-5 py-2 rounded-xl shadow-sm transition flex items-center justify-center space-x-1.5"
            >
              {loading ? (
                <span>Saving...</span>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>Save with Follow-up</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
