import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import type { User } from 'firebase/auth';

interface SecureScreenshotProps {
  src: string;
  alt: string;
  user: User | null;
  className?: string;
}

export default function SecureScreenshot({
  src,
  alt,
  user,
  className = 'w-full h-auto rounded-lg object-contain',
}: SecureScreenshotProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';

    async function loadImage() {
      setLoading(true);
      setError('');

      if (!src) {
        if (active) {
          setError('No screenshot URL provided.');
          setLoading(false);
        }
        return;
      }

      if (!src.startsWith('/api/uploads/ss_')) {
        if (active) {
          setResolvedUrl(src);
          setLoading(false);
        }
        return;
      }

      if (!user) {
        if (active) {
          setError('Sign in to view protected payment screenshot.');
          setLoading(false);
        }
        return;
      }

      try {
        const idToken = await user.getIdToken();
        const res = await fetch(src, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
          throw new Error('Unauthorized or missing screenshot');
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setResolvedUrl(objectUrl);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load screenshot');
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, user]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-400 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37] mb-2" />
        <span className="text-xs">Loading payment screenshot...</span>
      </div>
    );
  }

  if (error || !resolvedUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 text-center text-zinc-400 bg-zinc-900/50 rounded-xl border border-zinc-800">
        <ImageOff className="w-6 h-6 text-zinc-500 mb-2" />
        <span className="text-xs">{error || 'Screenshot unavailable'}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setError('Failed to render payment screenshot.')}
    />
  );
}
