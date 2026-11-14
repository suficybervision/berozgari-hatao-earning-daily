import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const BOOTSTRAPPED_ADMIN_EMAIL = 'hajshdbdb262837@gmail.com';
const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_CODE_REGEX = /^SUFI-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const TELEGRAM_LINK_REGEX = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/;
const MAX_JSON_BODY_BYTES = 6 * 1024 * 1024;
const MAX_FIRESTORE_DATAURL_CHARS = 940000;

const FALLBACK_FIREBASE_CONFIG: FirebaseAppletConfig = {
  projectId: 'course-buy-195c9',
  appId: '1:929389374402:web:cabc6b069287166b16445b',
  apiKey: 'AIzaSyCtG9ODDWotQxBQLZ7HHG3iADhdgYry-BY',
  authDomain: 'course-buy-195c9.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-50421afa-252f-40f3-ba3d-b515e529538f',
  storageBucket: 'course-buy-195c9.firebasestorage.app',
  messagingSenderId: '929389374402',
};

const WORKSPACE_ROOT = process.cwd();
const UPLOADS_DIR = path.resolve(WORKSPACE_ROOT, 'uploads');

// Sliding-window IP rate limiter (best-effort per runtime instance)
const rateBuckets = new Map<string, number[]>();

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function sendBinary(
  res: ServerResponse,
  statusCode: number,
  contentType: string,
  cacheControl: string,
  data: Buffer
): void {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  res.end(data);
}

function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return fwd[0].split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  keyPrefix: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const ip = getClientIp(req);
  const bucketKey = `${keyPrefix}:${ip}`;
  const now = Date.now();
  const recent = (rateBuckets.get(bucketKey) || []).filter((ts) => now - ts < windowMs);
  if (recent.length >= maxRequests) {
    sendJson(res, 429, {
      error: 'Too many requests. Please wait a moment and try again.',
    });
    return false;
  }
  recent.push(now);
  rateBuckets.set(bucketKey, recent);
  return true;
}

export function getFirebaseConfig(): FirebaseAppletConfig {
  try {
    const configPath = path.resolve(WORKSPACE_ROOT, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as FirebaseAppletConfig;
    }
  } catch {
    // Fall back to static web config when running inside bundled serverless functions
  }
  return FALLBACK_FIREBASE_CONFIG;
}

export function getFirestoreBaseUrl(fbConfig: FirebaseAppletConfig): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    fbConfig.projectId
  )}/databases/${encodeURIComponent(fbConfig.firestoreDatabaseId)}/documents`;
}

function getDocRoot(fbConfig: FirebaseAppletConfig): string {
  return `projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents`;
}

function isServerlessReadOnly(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function generateCryptoOrderCode(): string {
  const segment = (len: number) => {
    let out = '';
    for (let i = 0; i < len; i++) {
      out += ORDER_CODE_ALPHABET[crypto.randomInt(0, ORDER_CODE_ALPHABET.length)];
    }
    return out;
  };
  return `SUFI-${segment(4)}-${segment(4)}`;
}

async function readJsonBody<T = Record<string, unknown>>(
  req: IncomingMessage & { body?: unknown }
): Promise<T> {
  if (req.body !== undefined) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body as T;
    }
    if (typeof req.body === 'string') {
      if (!req.body.trim()) return {} as T;
      try {
        return JSON.parse(req.body) as T;
      } catch {
        throw new HttpError(400, 'Invalid JSON request body.');
      }
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf-8').trim();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new HttpError(400, 'Invalid JSON request body.');
      }
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new HttpError(
        413,
        'Uploaded payload is too large. Please compress or choose a smaller screenshot (under 4 MB).'
      );
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON request body.');
  }
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  const fbConfig = getFirebaseConfig();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    users?: Array<{
      localId: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
    }>;
  };
  const user = data.users?.[0];
  if (!user || !user.localId) return null;
  return {
    uid: user.localId,
    email: user.email || '',
    emailVerified: Boolean(user.emailVerified),
    displayName: user.displayName,
  };
}

export async function checkIsAdmin(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (user.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const fbConfig = getFirebaseConfig();
  const url = `${getFirestoreBaseUrl(fbConfig)}/admins/${encodeURIComponent(user.uid)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  return res.ok;
}

async function requireAdminAuth(
  req: IncomingMessage
): Promise<{ user: VerifiedFirebaseUser; idToken: string }> {
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, 'Authentication required. Please sign in.');
  }
  const idToken = match[1].trim();
  const user = await verifyFirebaseIdToken(idToken);
  if (!user) {
    throw new HttpError(401, 'Invalid or expired authentication session.');
  }
  const isAdmin = await checkIsAdmin(user, idToken);
  if (!isAdmin) {
    throw new HttpError(403, 'Administrator privileges required.');
  }
  return { user, idToken };
}

