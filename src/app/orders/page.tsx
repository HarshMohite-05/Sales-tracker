'use client';

import React, { useState, useEffect } from 'react';
import LoadError from '@/components/ui/LoadError';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';
import { AlertTriangle, Trash2 } from 'lucide-react';
import OrderDetails from '@/components/orders/OrderDetails';
import LostOrders from '@/components/orders/LostOrders';
import { useRecordFilters } from '@/components/ui/RecordFilter';
import RecordSearch from '@/components/ui/RecordSearch';

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [lost, setLost] = useState<any[]>([]);
  const orderFilter = useRecordFilters(orders);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  async function loadData() {
    setLoadError(null);
    setLoading(true);
    try {
      const [res, lostRes] = await Promise.all([fetch('/api/orders'), fetch('/api/enquiries?stage=LOST')]);
      if (!res.ok) throw new Error(`Unable to load records (${res.status}). Please try again.`);
      if (res.ok) setOrders((await res.json()).orders || []);
      if (!lostRes.ok) throw new Error('Unable to load lost requirements. Please try again.');
      if (lostRes.ok) setLost((await lostRes.json()).enquiries || []);
    } catch (error: any) { setLoadError(error.message || 'Connection failed. Please try again.'); }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUserRole(data?.user?.role ?? null))
      .catch(() => {});
  }, []);

  return (
    <AppShell>
      <div className="space-y-5">
        <LoadError message={loadError} onRetry={loadData} />
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Orders</h1>
          <span className="text-xs font-semibold text-slate-500">
            {orders.length} confirmed · {lost.length} lost
          </span>
        </div>

        <RecordSearch {...orderFilter} />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden divide-y divide-slate-100">
          {loadError ? null : loading ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading...</div>
          ) : orderFilter.rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">{orders.length ? 'No orders match these filters.' : 'No orders yet.'}</div>
          ) : (
            orderFilter.rows.map((ord) => (
              <div key={ord.id} className="p-5 flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs">
                <div className="flex-1 min-w-0">
                  <OrderDetails order={ord} showClient />
                </div>

                <div className="self-start flex flex-col items-end gap-2">
                  {/* Payments are ticked off on the client's Payments tab */}
                  <Link
                    href={`/clients/${ord.clientId}?tab=payments`}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl font-semibold text-xs"
                  >
                    Open
                  </Link>
                  <DeleteOrder order={ord} onDeleted={loadData} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Lost orders: requirements marked Order Lost */}
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-slate-900">Lost Orders</h2>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4">
            {loading ? <p className="text-xs text-slate-500">Loading...</p> : <LostOrders enquiries={lost} showClient />}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** Delete for one accessible order; it moves to the Recycle Bin. Orders with payments that count can't be deleted. */
function DeleteOrder({ order, onDeleted }: { order: any; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete');
      setConfirming(false);
      onDeleted();
    } catch (err: any) {
      setError(err.message);
    }
    setDeleting(false);
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => {
          setConfirming(true);
          setError(null);
        }}
        className="text-slate-500 hover:text-rose-600 font-semibold flex items-center space-x-1"
      >
        <Trash2 className="h-3.5 w-3.5" />
        <span>Delete</span>
      </button>
    );
  }

  return (
    <div className="w-64 p-2.5 rounded-lg border border-rose-200 bg-rose-50 space-y-2 text-left">
      <p className="font-bold text-rose-800 flex items-center space-x-1.5">
        <AlertTriangle className="h-4 w-4" />
        <span>Delete order {order.orderNumber}?</span>
      </p>
      <p className="text-rose-700">
        Its quotation goes back to Approved and its requirement back to the stage before Won. It moves to the Recycle Bin,
        where you can restore it for 5 days.
      </p>
      {error && <p className="font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="px-3 py-1 rounded-lg border border-slate-300 bg-white font-semibold text-slate-700"
        >
          No, keep it
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
        >
          {deleting ? 'Deleting...' : 'Yes, delete'}
        </button>
      </div>
    </div>
  );
}
