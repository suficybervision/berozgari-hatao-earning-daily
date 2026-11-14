import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { auth } from './firebase';
import {
  checkUserIsAdmin,
  DEFAULT_COURSE_SETTINGS,
  signInWithGoogle,
  signOutUser,
  subscribeCourseSettings,
  subscribeUserOrders,
} from './services/courseService';
import type { AppView, CourseSettings, OrderRecord, ToastNotice } from './types';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import CheckoutView from './components/CheckoutView';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';
import LegalModal, { type LegalDocType } from './components/LegalModal';

export default function App() {
  const [view, setView] = useState<AppView>('home');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [settings, setSettings] = useState<CourseSettings>(DEFAULT_COURSE_SETTINGS);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

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

  // Subscribe to public course settings
  useEffect(() => {
    const unsub = subscribeCourseSettings(
      (next) => setSettings(next),
      () => {
        // Fallback smoothly to DEFAULT_COURSE_SETTINGS if offline or uninitialized
      }
    );
    return () => unsub();
  }, []);

  // Listen to Firebase Auth state & resolve Admin authorization
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);

      if (!currentUser) {
        setIsAdmin(false);
        setOrders([]);
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

  // Subscribe to current user's orders only after auth is ready & user is signed in
  useEffect(() => {
    if (!authReady || !user) {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }

    setLoadingOrders(true);
    const unsub = subscribeUserOrders(
      user.uid,
      (list) => {
        setOrders(list);
        setLoadingOrders(false);
      },
      (err) => {
        setLoadingOrders(false);
        notify('error', 'Order Sync Issue', err.message);
      }
    );
    return () => unsub();
  }, [authReady, user, notify]);

  const handleSignIn = useCallback(async () => {
    try {
      const signedInUser = await signInWithGoogle();
      notify('success', 'Signed In', `Welcome, ${signedInUser.displayName || signedInUser.email}`);
      return signedInUser;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In was cancelled.';
      notify('error', 'Sign-In Failed', msg);
      throw err;
    }
  }, [notify]);

  const handleSignOut = useCallback(async () => {
    await signOutUser();
    setView('home');
    notify('info', 'Signed Out', 'You have been signed out safely.');
  }, [notify]);

  const handleNavigate = useCallback((nextView: AppView, sectionId?: string) => {
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

  const hasApprovedOrder = orders.some((o) => o.status === 'APPROVED');

  return (
    <div className="min-h-screen flex flex-col bg-[#09090B]">
      <Navbar
        currentView={view}
        user={user}
        isAdmin={isAdmin}
        hasApprovedOrder={hasApprovedOrder}
        coursePrice={settings.coursePrice}
        isAvailable={settings.isAvailable}
        onNavigate={handleNavigate}
      />

      <main className="flex-1">
        {view === 'home' && (
          <LandingPage
            settings={settings}
            user={user}
            isAdmin={isAdmin}
            hasApprovedOrder={hasApprovedOrder}
            onBuyNow={() => handleNavigate('checkout')}
            onNavigate={handleNavigate}
            onSignIn={async () => {
              await handleSignIn();
            }}
            onOpenLegal={setLegalDoc}
            onNotify={notify}
          />
        )}

        {view === 'checkout' && (
          <CheckoutView
            settings={settings}
            user={user}
            onSignIn={handleSignIn}
            onNavigate={handleNavigate}
            onNotify={notify}
          />
        )}

        {view === 'dashboard' && (
          <UserDashboard
            user={user}
            orders={orders}
            loadingOrders={loadingOrders}
            settings={settings}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onNavigate={handleNavigate}
            onNotify={notify}
          />
        )}

        {view === 'admin' && (
          <AdminDashboard
            user={user}
            isAdmin={isAdmin}
            settings={settings}
            onSignIn={handleSignIn}
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
