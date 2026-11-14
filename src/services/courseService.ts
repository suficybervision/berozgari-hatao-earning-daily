import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, db, googleProvider, handleFirestoreError, OperationType, storage } from '../firebase';
import type { CourseSettings, OrderRecord, OrderStatus, TelegramConfigStatus } from '../types';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'hajshdbdb262837@gmail.com';
export const DEFAULT_COURSE_COVER = '/assets/aistudio/file_00000000b70c820b8abadde4ba233ee5_8293c598.webp';

export const DEFAULT_COURSE_SETTINGS: CourseSettings = {
  courseName: 'Complete Online Earning Course',
  courseDescription:
    'सीखिए ऑनलाइन कमाई करने का तरीका, सभी जरूरी टूल्स और स्टेप-बाय-स्टेप गाइड एक ही कोर्स में।',
  courseCoverUrl: DEFAULT_COURSE_COVER,
  originalPrice: 499,
  showOriginalPrice: true,
  coursePrice: 99,
  upiId: 'mdsufiyanxyz@fam',
  qrCodeUrl: '',
  whatsappNumber: '',
  isAvailable: true,
};

function toDateOrNull(val: unknown): Date | null {
  if (val instanceof Timestamp) return val.toDate();
  if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  return null;
}

function mapOrderDoc(data: Record<string, unknown>): OrderRecord {
  return {
    orderId: String(data.orderId || ''),
    userId: String(data.userId || ''),
    name: String(data.name || ''),
    mobile: String(data.mobile || ''),
    email: String(data.email || ''),
    utr: String(data.utr || ''),
    screenshotUrl: String(data.screenshotUrl || ''),
    amount: Number(data.amount || 0),
    status: (data.status as OrderStatus) || 'PENDING',
    rejectionReason: String(data.rejectionReason || ''),
    adminId: String(data.adminId || ''),
    createdAt: toDateOrNull(data.createdAt),
    approvedAt: toDateOrNull(data.approvedAt),
    updatedAt: toDateOrNull(data.updatedAt),
  };
}

