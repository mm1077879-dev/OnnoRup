import React, { useEffect, useMemo, useState } from 'react';
import { useAppSelector, useAppDispatch } from '../../app/hooks';
import { addToast } from '../../features/toast/toastSlice';
import { Search, CheckCircle2, XCircle, Loader2, ShieldAlert, ArrowUpRight } from 'lucide-react';

const FILTERS = [
  { value: 'all', label: 'All Requests' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
] as const;

export const CancellationRequestsAdminPage: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const dispatch = useAppDispatch();
  const { token } = useAppSelector((state) => state.auth);

  const [requests, setRequests] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]['value']>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const loadRequests = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const response = await fetch(`/api/admin/cancellation-requests${params.size ? `?${params.toString()}` : ''}`, {
        headers,
      });
      const data = await response.json();
      if (data.success) {
        setRequests(data.data || []);
      } else {
        dispatch(
          addToast({
            type: 'error',
            title: 'Cancellation requests unavailable',
            message: data.error || 'Unable to load cancellation requests.',
          })
        );
      }
    } catch (error) {
      dispatch(addToast({ type: 'error', title: 'Load failed', message: 'Unable to fetch cancellation requests.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [token, statusFilter, search]);

  const handleDecision = async (requestId: string, action: 'approve' | 'reject', reason: string) => {
    if (!token) return;
    setActingId(requestId);
    try {
      const response = await fetch(`/api/orders/admin/cancellation-requests/${requestId}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to ${action} request.`);
      }
      dispatch(
        addToast({
          type: 'success',
          title: action === 'approve' ? 'Request approved' : 'Request rejected',
          message: data.message || 'Decision recorded.',
        })
      );
      onRefresh();
      await loadRequests();
    } catch (error: any) {
      dispatch(addToast({ type: 'error', title: 'Decision failed', message: error.message || 'Unable to complete this decision.' }));
    } finally {
      setActingId(null);
    }
  };

  const statusClasses: Record<string, string> = {
    pending_approval: 'bg-amber-100 text-amber-800 border border-amber-200',
    approved: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    rejected: 'bg-rose-100 text-rose-800 border border-rose-200',
    withdrawn: 'bg-slate-200 text-slate-700 border border-slate-300',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Operations</p>
            <h1 className="text-2xl font-bold text-slate-900">Cancellation Requests</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          {requests.filter((req) => req.status === 'pending_approval').length} pending review
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === filter.value
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <label className="relative block w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by order, email, or reason"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none ring-0 transition focus:border-emerald-500 focus:bg-white"
            />
          </label>
        </div>

        {loading ? (
          <div className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading cancellation requests...
          </div>
        ) : requests.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center text-sm text-slate-500">
            No cancellation requests match the selected filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-[0.15em] text-slate-500">
                  <th className="px-3 py-3 font-semibold">Order</th>
                  <th className="px-3 py-3 font-semibold">Customer</th>
                  <th className="px-3 py-3 font-semibold">Reason</th>
                  <th className="px-3 py-3 font-semibold">Requested</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request._id || request.id} className="border-b border-slate-100 align-top last:border-b-0">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                        <span>{request.orderNumber || 'N/A'}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-800">{request.customerName || 'Customer'}</div>
                      <div className="text-xs text-slate-500">{request.customerEmail || 'No email recorded'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-xs font-medium text-slate-700">{request.reason || 'No reason provided'}</div>
                      {request.detail && <div className="mt-1 max-w-xs text-xs text-slate-500">{request.detail}</div>}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {request.requestedAt ? new Date(request.requestedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses[request.status] || 'bg-slate-100 text-slate-700'}`}>
                        {request.status?.replace('_', ' ') || 'unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {request.status === 'pending_approval' ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={actingId === (request._id || request.id)}
                            onClick={() => handleDecision(request._id || request.id, 'approve', 'Approved by admin review')}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
                          >
                            {actingId === (request._id || request.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actingId === (request._id || request.id)}
                            onClick={() => handleDecision(request._id || request.id, 'reject', 'Rejected by admin review')}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                          >
                            {actingId === (request._id || request.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                            Reject
                          </button>
                        </div>
                      ) : (
                        <div className="text-right text-xs text-slate-500">No action required</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
