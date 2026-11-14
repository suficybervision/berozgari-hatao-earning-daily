import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { auth } from './firebase';
import {
  checkUserIsAdmin,
  DEFAULT_COURSE_SETTINGS,
  signInAdminWithGoogle,
  signOutAdmin,
  subscribeCourseSettings,
} from './services/courseService';
import type { AppView, CourseSettings, ToastNotice } from './types';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import CheckoutView from './components/CheckoutView';
import TrackOrderView from './components/TrackOrderView';
import AdminDashboard from './components/AdminDashboard';
import LegalModal, { type LegalDocType } from './components/LegalModal';

function resolveViewFromLocation(): AppView {
  const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const hash = window.location.hash.replace(/^#/, '').replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);

  if (cleanPath === '/admin' || hash === '/admin' || params.get('admin') === '1') {
    return 'admin';
  }
  if (cleanPath === '/track' || hash === '/track') return 'track';
  if (cleanPath === '/checkout' || hash === '/checkout') return 'checkout';
  return 'home';
}

function pathForView(view: AppView): string {
  if (view === 'admin') return '/admin';
  if (view === 'track') return '/track';
  if (view === 'checkout') return '/checkout';
  return '/';
}

export default function App() {
  const [view, setView] = useState<AppView>(() => resolveViewFromLocation());
  const [trackInitialCode, setTrackInitialCode] = useState('');

  // Admin-only Firebase Auth state
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [settings, setSettings] = useState<CourseSettings>(DEFAULT_COURSE_SETTINGS);
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, message?: string) => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  // Sync browser back/forward and hash navigation with URL paths (/admin, /track, /checkout, /)
  useEffect(() => {
    const handleRouteChange = () => {
      setView(resolveViewFromLocation());
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  // Subscribe to public course settings
  useEffect(() => {
    const unsub = subscribeCourseSettings(
      (next) => setSettings(next),
      () => {
        // Fallback smoothly to DEFAULT_COURSE_SETTINGS
      }
    );
    return () => unsub();
  }, []);

  // Admin Authentication listener (only used by /admin)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setAdminUser(currentUser);
      if (!currentUser) {
        setIsAdmin(false);
        return;
      }
      try {
        const adminFlag = await checkUserIsAdmin(currentUser);
        setIsAdmin(adminFlag);
      } catch {
        setIsAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  const handleAdminSignIn = useCallback(async () => {
    try {
      const signedInUser = await signInAdminWithGoogle();
      const allowed = await checkUserIsAdmin(signedInUser);
      if (!allowed) {
        await signOutAdmin();
        notify(
          'error',
          'Unauthorized Gmail',
          'केवल अधिकृत एडमिन Gmail अकाउंट से ही लॉगिन किया जा सकता है।'
        );
        return signedInUser;
      }
      notify('success', 'Admin Signed In', signedInUser.email || undefined);
      return signedInUser;
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Admin Sign-In was cancelled.';
      const friendlyMsg = rawMsg.includes('unauthorized-domain')
        ? `Add "${window.location.hostname}" to Firebase Console → Authentication → Settings → Authorized domains.`
        : rawMsg;
      notify('error', 'Admin Sign-In Failed', friendlyMsg);
      throw err;
    }
  }, [notify]);

  const handleAdminSignOut = useCallback(async () => {
    await signOutAdmin();
    notify('info', 'Signed Out', 'Admin session ended.');
  }, [notify]);

  const handleNavigate = useCallback((nextView: AppView, sectionId?: string) => {
    const targetPath = pathForView(nextView);
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setView(nextView);
    if (sectionId) {
      setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleTrackWithCode = useCallback(
    (code?: string) => {
      setTrackInitialCode(code || '');
      handleNavigate('track');
    },
    [handleNavigate]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#09090B]">
      <Navbar
        currentView={view}
        coursePrice={settings.coursePrice}
        isAvailable={settings.isAvailable}
        onNavigate={handleNavigate}
      />

      <main className="flex-1">
        {view === 'home' && (
          <LandingPage
            settings={settings}
            onBuyNow={() => handleNavigate('checkout')}
            onTrackWithCode={handleTrackWithCode}
            onNavigate={handleNavigate}
            onOpenLegal={setLegalDoc}
            onNotify={notify}
          />
        )}

        {view === 'checkout' && (
          <CheckoutView
            settings={settings}
            onNavigate={handleNavigate}
            onTrackCode={(code) => handleTrackWithCode(code)}
            onNotify={notify}
          />
        )}

        {view === 'track' && (
          <TrackOrderView
            initialCode={trackInitialCode}
            settings={settings}
            onNavigate={handleNavigate}
            onNotify={notify}
          />
        )}

        {view === 'admin' && (
          <AdminDashboard
            user={adminUser}
            isAdmin={isAdmin}
            settings={settings}
            onSignIn={handleAdminSignIn}
            onSignOut={handleAdminSignOut}
            onNotify={notify}
          />
        )}
      </main>

      <LegalModal
        docType={legalDoc}
        courseName={settings.courseName}
        coursePrice={settings.coursePrice}
        onClose={() => setLegalDoc(null)}
      />

      {/* Toast Notifications */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100%-2rem)] pointer-events-none"
      >
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-auto bg-[#111114] text-white border border-zinc-800 rounded-xl p-4 shadow-2xl flex items-start gap-3"
            >
              {toast.type === 'success' && (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {toast.type === 'error' && (
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              )}
              {toast.type === 'info' && (
                <Info className="w-5 h-5 text-[#E5C158] shrink-0 mt-0.5" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-zinc-400 mt-0.5 break-words">{toast.message}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-zinc-500 hover:text-white p-0.5 cursor-pointer"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
