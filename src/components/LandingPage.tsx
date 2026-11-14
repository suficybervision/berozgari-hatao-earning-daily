import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Lock,
  MessageCircle,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { AppView, CourseSettings, OrderRecord } from '../types';
import type { LegalDocType } from './LegalModal';
import { trackOrderById } from '../services/courseService';

interface LandingPageProps {
  settings: CourseSettings;
  user: User | null;
  isAdmin: boolean;
  hasApprovedOrder: boolean;
  onBuyNow: () => void;
  onNavigate: (view: AppView) => void;
  onSignIn: () => Promise<void>;
  onOpenLegal: (doc: LegalDocType) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

const BENEFITS = [
  {
    num: '01',
    title: 'Step-by-step video tutorial',
    subtitle: 'Clear Hindi & visual walkthroughs from zero to execution without skipping critical setup steps.',
  },
  {
    num: '02',
    title: 'Complete tools and resources',
    subtitle: 'Curated checklists, templates, AI & productivity workflows, and verified resource links included.',
  },
  {
    num: '03',
    title: 'Beginner-friendly guidance',
    subtitle: 'Built for students, freelancers, and first-time earners with no prior technical background needed.',
  },
  {
    num: '04',
    title: 'Practical earning methods',
    subtitle: 'Actionable digital skill workflows and client acquisition frameworks you can apply immediately.',
  },
  {
    num: '05',
    title: 'Private Telegram community access',
    subtitle: 'Verified one-time entry link to our private members-only Telegram channel with updates and guidance.',
  },
];

const TRUST_ITEMS = [
  {
    num: '01',
    title: 'Secure payment verification',
    description:
      'Every ₹99 UPI transaction is cross-checked against its unique UTR reference number and uploaded payment screenshot.',
  },
  {
    num: '02',
    title: 'Admin-approved access',
    description:
      'Orders are reviewed manually by our verification desk against bank and UPI settlement records to prevent fraud.',
  },
  {
    num: '03',
    title: 'Instant access after approval',
    description:
      'The moment your payment is approved, your dashboard unlocks a single-use private Telegram channel invite link.',
  },
];

const FAQS = [
  {
    q: 'How do I receive course access after paying ₹99?',
    a: 'Pay ₹99 via UPI ID or QR code on the checkout page, enter your 12-digit UTR / Transaction Reference Number, and upload the payment screenshot. Once our admin verifies your payment, your User Dashboard displays a golden VIEW NOW button to generate your private Telegram link.',
  },
  {
    q: 'Where do I find my UTR / Transaction Reference Number?',
    a: 'Open PhonePe, Google Pay, Paytm, or BHIM and tap your completed ₹99 payment receipt. Look for the 12-digit "UTR", "UPI Ref No.", or "Transaction ID".',
  },
  {
    q: 'How long does payment verification take?',
    a: 'Most payments are manually verified within 15 to 60 minutes during active hours. You can track real-time approval status anytime in My Dashboard or via Order Tracking below.',
  },
  {
    q: 'Can I share my Telegram invite link with someone else?',
    a: 'No. For community security, each approved user receives a backend-generated single-use Telegram invite link (member limit: 1) with an expiration window.',
  },
  {
    q: 'What happens if my payment request is rejected?',
    a: 'If an incorrect UTR or unclear screenshot was uploaded, the exact rejection reason appears in your dashboard along with a "Submit New Payment Request" button.',
  },
];

export default function LandingPage({
  settings,
  user,
  isAdmin,
  hasApprovedOrder,
  onBuyNow,
  onNavigate,
  onSignIn,
  onOpenLegal,
  onNotify,
}: LandingPageProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [toolsImgFailed, setToolsImgFailed] = useState(false);
  const [trustImgFailed, setTrustImgFailed] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const [trackInput, setTrackInput] = useState('');
  const [tracking, setTracking] = useState(false);
  const [trackedOrder, setTrackedOrder] = useState<OrderRecord | null>(null);
  const [trackError, setTrackError] = useState('');

  const handleTrackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackError('');
    setTrackedOrder(null);

    const cleaned = trackInput.trim();
    if (!cleaned || !/^[a-zA-Z0-9_-]{4,64}$/.test(cleaned)) {
      setTrackError('Please enter a valid Order ID (e.g., ORD-20261114-A7B2C9).');
      return;
    }

    if (!user) {
      try {
        await onSignIn();
      } catch {
        setTrackError('Please sign in with Google to securely view your order status.');
        return;
      }
    }

    setTracking(true);
    try {
      const found = await trackOrderById(cleaned);
      if (!found) {
        setTrackError('No order found with that Order ID under your account.');
      } else {
        setTrackedOrder(found);
      }
    } catch {
      setTrackError('Order not found or belongs to a different account.');
    } finally {
      setTracking(false);
    }
  };

