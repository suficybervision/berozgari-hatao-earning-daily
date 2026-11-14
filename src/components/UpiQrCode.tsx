import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { QrCode } from 'lucide-react';

interface UpiQrCodeProps {
  upiId: string;
  amount: number;
  courseName: string;
  customQrUrl?: string;
}

export default function UpiQrCode({
  upiId,
  amount,
  courseName,
  customQrUrl,
}: UpiQrCodeProps) {
  const [generatedQr, setGeneratedQr] = useState<string>('');
  const [failed, setFailed] = useState<boolean>(false);

  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    courseName.slice(0, 40)
  )}&am=${encodeURIComponent(String(amount))}&cu=INR&tn=${encodeURIComponent('Course Enrollment')}`;

  useEffect(() => {
    let active = true;
    setFailed(false);

    if (customQrUrl) {
      return;
    }

    QRCode.toDataURL(upiUri, {
      width: 260,
      margin: 2,
      color: {
        dark: '#09090B',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then((dataUrl) => {
        if (active) setGeneratedQr(dataUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [upiUri, customQrUrl]);

  const imgSrc = customQrUrl || generatedQr;

  if (failed || !imgSrc) {
    return (
      <div className="w-52 h-52 mx-auto rounded-xl bg-white border border-zinc-200 flex flex-col items-center justify-center p-4 text-zinc-500">
        <QrCode className="w-10 h-10 mb-2 text-zinc-400" />
        <span className="text-xs text-center">Generating UPI QR...</span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center p-3 bg-white rounded-xl border border-zinc-200 shadow-sm">
      <img
        src={imgSrc}
        alt={`UPI Payment QR Code for ${upiId}`}
        referrerPolicy="no-referrer"
        className="w-48 h-48 object-contain rounded-lg"
        onError={() => setFailed(true)}
      />
      <span className="mt-2 text-[11px] font-mono text-zinc-600 tabular-nums">
        Scan & Pay ₹{amount}
      </span>
    </div>
  );
}
