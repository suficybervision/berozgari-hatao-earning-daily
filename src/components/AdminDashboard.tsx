import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Lock,
  LogOut,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Table2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { CourseSettings, OrderRecord, OrderStatus, TelegramConfigStatus } from '../types';
import {
  approveOrder,
  fetchAdminTelegramStatus,
  rejectOrder,
  resetTelegramAccessGrant,
  saveAdminTelegramChannel,
  saveCourseSettings,
  subscribeAllOrders,
  uploadCourseAsset,
} from '../services/courseService';
import SecureScreenshot from './SecureScreenshot';

interface AdminDashboardProps {
  user: User | null;
  isAdmin: boolean;
  settings: CourseSettings;
  onSignIn: () => Promise<User | void>;
  onSignOut: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminDashboard({
  user,
  isAdmin,
  settings,
  onSignIn,
  onSignOut,
  onNotify,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<'orders' | 'settings'>('orders');

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');

  const [inspectOrder, setInspectOrder] = useState<OrderRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<OrderRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionBusyId, setActionBusyId] = useState('');

  const [formSettings, setFormSettings] = useState<CourseSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState<'cover' | 'qr' | null>(null);

  const [tgStatus, setTgStatus] = useState<TelegramConfigStatus | null>(null);
  const [channelIdInput, setChannelIdInput] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);

