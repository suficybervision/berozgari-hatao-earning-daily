import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import type { AppView, CourseSettings } from '../types';
import UpiQrCode from './UpiQrCode';
import { normalizeUtr, submitOrderRequest } from '../services/courseService';

interface CheckoutViewProps {
  settings: CourseSettings;
  onNavigate: (view: AppView) => void;
  onTrackCode: (code: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export default function CheckoutView({
  settings,
  onNavigate,
  onTrackCode,
  onNotify,
}: CheckoutViewProps) {
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [utr, setUtr] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleCopyUpi = async () => {
    try {
      await navigator.clipboard.writeText(settings.upiId);
      setCopiedUpi(true);
      onNotify('success', 'UPI ID Copied', settings.upiId);
      setTimeout(() => setCopiedUpi(false), 2000);
    } catch {
      onNotify('info', 'Copy UPI ID', `Please pay to: ${settings.upiId}`);
    }
  };

  const handleCopyOrderCode = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopiedCode(true);
      onNotify('success', 'Unique Code Copied', generatedCode);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      onNotify('info', 'Save Your Code', generatedCode);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      setErrorMsg('Only JPG, JPEG, or PNG payment screenshots are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Screenshot file must be smaller than 5 MB.');
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshotFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!settings.isAvailable) {
      setErrorMsg('Course enrollments are currently paused by the administrator.');
      return;
    }

    const cleanName = fullName.trim();
    const cleanMobile = mobile.trim();
    const cleanUtr = normalizeUtr(utr);

    if (cleanName.length < 2) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!/^[0-9+\-\s]{10,15}$/.test(cleanMobile) || cleanMobile.replace(/\D/g, '').length < 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (cleanUtr.length < 6 || cleanUtr.length > 40) {
      setErrorMsg('Please enter a valid UTR / Transaction ID (6–40 letters/digits).');
      return;
    }
    if (!screenshotFile) {
      setErrorMsg('Please upload your UPI payment screenshot (JPG, JPEG, or PNG).');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitOrderRequest({
        name: cleanName,
        mobile: cleanMobile,
        utr: cleanUtr,
        file: screenshotFile,
      });

      setGeneratedCode(result.orderCode);
      onNotify('success', 'Payment Request Submitted', `Code: ${result.orderCode}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to submit payment request. Please try again.';
      setErrorMsg(message);
      onNotify('error', 'Submission Failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (generatedCode) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-[#09090B] text-white py-12 px-4">
        <div className="max-w-xl mx-auto bg-[#111114] border border-zinc-800 rounded-2xl p-6 sm:p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-5">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-snug mb-6">
            आपकी पेमेंट रिक्वेस्ट सफलतापूर्वक जमा हो गई है।
          </h1>

          {/* Prominent Unique Tracking Code + Copy Button */}
          <div className="p-5 sm:p-6 rounded-2xl bg-zinc-950 border border-[#D4AF37]/50 mb-6">
            <p className="text-xs font-medium text-zinc-400 mb-2">
              Your Unique Order Tracking Code
            </p>
            <p className="font-mono text-2xl sm:text-3xl font-extrabold tracking-wider text-[#E5C158] tabular-nums select-all mb-4">
              {generatedCode}
            </p>
            <button
              type="button"
              onClick={handleCopyOrderCode}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-bold text-[#09090B] bg-gradient-to-r from-[#D4AF37] to-[#F3D578] rounded-xl hover:brightness-105 transition-all cursor-pointer"
            >
              {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedCode ? 'CODE COPIED!' : 'COPY CODE'}</span>
            </button>
          </div>

          {/* Mandatory Hindi Warning Notice */}
          <div className="text-left bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 mb-8">
            <p className="text-sm sm:text-base text-amber-100 leading-relaxed font-medium">
              ⚠️ जरूरी सूचना: कृपया इस Unique Code को किसी अच्छी और सुरक्षित जगह पर नोट करके रख लें। अपने पेमेंट का Status चेक करने और कोर्स का Access पाने के लिए आपको इसी Code की जरूरत होगी। इसे खोएं नहीं।
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => onTrackCode(generatedCode)}
              className="px-7 py-3.5 text-sm font-bold text-[#09090B] bg-white rounded-xl hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Track Order Status Now
            </button>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="px-6 py-3.5 text-sm font-semibold text-zinc-300 border border-zinc-700 rounded-xl hover:text-white hover:border-zinc-500 transition-colors cursor-pointer"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(
    settings.courseName.slice(0, 40)
  )}&am=${encodeURIComponent(String(settings.coursePrice))}&cu=INR`;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#FAFAFA] text-zinc-950 py-10 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950 mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Course Overview</span>
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: UPI Payment Instructions & QR */}
          <div className="lg:col-span-5 bg-[#09090B] text-white rounded-2xl p-6 sm:p-7 border border-zinc-800">
            <p className="text-xs font-medium text-[#E5C158] mb-1">Step 1 · Pay via UPI</p>
            <h1 className="font-display text-xl font-bold text-white mb-4">
              {settings.courseName}
            </h1>

            <div className="flex items-baseline justify-between py-3 px-4 rounded-xl bg-zinc-900 border border-zinc-800 mb-6">
              <span className="text-sm text-zinc-400">Payable Amount</span>
              <span className="text-2xl font-display font-extrabold text-[#E5C158] tabular-nums">
                ₹{settings.coursePrice}
              </span>
            </div>

            <div className="text-center mb-6">
              <UpiQrCode
                upiId={settings.upiId}
                amount={settings.coursePrice}
                courseName={settings.courseName}
                customQrUrl={settings.qrCodeUrl}
              />
            </div>

            <div className="mb-5">
              <label className="block text-xs text-zinc-400 mb-1.5">Official UPI ID</label>
              <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5">
                <span className="font-mono text-sm text-white truncate">{settings.upiId}</span>
                <button
                  type="button"
                  onClick={handleCopyUpi}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#D4AF37] text-[#09090B] rounded-lg hover:brightness-105 transition-all shrink-0 cursor-pointer"
                >
                  {copiedUpi ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedUpi ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <a
              href={upiDeepLink}
              className="w-full mb-6 inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-zinc-200 border border-zinc-700 rounded-xl hover:border-zinc-500 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#E5C158]" />
              <span>Open in PhonePe / GPay / Paytm App</span>
            </a>

            <div className="pt-5 border-t border-zinc-800 space-y-2 text-xs text-zinc-400 leading-relaxed">
              <p className="font-semibold text-zinc-200">
                ₹{settings.coursePrice} Payment Instructions:
              </p>
              <p>1. Scan the QR code or pay ₹{settings.coursePrice} to the UPI ID above.</p>
              <p>2. Copy the 12-digit UTR / Transaction ID from your payment receipt.</p>
              <p>3. Submit your details & screenshot to get your Unique Order Tracking Code.</p>
            </div>
          </div>

          {/* Right Column: No-Login Payment Proof Form */}
          <div className="lg:col-span-7 bg-white rounded-2xl p-6 sm:p-8 border border-zinc-200">
            <div className="pb-5 mb-6 border-b border-zinc-200">
              <p className="text-xs font-semibold text-[#9A7411] mb-1">
                Step 2 · Submit Verification Proof (No Login Required)
              </p>
              <h2 className="font-display text-xl font-bold text-zinc-950">
                Complete Payment Details
              </h2>
            </div>

            {!settings.isAvailable && (
              <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
                Course enrollment is currently paused by the administrator. Please check back later.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="checkout-name" className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Full Name *
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>

                <div>
                  <label htmlFor="checkout-mobile" className="block text-xs font-semibold text-zinc-700 mb-1.5">
                    Mobile Number *
                  </label>
                  <input
                    id="checkout-mobile"
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="10-digit WhatsApp / Mobile"
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="checkout-utr" className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  UTR / Transaction ID *
                </label>
                <input
                  id="checkout-utr"
                  type="text"
                  required
                  value={utr}
                  onChange={(e) => setUtr(e.target.value.toUpperCase())}
                  placeholder="e.g., 431890271124"
                  className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-[#FAFAFA] border border-zinc-300 rounded-xl focus:outline-none focus:border-[#9A7411]"
                />
              </div>

              {/* Payment Screenshot Upload */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                  Payment Screenshot Upload (JPG, JPEG, PNG) *
                </label>
                <label
                  htmlFor="screenshot-upload"
                  className="flex flex-col items-center justify-center p-6 border border-dashed border-zinc-300 rounded-xl bg-[#FAFAFA] hover:border-[#9A7411] transition-colors cursor-pointer"
                >
                  {previewUrl ? (
                    <div className="w-full flex flex-col items-center">
                      <img
                        src={previewUrl}
                        alt="Uploaded payment screenshot preview"
                        className="max-h-52 rounded-lg object-contain border border-zinc-200 mb-3"
                      />
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9A7411]">
                        <ImagePlus className="w-4 h-4" />
                        Change Screenshot ({screenshotFile?.name})
                      </span>
                    </div>
                  ) : (
                    <>
                      <UploadCloud className="w-8 h-8 text-zinc-400 mb-2" />
                      <span className="text-sm font-semibold text-zinc-800">
                        Click to upload payment screenshot
                      </span>
                      <span className="text-xs text-zinc-500 mt-1">
                        JPG, JPEG, or PNG · Max 5 MB
                      </span>
                    </>
                  )}
                  <input
                    id="screenshot-upload"
                    type="file"
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting || !settings.isAvailable}
                  className="w-full py-4 px-6 inline-flex items-center justify-center gap-2 text-sm font-bold tracking-wide text-[#09090B] bg-gradient-to-r from-[#D4AF37] via-[#F3D578] to-[#D4AF37] rounded-xl hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Payment Request...</span>
                    </>
                  ) : (
                    <span>SUBMIT PAYMENT REQUEST</span>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
                <ShieldCheck className="w-4 h-4 text-[#9A7411]" />
                <span>Duplicate UTR submissions are automatically blocked.</span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
