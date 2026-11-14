import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import type { AppView, CourseSettings, TrackingResult } from '../types';
import {
  normalizeOrderCode,
  requestTelegramInviteByCode,
  trackOrderByCode,
} from '../services/courseService';

interface TrackOrderViewProps {
  initialCode?: string;
  settings: CourseSettings;
  onNavigate: (view: AppView) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export default function TrackOrderView({
  initialCode = '',
  settings,
  onNavigate,
  onNotify,
}: TrackOrderViewProps) {
  const [codeInput, setCodeInput] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<TrackingResult | null>(null);

  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteError, setInviteError] = useState('');

  const performLookup = async (rawCode: string) => {
    const clean = normalizeOrderCode(rawCode);
    setErrorMsg('');
    setInviteError('');
    setInviteUrl('');

    if (!/^SUFI-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) {
      setResult(null);
      setErrorMsg('कृपया सही Unique Order Code दर्ज करें (उदाहरण: SUFI-8K29-XP51)।');
      return;
    }

    setLoading(true);
    try {
      const data = await trackOrderByCode(clean);
      setResult(data);
    } catch (err) {
      setResult(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'इस Unique Code से कोई ऑर्डर नहीं मिला।'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      setCodeInput(initialCode);
      performLookup(initialCode);
    }
  }, [initialCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performLookup(codeInput);
  };

  const handleViewNow = async () => {
    if (!result) return;
    setInviteError('');
    setInviteUrl('');
    setGeneratingInvite(true);

    try {
      const res = await requestTelegramInviteByCode(result.orderCode);
      setInviteUrl(res.inviteLink);
      onNotify(
        'success',
        'Opening Telegram Channel',
        'Redirecting to the course Telegram channel...'
      );
      try {
        if (window.top && window.top !== window) {
          window.top.location.href = res.inviteLink;
        } else {
          window.location.assign(res.inviteLink);
        }
      } catch {
        window.location.assign(res.inviteLink);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to open Telegram channel link.';
      setInviteError(msg);
      onNotify('error', 'Telegram Access Error', msg);
    } finally {
      setGeneratingInvite(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#09090B] text-white py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-white mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Homepage</span>
        </button>

        {/* Tracking Input Card */}
        <div className="bg-[#111114] border border-zinc-800 rounded-2xl p-6 sm:p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/30 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-[#E5C158]" />
            </div>
            <div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-white">
                Track Order & Unlock Course
              </h1>
              <p className="text-xs text-zinc-400">
                Enter your Unique Order Code — no login or password required.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="SUFI-8K29-XP51"
                className="w-full pl-10 pr-4 py-3.5 text-sm font-mono uppercase bg-zinc-950 border border-zinc-700 rounded-xl text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#D4AF37]"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-7 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 disabled:opacity-50 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? 'Checking...' : 'Check Status'}
            </button>
          </form>

          {errorMsg && (
            <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Status Result Card */}
        {result && (
          <div className="bg-white text-zinc-950 rounded-2xl border border-zinc-200 overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-xs font-mono text-zinc-600 tabular-nums">
                <span className="font-bold text-zinc-950">{result.orderCode}</span>
                <span aria-hidden="true">·</span>
                <span>₹{result.amount}</span>
              </div>
              <button
                type="button"
                onClick={() => performLookup(result.orderCode)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-950 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="p-6 sm:p-8">
              {/* PENDING STATE */}
              {result.status === 'PENDING' && (
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 text-amber-700 font-semibold text-sm">
                    <Clock className="w-5 h-5" />
                    <span>Verification Pending</span>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-zinc-950 leading-relaxed">
                    आपका पेमेंट अभी Admin द्वारा Verify किया जा रहा है। कृपया प्रतीक्षा करें।
                  </p>
                  <p className="text-sm text-zinc-600">
                    {settings.courseName} के लिए आपका पेमेंट कतार में है। कुछ समय बाद इसी Unique Code से दोबारा स्टेटस चेक करें।
                  </p>
                </div>
              )}

              {/* REJECTED STATE */}
              {result.status === 'REJECTED' && (
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 text-red-700 font-semibold text-sm">
                    <XCircle className="w-5 h-5" />
                    <span>Payment Rejected</span>
                  </div>
                  <p className="text-lg sm:text-xl font-bold text-zinc-950">
                    आपका पेमेंट Reject कर दिया गया है।
                  </p>
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
                    <p className="font-semibold mb-1">Admin Rejection Reason:</p>
                    <p>{result.rejectionReason || 'Payment details could not be verified.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('checkout')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
                  >
                    <span>Submit New Payment Request</span>
                  </button>
                </div>
              )}

              {/* APPROVED STATE */}
              {result.status === 'APPROVED' && (
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                        Payment Approved
                      </p>
                      <p className="text-base sm:text-lg font-bold text-emerald-950">
                        आपका पेमेंट सफलतापूर्वक Verify हो गया है।
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={generatingInvite}
                      onClick={handleViewNow}
                      className="w-full py-4 px-8 inline-flex items-center justify-center gap-3 text-base font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] via-[#F3D578] to-[#D4AF37] rounded-xl shadow-[0_8px_24px_rgba(212,175,55,0.28)] hover:brightness-105 disabled:opacity-60 transition-all cursor-pointer"
                    >
                      {generatingInvite ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Opening Telegram Channel...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-5 h-5" />
                          <span>VIEW NOW</span>
                        </>
                      )}
                    </button>
                    <p className="text-xs text-zinc-500 text-center">
                      कोर्स देखने के लिए VIEW NOW दबाएं — सीधे Telegram चैनल खुलेगा।
                    </p>
                  </div>

                  {inviteError && (
                    <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
                      {inviteError}
                    </div>
                  )}

                  {inviteUrl && (
                    <div className="p-5 rounded-xl bg-zinc-950 text-white space-y-3">
                      <p className="text-sm font-bold text-[#E5C158]">
                        Telegram Channel Link Ready
                      </p>
                      <p className="text-xs text-zinc-400">
                        यदि ऑटो-रीडायरेक्ट नहीं हुआ हो तो नीचे दिए बटन पर टैप करें।
                      </p>
                      <a
                        href={inviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-3.5 px-6 inline-flex items-center justify-center gap-2 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all"
                      >
                        <span>Open Telegram Channel</span>
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