  const handleWhatsAppClick = () => {
    const cleanPhone = settings.whatsappNumber.replace(/[^\d]/g, '');
    if (!cleanPhone) {
      onNotify(
        'info',
        'WhatsApp Support Not Configured',
        'Administrator can add a WhatsApp support number in Admin Console > Settings.'
      );
      return;
    }
    const text = encodeURIComponent(
      `Hello! I need help regarding "${settings.courseName}" (₹${settings.coursePrice}).`
    );
    window.location.href = `https://wa.me/${cleanPhone}?text=${text}`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* 1. HERO SECTION (Obsidian Black + Gold) */}
      <section className="bg-[#09090B] text-white border-b border-zinc-800/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            {/* Left Column: Proposition & Primary CTA */}
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wider text-[#E5C158] mb-4">
                Sufiyan Academy · Verified Digital Curriculum
              </p>

              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08] mb-5"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
              >
                {settings.courseName}
              </h1>

              <p className="text-base sm:text-lg text-zinc-300 leading-relaxed mb-8 max-w-xl">
                {settings.courseDescription}
              </p>

              {/* Price Lockup */}
              <div className="flex items-baseline gap-4 mb-8 pb-6 border-b border-zinc-800">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl sm:text-5xl font-display font-extrabold text-[#E5C158] tabular-nums">
                    ₹{settings.coursePrice}
                  </span>
                  <span className="text-sm text-zinc-400">One-time access</span>
                </div>

                {settings.showOriginalPrice && settings.originalPrice > settings.coursePrice && (
                  <span className="text-xl text-zinc-500 line-through tabular-nums">
                    ₹{settings.originalPrice}
                  </span>
                )}
              </div>

              {/* Single Dominant Action */}
              <div className="flex flex-wrap items-center gap-4">
                {hasApprovedOrder ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('dashboard')}
                    className="inline-flex items-center justify-center gap-3 px-8 py-4 text-base font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] via-[#F3D578] to-[#D4AF37] rounded-xl shadow-[0_8px_30px_rgba(212,175,55,0.28)] hover:brightness-105 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    <span>VIEW NOW</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!settings.isAvailable}
                    onClick={onBuyNow}
                    className="inline-flex items-center justify-center gap-3 px-8 py-4 text-base font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] via-[#F3D578] to-[#D4AF37] rounded-xl shadow-[0_8px_30px_rgba(212,175,55,0.28)] hover:brightness-105 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer tabular-nums"
                  >
                    <span>
                      {settings.isAvailable ? `BUY NOW — ₹${settings.coursePrice}` : 'ENROLLMENT PAUSED'}
                    </span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onNavigate('dashboard')}
                  className="inline-flex items-center justify-center px-6 py-4 text-sm font-semibold text-zinc-200 border border-zinc-700 rounded-xl hover:border-zinc-500 hover:text-white transition-colors cursor-pointer"
                >
                  {user ? 'Open My Dashboard' : 'Already Paid? Track Access'}
                </button>
              </div>
            </div>