function parseImageDataUrl(
  dataUrl: string
): { ext: string; mime: string; buffer: Buffer; normalizedDataUrl: string } | null {
  const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const rawMime = match[1];
  const rawExt = match[2];
  const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    return null;
  }
  const normalizedDataUrl = `data:${mime};base64,${match[3]}`;
  return { ext, mime, buffer, normalizedDataUrl };
}

async function tryUploadToFirebaseStorage(params: {
  fbConfig: FirebaseAppletConfig;
  objectName: string;
  buffer: Buffer;
  mime: string;
  idToken?: string;
}): Promise<string | null> {
  const downloadToken = crypto.randomUUID();
  try {
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
      params.fbConfig.storageBucket
    )}/o?uploadType=media&name=${encodeURIComponent(params.objectName)}`;

    const headers: Record<string, string> = {
      'Content-Type': params.mime,
      'X-Goog-Meta-firebaseStorageDownloadTokens': downloadToken,
    };
    if (params.idToken) {
      headers.Authorization = `Bearer ${params.idToken}`;
    }

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers,
      body: new Uint8Array(params.buffer),
    });

    if (res.ok) {
      const uploaded = (await res.json()) as { downloadTokens?: string };
      const token = uploaded.downloadTokens || downloadToken;
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
        params.fbConfig.storageBucket
      )}/o/${encodeURIComponent(params.objectName)}?alt=media&token=${encodeURIComponent(token)}`;
    }
  } catch {
    // Fall back to Firestore persistence when Storage bucket isn't provisioned
  }
  return null;
}

