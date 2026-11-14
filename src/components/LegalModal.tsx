import { X } from 'lucide-react';

export type LegalDocType = 'terms' | 'refund' | 'privacy' | null;

interface LegalModalProps {
  docType: LegalDocType;
  courseName: string;
  coursePrice: number;
  onClose: () => void;
}

export default function LegalModal({
  docType,
  courseName,
  coursePrice,
  onClose,
}: LegalModalProps) {
  if (!docType) return null;

  const contentMap = {
    terms: {
      title: 'Terms & Conditions',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Course Enrollment & Single-User License',
          body: `Enrollment in "${courseName}" grants a personal, non-transferable license to access the digital curriculum and private Telegram community. Sharing invite links, re-uploading tutorials, or redistributing course tools is strictly prohibited.`,
        },
        {
          heading: '2. Manual Payment Verification',
          body: `All ₹${coursePrice} UPI payments undergo manual verification by our administration team using the submitted UTR / Transaction Reference Number and payment screenshot. Submitting forged screenshots or duplicate UTR references results in immediate rejection.`,
        },
        {
          heading: '3. Private Telegram Community Rules',
          body: 'Approved students receive a single-use Telegram invite link valid for one member join. Maintain respectful conduct inside the community; spam or unauthorized promotion leads to removal without refund.',
        },
      ],
    },
    refund: {
      title: 'Refund Policy',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Digital Product Nature',
          body: `Because "${courseName}" is a digital educational product priced at ₹${coursePrice} with instant access to downloadable resources and a private Telegram channel once approved, all approved enrollments are final and non-refundable.`,
        },
        {
          heading: '2. Rejected or Failed Verifications',
          body: 'If your payment request is rejected due to an incorrect UTR number or unclear screenshot, you can submit a fresh payment verification request from your User Dashboard at no extra charge. If money was debited twice by your bank, reach out via WhatsApp support with both UTR references.',
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      updated: 'Effective November 2026',
      sections: [
        {
          heading: '1. Information We Collect',
          body: 'We collect your name, mobile number, optional email address, Google account identifier, UTR reference number, and payment screenshot solely to verify your payment and provision course access.',
        },
        {
          heading: '2. Data Security & Access Control',
          body: 'Your order records and payment screenshots are isolated under strict database and storage access rules. Only you and authorized platform administrators can view your order verification details. We never sell or share customer phone numbers or emails with third-party marketers.',
        },
      ],
    },
  };

  const docData = contentMap[docType];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
    >
      <div className="w-full max-w-xl bg-white text-zinc-900 rounded-2xl border border-zinc-200 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h2 id="legal-modal-title" className="text-lg font-bold text-zinc-950">
              {docData.title}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">{docData.updated}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close legal dialog"
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto space-y-5">
          {docData.sections.map((sec) => (
            <div key={sec.heading} className="space-y-1.5">
              <h3 className="text-sm font-semibold text-zinc-950">{sec.heading}</h3>
              <p className="text-sm leading-relaxed text-zinc-600">{sec.body}</p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-semibold bg-zinc-950 text-white rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
