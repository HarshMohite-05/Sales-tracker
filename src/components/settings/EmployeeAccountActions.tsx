'use client';
import { useState } from 'react';

export default function EmployeeAccountActions({ employee, users, onChanged }: { employee: any; users: any[]; onChanged: () => void }) {
  const [mode, setMode] = useState<'reset' | 'remove' | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const open = (next: 'reset' | 'remove') => { setMode(next); setPassword(''); setConfirm(''); setError(''); setMessage(''); setAssignee(''); };
  return <div className="mt-2 text-xs">
    {employee.passwordResetRequestedAt && <p role="status" className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">Password reset requested · {new Date(employee.passwordResetRequestedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. Verify this employee’s identity before resetting.</p>}
    <div className="flex flex-wrap gap-3">
      {employee.isActive && <button type="button" onClick={()=>open('reset')} className="font-semibold text-sky-700">Reset password</button>}
      <button type="button" onClick={()=>open('remove')} className="font-semibold text-rose-700">Remove employee</button>
    </div>
    {message && <p role="status" className="mt-2 text-emerald-700">{message}</p>}
    {mode && <form className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={async e=>{
      e.preventDefault(); setError(''); setMessage('');
      if(mode==='reset' && password!==confirm){setError('Passwords do not match');return;}
      setBusy(true);
      try {
        const res=await fetch(mode==='reset'?'/api/settings/users/password':'/api/settings/users',{method:mode==='reset'?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode==='reset'?{userId:employee.id,newPassword:password}:{userId:employee.id,reassignToSalespersonId:assignee||undefined})});
        const data=await res.json();if(!res.ok)throw new Error(data.error);
        setPassword('');setConfirm('');setMode(null);setMessage(data.message);onChanged();
      } catch(err:any){setError(err.message||'Could not save');} finally{setBusy(false);}
    }}>
      <h3 className="font-bold text-slate-900">{mode==='reset'?'Reset password':'Remove employee'} · {employee.name}</h3>
      {mode==='reset'?<>
        <p className="text-slate-500">Existing passwords cannot be viewed. Set a new password and share it with the employee. Their existing sessions will end.</p>
        <label className="block text-slate-700">New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
        <label className="block text-slate-700">Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e=>setConfirm(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      </>:<>
        <p className="text-slate-600">This removes their login, name, email, phone and designation from the account. Company records and historical activity remain linked to a former-employee identity. This cannot be undone.</p>
        <label className="block text-slate-700">Reassign clients and unfinished work<select value={assignee} onChange={e=>setAssignee(e.target.value)} className="mt-1 block w-full rounded border bg-white p-2"><option value="">No reassignment (only if no assigned work)</option>{users.filter(u=>u.id!==employee.id&&u.isActive&&u.role==='SALESPERSON').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="flex items-start gap-2 text-slate-700"><input type="checkbox" required />I confirm this employee has left and their account should be removed.</label>
      </>}
      {error&&<p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex gap-3"><button disabled={busy} className={`rounded-lg px-3 py-2 font-semibold text-white disabled:opacity-50 ${mode==='reset'?'bg-sky-600':'bg-rose-600'}`}>{busy?'Saving…':mode==='reset'?'Save new password':'Confirm removal'}</button><button type="button" disabled={busy} onClick={()=>{setMode(null);setPassword('');setConfirm('');}} className="text-slate-600">Cancel</button></div>
    </form>}
  </div>;
}