async function fetchCourseSettingsFromFirestore(fbConfig: FirebaseAppletConfig): Promise<{
  coursePrice: number;
  isAvailable: boolean;
}> {
  try {
    const url = `${getFirestoreBaseUrl(fbConfig)}/settings/course?key=${encodeURIComponent(fbConfig.apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { coursePrice: 99, isAvailable: true };
    }
    const doc = (await res.json()) as {
      fields?: {
        coursePrice?: { integerValue?: string; doubleValue?: number };
        isAvailable?: { booleanValue?: boolean };
      };
    };
    const rawPrice =
      doc.fields?.coursePrice?.doubleValue ??
      Number(doc.fields?.coursePrice?.integerValue || 99);
    const isAvailable = doc.fields?.isAvailable?.booleanValue ?? true;
    return {
      coursePrice: rawPrice > 0 ? rawPrice : 99,
      isAvailable,
    };
  } catch {
    return { coursePrice: 99, isAvailable: true };
  }
}

function handleError(res: ServerResponse, err: unknown, fallbackMessage: string): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, {
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }
  console.error(fallbackMessage, err);
  sendJson(res, 500, { error: fallbackMessage });
}

function requireMethod(req: IncomingMessage, res: ServerResponse, allowed: string): boolean {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', `${allowed}, OPTIONS`);
    res.end();
    return false;
  }
  if (req.method !== allowed) {
    sendJson(res, 405, { error: `Method ${req.method || 'UNKNOWN'} not allowed. Use ${allowed}.` });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 1. GET /api/health
// ---------------------------------------------------------------------------
export async function handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    const fbConfig = getFirebaseConfig();
    const courseMeta = await fetchCourseSettingsFromFirestore(fbConfig);
    sendJson(res, 200, {
      status: 'ok',
      projectId: fbConfig.projectId,
      databaseId: fbConfig.firestoreDatabaseId,
      storageBucket: fbConfig.storageBucket,
      courseAvailable: courseMeta.isAvailable,
      serverless: isServerlessReadOnly(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, 'Health check failed.');
  }
}

// ---------------------------------------------------------------------------
// 2. POST /api/orders/submit
// ---------------------------------------------------------------------------
export async function handleOrderSubmit(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    if (!checkRateLimit(req, res, 'submit', 15, 10 * 60 * 1000)) return;

    const body = await readJsonBody<{
      name?: string;
      mobile?: string;
      utr?: string;
      screenshotDataUrl?: string;
    }>(req);

    const cleanName = String(body.name || '').trim();
    const cleanMobile = String(body.mobile || '').trim();
    const cleanUtr = String(body.utr || '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();

    if (cleanName.length < 2 || cleanName.length > 120) {
      throw new HttpError(400, 'Please enter a valid Full Name (2–120 characters).');
    }

    const digitsOnly = cleanMobile.replace(/\D/g, '');
    if (!/^[0-9+\-\s]{10,15}$/.test(cleanMobile) || digitsOnly.length < 10) {
      throw new HttpError(400, 'Please enter a valid 10-digit Mobile Number.');
    }

    if (!/^[A-Z0-9]{6,40}$/.test(cleanUtr)) {
      throw new HttpError(
        400,
        'Please enter a valid UTR / Transaction ID (6–40 letters or digits).'
      );
    }

    if (!body.screenshotDataUrl || typeof body.screenshotDataUrl !== 'string') {
      throw new HttpError(400, 'Payment screenshot is required.');
    }

    const parsedImage = parseImageDataUrl(body.screenshotDataUrl);
    if (!parsedImage || parsedImage.ext === 'webp') {
      throw new HttpError(400, 'Only JPG, JPEG, or PNG payment screenshots up to 5 MB are allowed.');
    }

    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);

    // Authoritative course availability and price
    const courseMeta = await fetchCourseSettingsFromFirestore(fbConfig);
    if (!courseMeta.isAvailable) {
      throw new HttpError(403, 'Course enrollments are currently paused by the administrator.');
    }

    // Check duplicate UTR before generating code or storing screenshot
    const utrCheckRes = await fetch(
      `${baseUrl}/utr_locks/${encodeURIComponent(cleanUtr)}?key=${encodeURIComponent(fbConfig.apiKey)}`
    );
    if (utrCheckRes.ok) {
      throw new HttpError(
        409,
        `UTR "${cleanUtr}" पहले ही सबमिट किया जा चुका है। Duplicate UTR submissions are not allowed.`,
        'DUPLICATE_UTR'
      );
    }

    // Generate cryptographically random unique order code (e.g. SUFI-8K29-XP51)
    let orderCode = generateCryptoOrderCode();
    for (let attempt = 0; attempt < 4; attempt++) {
      const existsRes = await fetch(
        `${baseUrl}/order_tracking/${encodeURIComponent(orderCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
      );
      if (!existsRes.ok) break;
      orderCode = generateCryptoOrderCode();
    }

    // Try Firebase Storage first; otherwise store atomically in Firestore /order_screenshots/{orderCode}
    const storageUrl = await tryUploadToFirebaseStorage({
      fbConfig,
      objectName: `payment_screenshots/${orderCode}.${parsedImage.ext}`,
      buffer: parsedImage.buffer,
      mime: parsedImage.mime,
    });

    let screenshotUrl = storageUrl || `/api/screenshots/${orderCode}`;
    let includeScreenshotDoc = !storageUrl;

    if (includeScreenshotDoc && parsedImage.normalizedDataUrl.length > MAX_FIRESTORE_DATAURL_CHARS) {
      if (!isServerlessReadOnly()) {
        try {
          if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          const hash = crypto.randomBytes(6).toString('hex');
          const filename = `ss_${orderCode}_${hash}.${parsedImage.ext}`;
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), parsedImage.buffer);
          screenshotUrl = `/api/uploads/${filename}`;
          includeScreenshotDoc = false;
        } catch {
          throw new HttpError(
            413,
            'Screenshot file size is too large. Please upload a screenshot under 650 KB or retry from the checkout page.'
          );
        }
      } else {
        throw new HttpError(
          413,
          'Screenshot file size is too large for database storage. Please upload a smaller JPG/PNG screenshot.'
        );
      }
    }

    const docRoot = getDocRoot(fbConfig);
    const writes: Array<Record<string, unknown>> = [
      {
        update: {
          name: `${docRoot}/orders/${orderCode}`,
          fields: {
            orderCode: { stringValue: orderCode },
            name: { stringValue: cleanName },
            mobile: { stringValue: cleanMobile },
            utr: { stringValue: cleanUtr },
            screenshotUrl: { stringValue: screenshotUrl },
            amount: { doubleValue: courseMeta.coursePrice },
            status: { stringValue: 'PENDING' },
            rejectionReason: { stringValue: '' },
            adminId: { stringValue: '' },
            approvedAt: { nullValue: null },
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${docRoot}/order_tracking/${orderCode}`,
          fields: {
            orderCode: { stringValue: orderCode },
            amount: { doubleValue: courseMeta.coursePrice },
            status: { stringValue: 'PENDING' },
            rejectionReason: { stringValue: '' },
          },
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: false },
      },
      {
        update: {
          name: `${docRoot}/utr_locks/${cleanUtr}`,
          fields: {
            utr: { stringValue: cleanUtr },
            orderCode: { stringValue: orderCode },
          },
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      },
    ];

    if (includeScreenshotDoc) {
      writes.push({
        update: {
          name: `${docRoot}/order_screenshots/${orderCode}`,
          fields: {
            orderCode: { stringValue: orderCode },
            dataUrl: { stringValue: parsedImage.normalizedDataUrl },
            mimeType: { stringValue: parsedImage.mime },
          },
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      });
    }

    const commitRes = await fetch(
      `${baseUrl}:commit?key=${encodeURIComponent(fbConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes }),
      }
    );

    if (!commitRes.ok) {
      const errBody = await commitRes.text();
      console.error('Firestore order commit failed:', commitRes.status, errBody);
      if (errBody.includes('ALREADY_EXISTS')) {
        throw new HttpError(
          409,
          `UTR "${cleanUtr}" पहले ही सबमिट किया जा चुका है। Duplicate UTR submissions are not allowed.`,
          'DUPLICATE_UTR'
        );
      }
      if (commitRes.status === 403 || errBody.includes('PERMISSION_DENIED')) {
        throw new HttpError(
          500,
          'Database security rules rejected this order submission. Please contact administrator.'
        );
      }
      throw new HttpError(500, 'Unable to save order to database. Please try again.');
    }

    sendJson(res, 201, {
      orderCode,
      status: 'PENDING',
      amount: courseMeta.coursePrice,
    });
  } catch (err) {
    handleError(res, err, 'Unexpected error while submitting payment request.');
  }
}