  useEffect(() => {
    setFormSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    setLoadingOrders(true);
    const unsub = subscribeAllOrders(
      (list) => {
        setOrders(list);
        setLoadingOrders(false);
      },
      (err) => {
        setLoadingOrders(false);
        onNotify('error', 'Failed to load orders', err.message);
      }
    );
    return () => unsub();
  }, [user, isAdmin, onNotify]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchAdminTelegramStatus(user)
      .then((status) => {
        setTgStatus(status);
        if (status.channelIdValue) setChannelIdInput(status.channelIdValue);
      })
      .catch(() => {
        // Non-blocking
      });
  }, [user, isAdmin]);

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#09090B] text-white flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md bg-[#111114] border border-zinc-800 rounded-2xl p-8 text-center">
          <Lock className="w-10 h-10 text-[#E5C158] mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-white mb-2">
            Admin Panel Login
          </h1>
          <p className="text-sm text-zinc-300 mb-2">
            केवल अधिकृत एडमिन Gmail अकाउंट से ही लॉगिन करें।
          </p>
          <p className="text-xs text-zinc-500 mb-6">
            Restricted `/admin` portal — only the owner&apos;s verified Google account is permitted.
          </p>
          <button
            type="button"
            onClick={() => onSignIn()}
            className="w-full py-3.5 px-6 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
          >
            Login with Admin Gmail
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#09090B] text-white flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md bg-[#111114] border border-zinc-800 rounded-2xl p-8 text-center space-y-4">
          <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="font-display text-xl font-bold text-white">
            Administrator Access Denied
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            अकाउंट ({user.email}) को एडमिन अनुमति नहीं है। कृपया केवल अपने मुख्य एडमिन Gmail से लॉगिन करें।
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={() => onSignIn()}
              className="px-5 py-2.5 text-xs font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 cursor-pointer"
            >
              Switch Gmail Account
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-zinc-200 border border-zinc-700 rounded-xl hover:border-zinc-500 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalOrders = orders.length;
  const pendingOrders = orders.filter((o) => o.status === 'PENDING').length;
  const approvedOrders = orders.filter((o) => o.status === 'APPROVED').length;
  const rejectedOrders = orders.filter((o) => o.status === 'REJECTED').length;
  const totalRevenue = orders
    .filter((o) => o.status === 'APPROVED')
    .reduce((acc, o) => acc + (Number(o.amount) || 0), 0);

  const q = searchQuery.trim().toLowerCase();
  const filteredOrders = orders.filter((ord) => {
    const matchesStatus = statusFilter === 'ALL' || ord.status === statusFilter;
    const matchesSearch =
      !q ||
      ord.orderCode.toLowerCase().includes(q) ||
      ord.utr.toLowerCase().includes(q) ||
      ord.mobile.toLowerCase().includes(q) ||
      ord.name.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  const handleApprove = async (order: OrderRecord) => {
    setActionBusyId(order.orderCode);
    try {
      await approveOrder(order.orderCode, user.uid);
      onNotify(
        'success',
        'Payment Approved',
        `Order ${order.orderCode} approved. Customer can now unlock VIEW NOW.`
      );
      if (inspectOrder?.orderCode === order.orderCode) setInspectOrder(null);
    } catch (err) {
      onNotify(
        'error',
        'Approval Failed',
        err instanceof Error ? err.message : 'Unable to approve order.'
      );
    } finally {
      setActionBusyId('');
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setActionBusyId(rejectTarget.orderCode);
    try {
      await rejectOrder(rejectTarget.orderCode, user.uid, rejectReason);
      onNotify('info', 'Order Rejected', `Order ${rejectTarget.orderCode} rejected.`);
      setRejectTarget(null);
      setRejectReason('');
      if (inspectOrder?.orderCode === rejectTarget.orderCode) setInspectOrder(null);
    } catch (err) {
      onNotify(
        'error',
        'Rejection Failed',
        err instanceof Error ? err.message : 'Unable to reject order.'
      );
    } finally {
      setActionBusyId('');
    }
  };

  const handleResetInvite = async (orderCode: string) => {
    setActionBusyId(orderCode);
    try {
      await resetTelegramAccessGrant(user, orderCode);
      onNotify(
        'success',
        'Telegram Invite Lock Reset',
        `${orderCode} can generate one fresh Telegram link.`
      );
    } catch (err) {
      onNotify(
        'error',
        'Reset Failed',
        err instanceof Error ? err.message : 'Could not reset invite lock.'
      );
    } finally {
      setActionBusyId('');
    }
  };

  const handleAssetUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    kind: 'cover' | 'qr'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAsset(kind);
    try {
      const url = await uploadCourseAsset(file, user, kind);
      setFormSettings((prev) =>
        kind === 'cover' ? { ...prev, courseCoverUrl: url } : { ...prev, qrCodeUrl: url }
      );
      onNotify('success', 'Image Uploaded', 'Click Save Course Settings to publish changes.');
    } catch (err) {
      onNotify(
        'error',
        'Upload Failed',
        err instanceof Error ? err.message : 'Could not upload image.'
      );
    } finally {
      setUploadingAsset(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await saveCourseSettings(formSettings);
      onNotify('success', 'Course Settings Saved', 'Live storefront updated immediately.');
    } catch (err) {
      onNotify(
        'error',
        'Save Failed',
        err instanceof Error ? err.message : 'Unable to save settings.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTelegram(true);
    try {
      const res = await saveAdminTelegramChannel(user, channelIdInput);
      const updatedStatus = await fetchAdminTelegramStatus(user);
      setTgStatus(updatedStatus);
      onNotify(
        'success',
        'Telegram Channel Saved',
        res.chatTitle
          ? `Verified connection with "${res.chatTitle}".`
          : 'Channel ID saved on backend.'
      );
    } catch (err) {
      onNotify(
        'error',
        'Telegram Config Error',
        err instanceof Error ? err.message : 'Could not verify Telegram Channel ID.'
      );
    } finally {
      setSavingTelegram(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#F8F8FA] text-zinc-950 py-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Admin Header & Tab Switcher */}
        <div className="bg-[#09090B] text-white rounded-2xl p-6 border border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#E5C158] mb-1">
              Admin Verification Desk · {user.email}
            </p>
            <h1 className="font-display text-2xl font-bold text-white">
              Orders & Platform Control
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setTab('orders')}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  tab === 'orders'
                    ? 'bg-[#D4AF37] text-[#09090B]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Orders ({pendingOrders} Pending)</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('settings')}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  tab === 'settings'
                    ? 'bg-[#D4AF37] text-[#09090B]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Course & Telegram Settings</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-300 border border-zinc-700 rounded-xl hover:text-white hover:border-zinc-500 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {tab === 'orders' ? (
          <>
            {/* 5-Column KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="bg-white rounded-xl border border-zinc-200 p-5">
                <p className="text-xs font-medium text-zinc-500">Total Orders</p>
                <p className="mt-2 font-mono text-2xl font-bold text-zinc-950 tabular-nums">
                  {totalOrders}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-5">
                <p className="text-xs font-medium text-amber-700">Pending Orders</p>
                <p className="mt-2 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                  {pendingOrders}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-5">
                <p className="text-xs font-medium text-emerald-700">Approved Orders</p>
                <p className="mt-2 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                  {approvedOrders}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-zinc-200 p-5">
                <p className="text-xs font-medium text-red-700">Rejected Orders</p>
                <p className="mt-2 font-mono text-2xl font-bold text-red-700 tabular-nums">
                  {rejectedOrders}
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1 bg-[#09090B] text-white rounded-xl border border-zinc-800 p-5">
                <p className="text-xs font-medium text-[#E5C158]">Total Verified Revenue</p>
                <p className="mt-2 font-mono text-2xl font-bold text-white tabular-nums">
                  ₹{totalRevenue.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {/* Search & Filter Toolbar */}
            <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-zinc-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by Unique Code, UTR, or Mobile..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-xl">
                  {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                        statusFilter === st
                          ? 'bg-white text-zinc-950 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-950'
                      }`}
                    >
                      {st === 'ALL'
                        ? 'All Orders'
                        : st === 'PENDING'
                          ? 'Pending'
                          : st === 'APPROVED'
                            ? 'Approved'
                            : 'Rejected'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-3 bg-amber-50/70 border-b border-zinc-200 text-xs text-amber-900">
                Verification Protocol: Always confirm the actual ₹{settings.coursePrice} credit in your bank/UPI app matching the UTR number before clicking APPROVE.
              </div>

              {loadingOrders ? (
                <div className="p-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#9A7411] mx-auto mb-2" />
                  <p className="text-sm text-zinc-500">Loading orders...</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-12 text-center text-sm text-zinc-500">
                  No orders match your current search or filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                        <th className="py-3 px-4 whitespace-nowrap">Unique Order Code</th>
                        <th className="py-3 px-4 whitespace-nowrap">Customer Name</th>
                        <th className="py-3 px-4 whitespace-nowrap">Mobile Number</th>
                        <th className="py-3 px-4 whitespace-nowrap">UTR Number</th>
                        <th className="py-3 px-4 whitespace-nowrap">Screenshot</th>
                        <th className="py-3 px-4 whitespace-nowrap">Order Date</th>
                        <th className="py-3 px-4 whitespace-nowrap">Payment Status</th>
                        <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 text-xs">
                      {filteredOrders.map((ord) => (
                        <tr key={ord.orderCode} className="hover:bg-zinc-50/80">
                          <td className="py-3 px-4 font-mono font-bold text-zinc-950 whitespace-nowrap tabular-nums">
                            {ord.orderCode}
                          </td>
                          <td className="py-3 px-4 font-medium text-zinc-900 whitespace-nowrap">
                            {ord.name}
                          </td>
                          <td className="py-3 px-4 font-mono text-zinc-700 whitespace-nowrap tabular-nums">
                            {ord.mobile}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-zinc-900 whitespace-nowrap tabular-nums">
                            {ord.utr}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setInspectOrder(ord)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold text-zinc-800 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>
                          </td>
                          <td className="py-3 px-4 text-zinc-500 whitespace-nowrap tabular-nums">
                            {formatDate(ord.createdAt)}
                          </td>
                          <td className="py-3 px-4 font-semibold whitespace-nowrap">
                            {ord.status === 'APPROVED' && (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                APPROVED
                              </span>
                            )}
                            {ord.status === 'PENDING' && (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <Clock className="w-3.5 h-3.5" />
                                PENDING
                              </span>
                            )}
                            {ord.status === 'REJECTED' && (
                              <span className="inline-flex items-center gap-1 text-red-700">
                                <XCircle className="w-3.5 h-3.5" />
                                REJECTED
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {ord.status !== 'APPROVED' ? (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={actionBusyId === ord.orderCode}
                                  onClick={() => handleApprove(ord)}
                                  className="px-3 py-1.5 font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                  {actionBusyId === ord.orderCode ? '...' : 'APPROVE'}
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusyId === ord.orderCode}
                                  onClick={() => {
                                    setRejectTarget(ord);
                                    setRejectReason(ord.rejectionReason || '');
                                  }}
                                  className="px-3 py-1.5 font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer"
                                >
                                  REJECT
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={actionBusyId === ord.orderCode}
                                onClick={() => handleResetInvite(ord.orderCode)}
                                title="Reset Telegram invite lock if user's link expired"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 border border-zinc-200 rounded-lg hover:text-zinc-950 hover:border-zinc-400 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reset Invite</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          /* SETTINGS TAB */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleSaveSettings}
              className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 p-6 sm:p-7 space-y-5"
            >
              <div className="border-b border-zinc-200 pb-4">
                <h2 className="font-display text-lg font-bold text-zinc-950">
                  Course & UPI Payment Configuration
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Changes update the public landing page and checkout immediately.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Course Name
                </label>
                <input
                  type="text"
                  required
                  value={formSettings.courseName}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, courseName: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Course Description
                </label>
                <textarea
                  rows={3}
                  required
                  value={formSettings.courseDescription}
                  onChange={(e) =>
                    setFormSettings({ ...formSettings, courseDescription: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Current Course Price (₹)
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={formSettings.coursePrice}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        coursePrice: Number(e.target.value) || 99,
                      })
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Original Promotional Price (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formSettings.originalPrice}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        originalPrice: Number(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formSettings.showOriginalPrice}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        showOriginalPrice: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#9A7411]"
                  />
                  <span>Show Crossed-Out Original Price (₹{formSettings.originalPrice})</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formSettings.isAvailable}
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        isAvailable: e.target.checked,
                      })
                    }
                    className="w-4 h-4 accent-[#9A7411]"
                  />
                  <span>Course Available for Purchase</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    UPI ID
                  </label>
                  <input
                    type="text"
                    required
                    value={formSettings.upiId}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, upiId: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    WhatsApp Support Number (with country code)
                  </label>
                  <input
                    type="text"
                    value={formSettings.whatsappNumber}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, whatsappNumber: e.target.value })
                    }
                    placeholder="e.g., 919876543210"
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Course Cover Banner URL (or Upload)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formSettings.courseCoverUrl}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, courseCoverUrl: e.target.value })
                    }
                    className="flex-1 px-3.5 py-2.5 text-xs font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                  <label className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-zinc-950 text-white rounded-xl hover:bg-zinc-800 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingAsset === 'cover' ? 'Uploading...' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => handleAssetUpload(e, 'cover')}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Custom Payment QR Code URL (leave empty to auto-generate from UPI ID)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formSettings.qrCodeUrl}
                    onChange={(e) =>
                      setFormSettings({ ...formSettings, qrCodeUrl: e.target.value })
                    }
                    placeholder="Auto-generated live from UPI ID if blank"
                    className="flex-1 px-3.5 py-2.5 text-xs font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                  <label className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-zinc-950 text-white rounded-xl hover:bg-zinc-800 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingAsset === 'qr' ? 'Uploading...' : 'Upload QR'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => handleAssetUpload(e, 'qr')}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 disabled:opacity-50 transition-all cursor-pointer"
              >
                {savingSettings ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{savingSettings ? 'Saving...' : 'Save Course Settings'}</span>
              </button>
            </form>

            {/* Telegram Bot & Channel Integration Panel */}
            <div className="lg:col-span-5 bg-[#09090B] text-white rounded-2xl border border-zinc-800 p-6 sm:p-7 space-y-5">
              <div className="border-b border-zinc-800 pb-4">
                <p className="text-xs font-medium text-[#E5C158] mb-1">Backend Security</p>
                <h2 className="font-display text-lg font-bold text-white">
                  Private Telegram Integration
                </h2>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">TELEGRAM_BOT_TOKEN (Server Secret)</span>
                  <span
                    className={`font-semibold ${
                      tgStatus?.botTokenConfigured ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {tgStatus?.botTokenConfigured ? 'Configured' : 'Missing in Env'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
                  <span className="text-zinc-400">Telegram Channel ID</span>
                  <span
                    className={`font-mono ${
                      tgStatus?.channelIdConfigured ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {tgStatus?.channelIdConfigured ? tgStatus.channelIdMasked : 'Not Set'}
                  </span>
                </div>
              </div>

              <form onSubmit={handleSaveTelegram} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Private Telegram Channel ID (Numeric Chat ID)
                  </label>
                  <input
                    type="text"
                    required
                    value={channelIdInput}
                    onChange={(e) => setChannelIdInput(e.target.value)}
                    placeholder="e.g., -1001234567890"
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#D4AF37]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingTelegram}
                  className="w-full py-3 px-5 text-xs font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {savingTelegram ? 'Verifying & Saving...' : 'Verify & Save Channel ID'}
                </button>
              </form>

              <div className="pt-4 border-t border-zinc-800 text-xs text-zinc-400 space-y-2 leading-relaxed">
                <p className="font-semibold text-zinc-200">Setup Checklist:</p>
                <p>1. Set <code className="text-zinc-200">TELEGRAM_BOT_TOKEN</code> in server environment secrets.</p>
                <p>2. Make the bot an <strong>Administrator</strong> in your private Telegram channel with <em>Invite Users via Link</em> permission.</p>
                <p>3. Enter the numeric channel ID (starts with <code className="text-zinc-200">-100</code>) above. Each approved Unique Code generates a single-use <code className="text-zinc-200">member_limit=1</code> link once.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Screenshot Inspection Modal */}
      {inspectOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-[#111114] text-white rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <p className="text-sm font-bold text-white font-mono">{inspectOrder.orderCode}</p>
                <p className="text-xs font-mono text-[#E5C158] tabular-nums">
                  {inspectOrder.name} · {inspectOrder.mobile} · ₹{inspectOrder.amount} · UTR: {inspectOrder.utr}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectOrder(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 max-h-[65vh] overflow-y-auto">
              <SecureScreenshot
                src={inspectOrder.screenshotUrl}
                alt={`Payment screenshot for ${inspectOrder.orderCode}`}
                user={user}
                className="w-full max-h-[55vh] object-contain rounded-xl mx-auto"
              />
            </div>

            {inspectOrder.status !== 'APPROVED' && (
              <div className="px-6 py-4 bg-zinc-950 border-t border-zinc-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRejectTarget(inspectOrder);
                    setRejectReason(inspectOrder.rejectionReason || '');
                  }}
                  className="px-4 py-2 text-xs font-semibold text-red-400 border border-red-900/60 rounded-lg hover:bg-red-950/50 cursor-pointer"
                >
                  REJECT
                </button>
                <button
                  type="button"
                  disabled={actionBusyId === inspectOrder.orderCode}
                  onClick={() => handleApprove(inspectOrder)}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  {actionBusyId === inspectOrder.orderCode ? 'Approving...' : 'APPROVE'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rejection Reason Modal */}
      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmReject}
            className="w-full max-w-md bg-white text-zinc-950 rounded-2xl border border-zinc-200 overflow-hidden shadow-2xl"
          >
            <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold">
                Reject Order {rejectTarget.orderCode}
              </h3>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-xs text-zinc-600">
                UTR: <span className="font-mono font-semibold">{rejectTarget.utr}</span>
              </p>
              <div>
                <label className="block text-xs font-semibold text-zinc-800 mb-1.5">
                  Rejection Reason (shown when customer tracks this code) *
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g., UTR not found in bank statement, or screenshot amount does not match ₹99."
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:text-zinc-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusyId === rejectTarget.orderCode}
                className="px-5 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {actionBusyId === rejectTarget.orderCode ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