export async function signInWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function checkUserIsAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  if (user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeCourseSettings(
  onChange: (settings: CourseSettings) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'settings/course';
  return onSnapshot(
    doc(db, 'settings', 'course'),
    (snap) => {
      if (!snap.exists()) {
        onChange(DEFAULT_COURSE_SETTINGS);
        return;
      }
      const d = snap.data();
      onChange({
        courseName: String(d.courseName || DEFAULT_COURSE_SETTINGS.courseName),
        courseDescription: String(d.courseDescription || DEFAULT_COURSE_SETTINGS.courseDescription),
        courseCoverUrl: String(d.courseCoverUrl || DEFAULT_COURSE_COVER),
        originalPrice: Number(d.originalPrice ?? DEFAULT_COURSE_SETTINGS.originalPrice),
        showOriginalPrice: Boolean(d.showOriginalPrice ?? true),
        coursePrice: Number(d.coursePrice ?? DEFAULT_COURSE_SETTINGS.coursePrice),
        upiId: String(d.upiId || DEFAULT_COURSE_SETTINGS.upiId),
        qrCodeUrl: String(d.qrCodeUrl || ''),
        whatsappNumber: String(d.whatsappNumber || ''),
        isAvailable: Boolean(d.isAvailable ?? true),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export async function saveCourseSettings(settings: CourseSettings): Promise<void> {
  const path = 'settings/course';
  try {
    await setDoc(doc(db, 'settings', 'course'), {
      courseName: settings.courseName.trim().slice(0, 150),
      courseDescription: settings.courseDescription.trim().slice(0, 1000),
      courseCoverUrl: settings.courseCoverUrl.trim().slice(0, 2048),
      originalPrice: Number(settings.originalPrice) || 0,
      showOriginalPrice: Boolean(settings.showOriginalPrice),
      coursePrice: Math.max(1, Number(settings.coursePrice) || 99),
      upiId: settings.upiId.trim().slice(0, 120),
      qrCodeUrl: settings.qrCodeUrl.trim().slice(0, 2048),
      whatsappNumber: settings.whatsappNumber.trim().slice(0, 25),
      isAvailable: Boolean(settings.isAvailable),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function generateOrderId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const randomVals = new Uint32Array(6);
  crypto.getRandomValues(randomVals);
  for (let i = 0; i < 6; i++) {
    suffix += chars[randomVals[i] % chars.length];
  }
  return `ORD-${y}${m}${d}-${suffix}`;
}

export function normalizeUtr(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadPaymentScreenshot(
  file: File,
  user: User,
  orderId: string
): Promise<string> {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Only JPG, JPEG, and PNG screenshots are allowed.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Screenshot file size must be under 5 MB.');
  }

  // Primary: upload directly to Firebase Storage
  try {
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const storageRef = ref(storage, `payment_screenshots/${user.uid}/${orderId}.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return await getDownloadURL(storageRef);
  } catch {
    // Fallback: authenticated backend upload when Firebase Storage bucket rules aren't configured yet
    const dataUrl = await readFileAsDataUrl(file);
    const idToken = await user.getIdToken();
    const res = await fetch('/api/uploads/screenshot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ dataUrl, orderId }),
    });
    const payload = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !payload.url) {
      throw new Error(payload.error || 'Failed to upload payment screenshot.');
    }
    return payload.url;
  }
}

export async function uploadCourseAsset(
  file: File,
  user: User,
  kind: 'cover' | 'qr'
): Promise<string> {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    throw new Error('Only JPG, JPEG, PNG, or WEBP images are allowed.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image file size must be under 5 MB.');
  }

  try {
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const storageRef = ref(storage, `course_assets/${kind}_${Date.now()}.${ext}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return await getDownloadURL(storageRef);
  } catch {
    const dataUrl = await readFileAsDataUrl(file);
    const idToken = await user.getIdToken();
    const res = await fetch('/api/uploads/course-asset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ dataUrl, kind }),
    });
    const payload = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !payload.url) {
      throw new Error(payload.error || 'Failed to upload image.');
    }
    return payload.url;
  }
}

export async function submitPaymentOrder(params: {
  user: User;
  orderId: string;
  name: string;
  mobile: string;
  email: string;
  utr: string;
  screenshotUrl: string;
  amount: number;
}): Promise<void> {
  const normalizedUtr = normalizeUtr(params.utr);
  if (normalizedUtr.length < 6 || normalizedUtr.length > 40) {
    throw new Error('Please enter a valid UTR / Transaction Reference Number (6–40 alphanumeric characters).');
  }

  // Check duplicate UTR cleanly before committing
  const utrPath = `utr_locks/${normalizedUtr}`;
  let utrExists = false;
  try {
    const existingUtr = await getDoc(doc(db, 'utr_locks', normalizedUtr));
    utrExists = existingUtr.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, utrPath);
  }

  if (utrExists) {
    throw new Error(
      `UTR "${normalizedUtr}" has already been submitted. Duplicate UTR submissions are not allowed.`
    );
  }

  // Upsert user profile first
  const userPath = `users/${params.user.uid}`;
  try {
    const userRef = doc(db, 'users', params.user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: params.user.uid,
        name: params.name.trim().slice(0, 120),
        mobile: params.mobile.trim().slice(0, 20),
        email: (params.email.trim() || params.user.email || '').slice(0, 160),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: params.name.trim().slice(0, 120),
        mobile: params.mobile.trim().slice(0, 20),
        email: (params.email.trim() || params.user.email || '').slice(0, 160),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  // Atomic batch write: orders/{orderId} + utr_locks/{utr}
  const orderPath = `orders/${params.orderId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'orders', params.orderId), {
      orderId: params.orderId,
      userId: params.user.uid,
      name: params.name.trim().slice(0, 120),
      mobile: params.mobile.trim().slice(0, 15),
      email: (params.email.trim() || params.user.email || '').slice(0, 160),
      utr: normalizedUtr,
      screenshotUrl: params.screenshotUrl.slice(0, 2048),
      amount: Number(params.amount),
      status: 'PENDING',
      rejectionReason: '',
      adminId: '',
      createdAt: serverTimestamp(),
      approvedAt: null,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'utr_locks', normalizedUtr), {
      utr: normalizedUtr,
      orderId: params.orderId,
      userId: params.user.uid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, orderPath);
  }
}

export function subscribeUserOrders(
  userId: string,
  onChange: (orders: OrderRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'orders';
  const q = query(collection(db, 'orders'), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => mapOrderDoc(d.data()))
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
      onChange(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export function subscribeAllOrders(
  onChange: (orders: OrderRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'orders';
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapOrderDoc(d.data()));
      onChange(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export async function trackOrderById(orderId: string): Promise<OrderRecord | null> {
  const cleanId = orderId.trim();
  const path = `orders/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'orders', cleanId));
    if (!snap.exists()) return null;
    return mapOrderDoc(snap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function approveOrder(orderId: string, adminUid: string): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'APPROVED',
      adminId: adminUid,
      approvedAt: serverTimestamp(),
      rejectionReason: '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rejectOrder(
  orderId: string,
  adminUid: string,
  reason: string
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new Error('Please enter a clear rejection reason (at least 3 characters).');
  }
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'REJECTED',
      adminId: adminUid,
      approvedAt: null,
      rejectionReason: trimmed.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function requestTelegramInvite(
  orderId: string,
  user: User
): Promise<{ inviteLink: string; expiresAt: number }> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/telegram/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ orderId }),
  });
  const data = (await res.json()) as {
    inviteLink?: string;
    expiresAt?: number;
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.inviteLink) {
    throw new Error(data.error || 'Unable to generate Telegram access link.');
  }
  return {
    inviteLink: data.inviteLink,
    expiresAt: data.expiresAt || Date.now() + 600000,
  };
}

export async function fetchAdminTelegramStatus(user: User): Promise<TelegramConfigStatus> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin/telegram-status', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error('Failed to load Telegram status.');
  }
  return (await res.json()) as TelegramConfigStatus;
}

export async function saveAdminTelegramChannel(
  user: User,
  channelId: string
): Promise<{ saved: boolean; chatTitle?: string; botTokenConfigured: boolean }> {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin/telegram-config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ channelId }),
  });
  const data = (await res.json()) as {
    saved?: boolean;
    chatTitle?: string;
    botTokenConfigured?: boolean;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save Telegram Channel ID.');
  }
  return {
    saved: Boolean(data.saved),
    chatTitle: data.chatTitle,
    botTokenConfigured: Boolean(data.botTokenConfigured),
  };
}