// ---------------------------------------------------------------------------
// 3. POST /api/orders/track
// ---------------------------------------------------------------------------
export async function handleOrderTrack(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    if (!checkRateLimit(req, res, 'track', 30, 60 * 1000)) return;

    const body = await readJsonBody<{ orderCode?: string }>(req);
    const rawCode = String(body.orderCode || '')
      .trim()
      .toUpperCase();

    if (!ORDER_CODE_REGEX.test(rawCode)) {
      throw new HttpError(
        400,
        'कृपया सही Unique Order Code दर्ज करें (उदाहरण: SUFI-8K29-XP51)।'
      );
    }

    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);
    const trackRes = await fetch(
      `${baseUrl}/order_tracking/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
    );

    if (!trackRes.ok) {
      if (trackRes.status === 404) {
        throw new HttpError(
          404,
          'इस Unique Code से कोई ऑर्डर नहीं मिला। कृपया कोड दोबारा जांचें।'
        );
      }
      throw new HttpError(502, 'Unable to reach order tracking database. Please retry.');
    }

    const doc = (await trackRes.json()) as {
      fields?: {
        orderCode?: { stringValue?: string };
        status?: { stringValue?: string };
        rejectionReason?: { stringValue?: string };
        amount?: { doubleValue?: number; integerValue?: string };
        createdAt?: { timestampValue?: string };
        updatedAt?: { timestampValue?: string };
      };
    };

    const status = doc.fields?.status?.stringValue || 'PENDING';
    const rejectionReason = doc.fields?.rejectionReason?.stringValue || '';
    const amount =
      doc.fields?.amount?.doubleValue ??
      Number(doc.fields?.amount?.integerValue || 99);

    sendJson(res, 200, {
      orderCode: rawCode,
      status,
      rejectionReason,
      amount,
      createdAt: doc.fields?.createdAt?.timestampValue || null,
      updatedAt: doc.fields?.updatedAt?.timestampValue || null,
    });
  } catch (err) {
    handleError(res, err, 'Unable to check order status right now.');
  }
}

// ---------------------------------------------------------------------------
// 4. POST /api/telegram/invite (Returns Admin-Saved Channel Invite Link for APPROVED Orders)
// ---------------------------------------------------------------------------
export async function handleTelegramInvite(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    if (!checkRateLimit(req, res, 'invite', 20, 10 * 60 * 1000)) return;

    const body = await readJsonBody<{ orderCode?: string }>(req);
    const rawCode = String(body.orderCode || '')
      .trim()
      .toUpperCase();

    if (!ORDER_CODE_REGEX.test(rawCode)) {
      throw new HttpError(400, 'Valid Unique Order Code is required.');
    }

    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);

    // Step 1: Verify order status in Firestore
    const trackRes = await fetch(
      `${baseUrl}/order_tracking/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
    );
    if (!trackRes.ok) {
      throw new HttpError(404, 'Order code not found.');
    }

    const trackDoc = (await trackRes.json()) as {
      fields?: { status?: { stringValue?: string } };
    };
    const status = trackDoc.fields?.status?.stringValue;

    if (status !== 'APPROVED') {
      throw new HttpError(
        403,
        'Course access is locked. Only APPROVED orders can open the Telegram channel.'
      );
    }

    // Step 2: Fetch Admin-configured Private Telegram Channel Invite Link from Firestore
    const tgRes = await fetch(
      `${baseUrl}/telegram_settings/channel?key=${encodeURIComponent(fbConfig.apiKey)}`
    );
    if (!tgRes.ok) {
      throw new HttpError(
        503,
        'Telegram Channel Invite Link अभी Admin Panel में सेव नहीं किया गया है। कृपया WhatsApp Support से संपर्क करें।'
      );
    }

    const tgDoc = (await tgRes.json()) as {
      fields?: { inviteLink?: { stringValue?: string } };
    };
    const inviteLink = (tgDoc.fields?.inviteLink?.stringValue || '').trim();

    if (!TELEGRAM_LINK_REGEX.test(inviteLink)) {
      throw new HttpError(
        503,
        'Telegram Channel Invite Link उपलब्ध नहीं है। कृपया Admin Panel से सही https://t.me/+... लिंक सेव करें।'
      );
    }

    sendJson(res, 200, {
      inviteLink,
    });
  } catch (err) {
    handleError(res, err, 'Unable to load Telegram channel link.');
  }
}