            {/* Right Column: Large Course Cover Visual */}
            <div className="lg:col-span-6 flex items-center">
              <div className="w-full aspect-video rounded-2xl overflow-hidden border border-zinc-800 bg-[#111114] relative shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                {!heroImgFailed && settings.courseCoverUrl ? (
                  <img
                    src={settings.courseCoverUrl}
                    alt={`${settings.courseName} Banner`}
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-contain bg-[#09090B]"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-zinc-900 via-[#12100B] to-zinc-950">
                    <ShieldCheck className="w-12 h-12 text-[#D4AF37] mb-3" />
                    <p className="font-display text-xl font-bold text-white">{settings.courseName}</p>
                    <p className="text-sm text-zinc-400 mt-1">Complete Digital Video & Tools Edition</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4-Column Summary Strip Below Hero Split */}
          <div className="mt-12 pt-8 border-t border-zinc-800/80 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs font-mono text-zinc-400 tabular-nums">01 · CURRICULUM</p>
              <p className="mt-1 text-sm font-semibold text-white">Step-by-Step Video Guides</p>
            </div>
            <div>
              <p className="text-xs font-mono text-zinc-400 tabular-nums">02 · TOOLKIT</p>
              <p className="mt-1 text-sm font-semibold text-white">Templates & Earning Tools</p>
            </div>
            <div>
              <p className="text-xs font-mono text-zinc-400 tabular-nums">03 · COMMUNITY</p>
              <p className="mt-1 text-sm font-semibold text-white">Private Telegram Channel</p>
            </div>
            <div>
              <p className="text-xs font-mono text-zinc-400 tabular-nums">04 · PAYMENT</p>
              <p className="mt-1 text-sm font-semibold text-white">Verified UPI & UTR Desk</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. COURSE BENEFITS SECTION (Crisp White Editorial Canvas) */}
      <section id="benefits" className="bg-white text-zinc-950 py-16 lg:py-24 border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold tracking-wider text-[#9A7411] mb-2">
              Inside The Course
            </p>
            <h2
              className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950"
              style={{ textWrap: 'balance' }}
            >
              Everything included in your ₹{settings.coursePrice} enrollment
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Asymmetric 5-Card Benefits Grid */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {BENEFITS.map((item, idx) => (
                <div
                  key={item.num}
                  className={`p-6 rounded-xl border border-zinc-200 bg-[#FAFAFA] hover:border-[#D4AF37] transition-colors ${
                    idx === 4 ? 'sm:col-span-2' : ''
                  }`}
                >
                  <p className="font-mono text-xs font-semibold text-[#9A7411] tabular-nums mb-2">
                    {item.num}.
                  </p>
                  <h3 className="font-display text-base font-bold text-zinc-950 mb-1.5">
                    {item.title}
                  </h3>
                  <p className="text-sm text-zinc-600 leading-relaxed">{item.subtitle}</p>
                </div>
              ))}
            </div>

            {/* Right Visual Anchor */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-900 aspect-[4/3]">
                {!toolsImgFailed ? (
                  <img
                    src="/src/assets/images/benefit_tools_showcase_1794675310312.jpg"
                    alt="Complete digital tools and workflow resources showcase"
                    referrerPolicy="no-referrer"
                    onError={() => setToolsImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-8 text-center text-zinc-300">
                    <p className="font-display font-semibold">Digital Tools & Video Curriculum</p>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                <span>Beginner Friendly · Hindi + Practical Guides</span>
                <span className="font-mono tabular-nums">₹{settings.coursePrice} Only</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. TRUST & VERIFICATION SECTION (Obsidian Black + Gold) */}
      <section className="bg-[#09090B] text-white py-16 lg:py-24 border-b border-zinc-800/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-[#111114] aspect-square max-w-md mx-auto lg:mx-0">
                {!trustImgFailed ? (
                  <img
                    src="/src/assets/images/trust_verification_seal_1794675311904.jpg"
                    alt="Secure manual payment verification vault"
                    referrerPolicy="no-referrer"
                    onError={() => setTrustImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-8">
                    <Lock className="w-14 h-14 text-[#D4AF37]" />
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-7 space-y-8">
              <div>
                <p className="text-xs font-medium tracking-wider text-[#E5C158] mb-2">
                  Verified Access Protocol
                </p>
                <h2
                  className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white"
                  style={{ textWrap: 'balance' }}
                >
                  Manual bank verification before private Telegram access
                </h2>
              </div>

              <div className="divide-y divide-zinc-800 border-t border-b border-zinc-800">
                {TRUST_ITEMS.map((trust) => (
                  <div key={trust.num} className="py-5 flex gap-5">
                    <span className="font-mono text-sm font-semibold text-[#E5C158] tabular-nums shrink-0 pt-0.5">
                      {trust.num}
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-white mb-1">
                        {trust.title}
                      </h3>
                      <p className="text-sm text-zinc-400 leading-relaxed">{trust.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                {hasApprovedOrder ? (
                  <button
                    type="button"
                    onClick={() => onNavigate('dashboard')}
                    className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
                  >
                    <span>Open Approved Course Access</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!settings.isAvailable}
                    onClick={onBuyNow}
                    className="inline-flex items-center gap-2 px-7 py-3.5 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 disabled:opacity-50 transition-all cursor-pointer tabular-nums"
                  >
                    <span>Proceed to ₹{settings.coursePrice} Checkout</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. ORDER TRACKING SECTION (Crisp White) */}
      <section id="track-order" className="bg-white text-zinc-950 py-16 border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <p className="text-xs font-semibold tracking-wider text-[#9A7411] mb-2">
              Order Verification Status
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
              Track your payment & course access
            </h2>
            <p className="text-sm text-zinc-600 mt-2">
              Enter your unique Order ID to check whether your payment is pending, approved, or needs resubmission.
            </p>
          </div>

          <form onSubmit={handleTrackSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={trackInput}
                onChange={(e) => setTrackInput(e.target.value)}
                placeholder="Enter Order ID (e.g., ORD-20261114-X7K9M2)"
                className="w-full pl-10 pr-4 py-3 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:border-[#9A7411]"
              />
            </div>
            <button
              type="submit"
              disabled={tracking}
              className="px-6 py-3 text-sm font-semibold bg-zinc-950 text-white rounded-xl hover:bg-zinc-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {tracking ? 'Checking...' : user ? 'Track Order' : 'Sign In & Track'}
            </button>
          </form>

          {trackError && (
            <div className="mt-4 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
              {trackError}
            </div>
          )}

          {trackedOrder && (
            <div className="mt-5 p-5 rounded-xl border border-zinc-200 bg-[#FAFAFA] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono tabular-nums">
                  <span>{trackedOrder.orderId}</span>
                  <span aria-hidden="true">·</span>
                  <span>UTR: {trackedOrder.utr}</span>
                  <span aria-hidden="true">·</span>
                  <span>₹{trackedOrder.amount}</span>
                </div>
                <p className="text-sm font-semibold text-zinc-950">{trackedOrder.name}</p>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {trackedOrder.status === 'APPROVED' && (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      Payment Approved · Course Access Ready
                    </span>
                  )}
                  {trackedOrder.status === 'PENDING' && (
                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                      <Clock className="w-4 h-4" />
                      Payment Under Review
                    </span>
                  )}
                  {trackedOrder.status === 'REJECTED' && (
                    <span className="inline-flex items-center gap-1.5 text-red-700">
                      <XCircle className="w-4 h-4" />
                      Rejected: {trackedOrder.rejectionReason}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate('dashboard')}
                className="px-5 py-2.5 text-xs font-bold bg-[#D4AF37] text-[#09090B] rounded-lg hover:brightness-105 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                {trackedOrder.status === 'APPROVED' ? 'VIEW NOW' : 'Open Dashboard'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 5. FAQ SECTION (Soft Neutral Light) */}
      <section id="faq" className="bg-[#F8F8FA] text-zinc-950 py-16 lg:py-20 border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="mb-10">
            <p className="text-xs font-semibold tracking-wider text-[#9A7411] mb-2">
              Common Questions
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-950">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="divide-y divide-zinc-200 border-t border-b border-zinc-200 bg-white rounded-xl px-5">
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="py-4">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left py-1 cursor-pointer"
                  >
                    <span className="text-sm sm:text-base font-semibold text-zinc-950">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2.5 text-sm text-zinc-600 leading-relaxed pr-6">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. FOOTER & LEGAL + WHATSAPP SUPPORT */}
      <footer className="bg-[#09090B] text-zinc-400 py-12 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div>
            <p className="font-display text-base font-bold text-white">Sufiyan Academy</p>
            <p className="text-xs text-zinc-500 mt-1">
              © {new Date().getFullYear()} Sufiyan Academy. All rights reserved.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs font-medium">
            <button
              type="button"
              onClick={() => onOpenLegal('terms')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Terms & Conditions
            </button>
            <button
              type="button"
              onClick={() => onOpenLegal('refund')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Refund Policy
            </button>
            <button
              type="button"
              onClick={() => onOpenLegal('privacy')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Privacy Policy
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className="text-[#E5C158] hover:underline cursor-pointer"
              >
                Admin Console
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleWhatsAppClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-zinc-900 border border-zinc-700 rounded-lg hover:border-[#D4AF37] transition-colors cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            <span>Contact WhatsApp Support</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
