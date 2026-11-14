import { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Send,
  X,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AppView, CourseSettings, OrderRecord } from '../types';
import { requestTelegramInvite } from '../services/courseService';
import SecureScreenshot from './SecureScreenshot';

interface UserDashboardProps {
  user: User | null;
  orders: OrderRecord[];
  loadingOrders: boolean;
  settings: CourseSettings;
  onSignIn: () => Promise<User | void>;
  onSignOut: () => Promise<void>;
  onNavigate: (view: AppView) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

function formatDate(date: Date | null): string {
  if (!date) return 'Just now';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function UserDashboard({
  user,
  orders,
  loadingOrders,
  settings,
  onSignIn,
  onSignOut,
  onNavigate,
  onNotify,
}: UserDashboardProps) {
  const [generatingOrderId, setGeneratingOrderId] = useState<string>('');
  const [telegramResult, setTelegramResult] = useState<{
    orderId: string;
    inviteLink: string;
    expiresAt: number;
  } | null>(null);
  const [telegramError, setTelegramError] = useState<string>('');
  const [previewOrder, setPreviewOrder] = useState<OrderRecord | null>(null);

  if (!user) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#09090B] text-white flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md bg-[#111114] border border-zinc-800 rounded-2xl p-8 text-center">
          <Lock className="w-10 h-10 text-[#E5C158] mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold text-white mb-2">
            Student Access Dashboard
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed mb-6">
            Sign in with the Google account you used during checkout to check your payment status or unlock your private Telegram invite link.
          </p>
          <button
            type="button"
            onClick={() => onSignIn()}
            className="w-full py-3.5 px-6 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const approvedOrder = orders.find((o) => o.status === 'APPROVED') || null;
  const latestOrder = approvedOrder || orders[0] || null;

  const handleViewNow = async (order: OrderRecord) => {
    setTelegramError('');
    setTelegramResult(null);
    setGeneratingOrderId(order.orderId);

    try {
      const result = await requestTelegramInvite(order.orderId, user);
      setTelegramResult({
        orderId: order.orderId,
        inviteLink: result.inviteLink,
        expiresAt: result.expiresAt,
      });
      onNotify('success', 'Private Invite Ready', 'Single-use Telegram channel link generated.');
      window.location.href = result.inviteLink;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not generate Telegram invite link.';
      setTelegramError(msg);
      onNotify('error', 'Telegram Access Error', msg);
    } finally {
      setGeneratingOrderId('');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#FAFAFA] text-zinc-950 py-10 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Top User Header */}
        <div className="bg-[#09090B] text-white rounded-2xl p-6 sm:p-8 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#E5C158] mb-1">Student Dashboard</p>
            <h1 className="font-display text-2xl font-bold text-white">
              {latestOrder?.name || user.displayName || 'Enrolled Student'}
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">{user.email}</p>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-zinc-300 border border-zinc-700 rounded-xl hover:text-white hover:border-zinc-500 transition-colors self-start sm:self-auto cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Loading State */}
        {loadingOrders ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-[#9A7411] mx-auto mb-3" />
            <p className="text-sm text-zinc-600">Loading your course enrollment status...</p>
          </div>
        ) : !latestOrder ? (
          /* Empty State: No Order Submitted Yet */
          <div className="bg-white rounded-2xl border border-zinc-200 p-8 sm:p-10 text-center">
            <p className="font-display text-xl font-bold text-zinc-950 mb-2">
              No Course Order Found
            </p>
            <p className="text-sm text-zinc-600 max-w-md mx-auto mb-6">
              You have not submitted a payment verification request for "{settings.courseName}" yet.
            </p>
            <button
              type="button"
              disabled={!settings.isAvailable}
              onClick={() => onNavigate('checkout')}
              className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 disabled:opacity-50 transition-all cursor-pointer tabular-nums"
            >
              <span>BUY NOW — ₹{settings.coursePrice}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          /* Active Order Status Card */
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="p-6 sm:p-8 border-b border-zinc-200 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 font-mono tabular-nums">
                  <span>Order ID: {latestOrder.orderId}</span>
                  <span aria-hidden="true">·</span>
                  <span>UTR: {latestOrder.utr}</span>
                  <span aria-hidden="true">·</span>
                  <span>₹{latestOrder.amount}</span>
                </div>

                <h2 className="font-display text-xl sm:text-2xl font-bold text-zinc-950">
                  {settings.courseName}
                </h2>

                <div className="flex flex-wrap items-center gap-6 pt-1 text-sm">
                  <div>
                    <span className="text-zinc-500 mr-2">Payment Status:</span>
                    {latestOrder.status === 'APPROVED' && (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        APPROVED
                      </span>
                    )}
                    {latestOrder.status === 'PENDING' && (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                        <Clock className="w-4 h-4" />
                        Payment Under Review
                      </span>
                    )}
                    {latestOrder.status === 'REJECTED' && (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                        <XCircle className="w-4 h-4" />
                        REJECTED
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-zinc-500 mr-2">Course Access Status:</span>
                    <span
                      className={`font-semibold ${
                        latestOrder.status === 'APPROVED' ? 'text-emerald-700' : 'text-zinc-700'
                      }`}
                    >
                      {latestOrder.status === 'APPROVED' ? 'Unlocked' : 'Locked'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Area based on Status */}
              <div className="shrink-0">
                {latestOrder.status === 'APPROVED' && (
                  <button
                    type="button"
                    disabled={generatingOrderId === latestOrder.orderId}
                    onClick={() => handleViewNow(latestOrder)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 text-base font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] via-[#F3D578] to-[#D4AF37] rounded-xl shadow-[0_8px_24px_rgba(212,175,55,0.28)] hover:brightness-105 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    {generatingOrderId === latestOrder.orderId ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Generating Private Invite...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        <span>VIEW NOW</span>
                      </>
                    )}
                  </button>
                )}

                {latestOrder.status === 'PENDING' && (
                  <div className="px-5 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800 inline-flex items-center gap-2">
                    <Clock className="w-4 h-4 shrink-0" />
                    <span>Payment Under Review</span>
                  </div>
                )}

                {latestOrder.status === 'REJECTED' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('checkout')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Submit New Payment Request</span>
                  </button>
                )}
              </div>
            </div>

            {/* Contextual Details Banner */}
            {latestOrder.status === 'PENDING' && (
              <div className="px-6 py-4 bg-zinc-50 text-sm text-zinc-600">
                Our admin team is verifying your UPI transaction ({latestOrder.utr}). Once approved, this page will automatically reveal your golden <strong>VIEW NOW</strong> button.
              </div>
            )}

            {latestOrder.status === 'REJECTED' && (
              <div className="px-6 py-4 bg-red-50 border-t border-red-100 text-sm text-red-800 flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Rejection Reason:</p>
                  <p className="mt-0.5">{latestOrder.rejectionReason || 'Payment could not be verified.'}</p>
                </div>
              </div>
            )}

            {telegramError && (
              <div className="px-6 py-4 bg-red-50 border-t border-red-200 text-sm text-red-800">
                {telegramError}
              </div>
            )}

            {telegramResult && (
              <div className="px-6 py-5 bg-emerald-50 border-t border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-emerald-950">
                    Single-Use Private Telegram Invite Generated
                  </p>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Valid for 1 member join · Expires in 10 minutes. Click below if Telegram did not open automatically.
                  </p>
                </div>
                <a
                  href={telegramResult.inviteLink}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold bg-zinc-950 text-white rounded-lg hover:bg-zinc-800 transition-colors shrink-0"
                >
                  <span>Open Telegram Channel</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Order History Table */}
        {orders.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200">
              <h3 className="font-display text-base font-bold text-zinc-950">
                Your Payment History
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold text-zinc-500 bg-zinc-50">
                    <th className="py-3 px-4 whitespace-nowrap">Order ID</th>
                    <th className="py-3 px-4 whitespace-nowrap">UTR</th>
                    <th className="py-3 px-4 whitespace-nowrap text-right">Amount</th>
                    <th className="py-3 px-4 whitespace-nowrap">Submitted</th>
                    <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3 px-4 whitespace-nowrap text-right">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 text-sm">
                  {orders.map((ord) => (
                    <tr key={ord.orderId} className="hover:bg-zinc-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-zinc-900 whitespace-nowrap tabular-nums">
                        {ord.orderId}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-700 whitespace-nowrap tabular-nums">
                        {ord.utr}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-900 text-right whitespace-nowrap tabular-nums">
                        ₹{ord.amount}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 whitespace-nowrap tabular-nums">
                        {formatDate(ord.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                        {ord.status === 'APPROVED' && (
                          <span className="text-emerald-700">Approved</span>
                        )}
                        {ord.status === 'PENDING' && (
                          <span className="text-amber-700">Pending Review</span>
                        )}
                        {ord.status === 'REJECTED' && (
                          <span className="text-red-700">Rejected</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPreviewOrder(ord)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-zinc-950 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Screenshot</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Screenshot Viewer Modal */}
      {previewOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg bg-[#111114] text-white rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <p className="text-sm font-bold">{previewOrder.orderId}</p>
                <p className="text-xs font-mono text-zinc-400">UTR: {previewOrder.utr}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOrder(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 max-h-[75vh] overflow-y-auto">
              <SecureScreenshot
                src={previewOrder.screenshotUrl}
                alt={`Payment screenshot for ${previewOrder.orderId}`}
                user={user}
                className="w-full max-h-[60vh] object-contain rounded-xl mx-auto"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