// ---------------------------------------------------------------------------
// 5. GET /api/screenshots/:orderCode (Admin-Only Protected Screenshot Retrieval)
// ---------------------------------------------------------------------------
export async function handleGetScreenshot(
  req: IncomingMessage,
  res: ServerResponse,
  rawOrderCode: string
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    const orderCode = String(rawOrderCode || '').trim().toUpperCase();
    if (!ORDER_CODE_REGEX.test(orderCode)) {
      throw new HttpError(400, 'Invalid order code.');
    }

    const { idToken } = await requireAdminAuth(req);
    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);

    const docRes = await fetch(
      `${baseUrl}/order_screenshots/${encodeURIComponent(orderCode)}`,
      {
        headers: { Authorization: `Bearer ${idToken}` },
      }
    );

    if (!docRes.ok) {
      throw new HttpError(404, 'Payment screenshot not found.');
    }

    const doc = (await docRes.json()) as {
      fields?: {
        dataUrl?: { stringValue?: string };
        mimeType?: { stringValue?: string };
      };
    };

    const dataUrl = doc.fields?.dataUrl?.stringValue || '';
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) {
      throw new HttpError(404, 'Stored screenshot payload is corrupted or empty.');
    }

    sendBinary(res, 200, parsed.mime, 'private, no-store', parsed.buffer);
  } catch (err) {
    handleError(res, err, 'Failed to load payment screenshot.');
  }
}

// ---------------------------------------------------------------------------
// 6. GET /api/course-assets/:assetId
// ---------------------------------------------------------------------------
export async function handleGetCourseAsset(
  req: IncomingMessage,
  res: ServerResponse,
  rawAssetId: string
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    const assetId = String(rawAssetId || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(assetId)) {
      throw new HttpError(400, 'Invalid asset identifier.');
    }

    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);
    const docRes = await fetch(
      `${baseUrl}/course_assets/${encodeURIComponent(assetId)}?key=${encodeURIComponent(fbConfig.apiKey)}`
    );

    if (!docRes.ok) {
      throw new HttpError(404, 'Course asset not found.');
    }

    const doc = (await docRes.json()) as {
      fields?: { dataUrl?: { stringValue?: string } };
    };
    const dataUrl = doc.fields?.dataUrl?.stringValue || '';
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) {
      throw new HttpError(404, 'Course asset image is invalid.');
    }

    sendBinary(res, 200, parsed.mime, 'public, max-age=86400', parsed.buffer);
  } catch (err) {
    handleError(res, err, 'Failed to load course asset.');
  }
}

// Legacy local disk asset serving (only when running locally with existing uploads/)
export async function handleLegacyLocalUpload(
  req: IncomingMessage,
  res: ServerResponse,
  rawFilename: string
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    const filename = String(rawFilename || '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      throw new HttpError(400, 'Invalid filename.');
    }
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new HttpError(404, 'File not found.');
    }

    if (filename.startsWith('ss_')) {
      await requireAdminAuth(req);
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const data = fs.readFileSync(filePath);
    sendBinary(
      res,
      200,
      contentType,
      filename.startsWith('asset_') ? 'public, max-age=86400' : 'private, no-store',
      data
    );
  } catch (err) {
    handleError(res, err, 'Failed to load file.');
  }
}
