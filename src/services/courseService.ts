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
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, db, googleProvider, handleFirestoreError, OperationType, storage } from '../firebase';
import type {
  CourseSettings,
  OrderRecord,
  OrderStatus,
  TrackingResult,
} from '../types';

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
    orderCode: String(data.orderCode || ''),
    name: String(data.name || ''),
    mobile: String(data.mobile || ''),
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

export function normalizeUtr(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeOrderCode(input: string): string {
  return input.trim().toUpperCase();
}

async function safeFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error('Network error while contacting server. Please check your internet connection.');
  }

  const rawText = await res.text();
  const trimmed = rawText.trim();
  let parsed: unknown = null;

  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  } else {
    parsed = {};
  }

  if (parsed === null || typeof parsed !== 'object') {
    if (res.status === 404) {
      throw new Error(
        'Server API endpoint not found (HTTP 404). Please verify backend deployment.'
      );
    }
    if (res.status === 413) {
      throw new Error(
        'Screenshot file is too large for upload (HTTP 413). Please choose a smaller image.'
      );
    }
    throw new Error(
      `Server returned an unexpected non-JSON response (HTTP ${res.status}). Please try again.`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!res.ok) {
    const serverError = typeof obj.error === 'string' && obj.error ? obj.error : '';
    throw new Error(serverError || `Request failed (HTTP ${res.status}).`);
  }

  return parsed as T;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(
  file: File,
  maxDataUrlChars = 650000
): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (rawDataUrl.length <= maxDataUrlChars && file.type !== 'image/webp') {
    return rawDataUrl;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to process screenshot image.'));
      image.src = objectUrl;
    });

    const dimensions = [1400, 1080, 840];
    const qualities = [0.85, 0.72, 0.58, 0.45];

    for (const maxDim of dimensions) {
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round((img.width || 800) * scale));
      const height = Math.max(1, Math.round((img.height || 600) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of qualities) {
        const compressed = canvas.toDataURL('image/jpeg', quality);
        if (compressed.length <= maxDataUrlChars) {
          return compressed;
        }
      }
    }

    if (rawDataUrl.length <= 900000) {
      return rawDataUrl;
    }
    throw new Error('Screenshot image is too large. Please upload a clearer, smaller screenshot.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Admin Authentication Only
export async function signInAdminWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutAdmin(): Promise<void> {
  await signOut(auth);
}

export async function checkUserIsAdmin(user: User | null): Promise<boolean> {
  if (!user || !user.emailVerified) return false;
  return user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
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

export async function uploadCourseAsset(
  file: File,
  _user: User,
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
    const dataUrl = await compressImageToDataUrl(file, 700000);
    const mimeMatch = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const assetId = `asset_${kind}_${Date.now()}`;
    const path = `course_assets/${assetId}`;
    try {
      await setDoc(doc(db, 'course_assets', assetId), {
        assetId,
        dataUrl,
        mimeType,
        updatedAt: serverTimestamp(),
      });
      return `/api/course-assets/${assetId}`;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
    throw new Error('Failed to upload image.');
  }
}

// Public Student Order Submission (No Student Login Required)
export async function submitOrderRequest(params: {
  name: string;
  mobile: string;
  utr: string;
  file: File;
}): Promise<{ orderCode: string; status: OrderStatus; amount: number }> {
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (!validTypes.includes(params.file.type)) {
    throw new Error('Only JPG, JPEG, and PNG payment screenshots are allowed.');
  }
  if (params.file.size > 5 * 1024 * 1024) {
    throw new Error('Screenshot file size must be under 5 MB.');
  }

  const screenshotDataUrl = await compressImageToDataUrl(params.file, 650000);

  const data = await safeFetchJson<{
    orderCode?: string;
    status?: OrderStatus;
    amount?: number;
  }>('/api/orders/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name.trim(),
      mobile: params.mobile.trim(),
      utr: normalizeUtr(params.utr),
      screenshotDataUrl,
    }),
  });

  if (!data.orderCode) {
    throw new Error('Failed to generate order tracking code. Please try again.');
  }

  return {
    orderCode: data.orderCode,
    status: data.status || 'PENDING',
    amount: Number(data.amount || 99),
  };
}

// Public Unique Order Code Tracking (No Login Required)
export async function trackOrderByCode(orderCode: string): Promise<TrackingResult> {
  const cleanCode = normalizeOrderCode(orderCode);
  const data = await safeFetchJson<Partial<TrackingResult>>('/api/orders/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderCode: cleanCode }),
  });

  if (!data.orderCode) {
    throw new Error('Order code not found.');
  }

  return {
    orderCode: data.orderCode,
    status: (data.status as OrderStatus) || 'PENDING',
    rejectionReason: String(data.rejectionReason || ''),
    amount: Number(data.amount || 99),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

// Public Telegram Channel Link Retrieval via Verified Approved Order Code
export async function requestTelegramInviteByCode(
  orderCode: string
): Promise<{ inviteLink: string }> {
  const cleanCode = normalizeOrderCode(orderCode);
  const data = await safeFetchJson<{
    inviteLink?: string;
  }>('/api/telegram/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderCode: cleanCode }),
  });

  if (!data.inviteLink) {
    throw new Error('Telegram channel link is not configured yet.');
  }

  return {
    inviteLink: data.inviteLink,
  };
}

// Admin Orders Management
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

export async function approveOrder(orderCode: string, adminUid: string): Promise<void> {
  const path = `orders/${orderCode}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', orderCode), {
      status: 'APPROVED',
      adminId: adminUid,
      approvedAt: serverTimestamp(),
      rejectionReason: '',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'order_tracking', orderCode), {
      status: 'APPROVED',
      rejectionReason: '',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function rejectOrder(
  orderCode: string,
  adminUid: string,
  reason: string
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new Error('Please enter a clear rejection reason (at least 3 characters).');
  }
  const path = `orders/${orderCode}`;
  try {
    const cleanReason = trimmed.slice(0, 500);
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', orderCode), {
      status: 'REJECTED',
      adminId: adminUid,
      approvedAt: null,
      rejectionReason: cleanReason,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'order_tracking', orderCode), {
      status: 'REJECTED',
      rejectionReason: cleanReason,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchAdminTelegramInviteLink(): Promise<string> {
  const path = 'telegram_settings/channel';
  try {
    const snap = await getDoc(doc(db, 'telegram_settings', 'channel'));
    if (!snap.exists()) return '';
    return String(snap.data().inviteLink || '');
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return '';
  }
}

export async function saveAdminTelegramInviteLink(inviteLink: string): Promise<string> {
  const cleaned = inviteLink.trim();
  if (!/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/.test(cleaned)) {
    throw new Error(
      'कृपया सही Telegram Private Channel Invite Link डालें (जैसे: https://t.me/+AbCdEfGhIjKlMnOp)।'
    );
  }
  const path = 'telegram_settings/channel';
  try {
    await setDoc(doc(db, 'telegram_settings', 'channel'), {
      inviteLink: cleaned.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    return cleaned;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw new Error('Failed to save Telegram Channel Invite Link.');
  }
}
