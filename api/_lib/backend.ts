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

interface TelegramServerConfig {
  channelId: string;
  updatedAt: string;
  updatedBy: string;
}

interface AccessGrantRecord {
  orderCode: string;
  grantedAt: string;
  expiresAt: number;
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
const TELEGRAM_CONFIG_PATH = path.resolve(WORKSPACE_ROOT, '.telegram-config.json');
const ACCESS_GRANTS_PATH = path.resolve(WORKSPACE_ROOT, '.access-grants.json');

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

function getStoredTelegramConfig(): TelegramServerConfig | null {
  try {
    if (!fs.existsSync(TELEGRAM_CONFIG_PATH)) return null;
    const raw = fs.readFileSync(TELEGRAM_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as TelegramServerConfig;
  } catch {
    return null;
  }
}

function trySaveStoredTelegramConfig(config: TelegramServerConfig): boolean {
  if (isServerlessReadOnly()) return false;
  try {
    fs.writeFileSync(TELEGRAM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function readLocalAccessGrants(): Record<string, AccessGrantRecord> {
  try {
    if (!fs.existsSync(ACCESS_GRANTS_PATH)) return {};
    const raw = fs.readFileSync(ACCESS_GRANTS_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, AccessGrantRecord>;
  } catch {
    return {};
  }
}

function trySaveLocalAccessGrant(record: AccessGrantRecord): void {
  if (isServerlessReadOnly()) return;
  try {
    const current = readLocalAccessGrants();
    current[record.orderCode] = record;
    fs.writeFileSync(ACCESS_GRANTS_PATH, JSON.stringify(current, null, 2), 'utf-8');
  } catch {
    // Firestore access_grants is the authoritative store
  }
}

function tryRemoveLocalAccessGrant(orderCode: string): void {
  if (isServerlessReadOnly()) return;
  try {
    const current = readLocalAccessGrants();
    if (current[orderCode]) {
      delete current[orderCode];
      fs.writeFileSync(ACCESS_GRANTS_PATH, JSON.stringify(current, null, 2), 'utf-8');
    }
  } catch {
    // Ignore on read-only filesystems
  }
}

async function getEffectiveChannelId(fbConfig: FirebaseAppletConfig): Promise<string> {
  try {
    const baseUrl = getFirestoreBaseUrl(fbConfig);
    const res = await fetch(
      `${baseUrl}/telegram_settings/channel?key=${encodeURIComponent(fbConfig.apiKey)}`
    );
    if (res.ok) {
      const doc = (await res.json()) as {
        fields?: { channelId?: { stringValue?: string } };
      };
      const fsChannelId = (doc.fields?.channelId?.stringValue || '').trim();
      if (/^-100\d{5,20}$/.test(fsChannelId)) return fsChannelId;
    }
  } catch {
    // Fall back to env/local config
  }
  const envVal = (process.env.TELEGRAM_CHANNEL_ID || '').trim();
  if (/^-100\d{5,20}$/.test(envVal)) return envVal;
  const stored = getStoredTelegramConfig();
  return stored?.channelId?.trim() || '';
}

function getEffectiveBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
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
      // On local non-serverless environments, keep local disk fallback if compressed size exceeded
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

    const localGrants = readLocalAccessGrants();
    let accessClaimed = Boolean(localGrants[rawCode]);
    if (!accessClaimed) {
      const grantRes = await fetch(
        `${baseUrl}/access_grants/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
      );
      accessClaimed = grantRes.ok;
    }

    sendJson(res, 200, {
      orderCode: rawCode,
      status,
      rejectionReason,
      amount,
      createdAt: doc.fields?.createdAt?.timestampValue || null,
      updatedAt: doc.fields?.updatedAt?.timestampValue || null,
      accessClaimed,
    });
  } catch (err) {
    handleError(res, err, 'Unable to check order status right now.');
  }
}

// ---------------------------------------------------------------------------
// 4. POST /api/telegram/invite
// ---------------------------------------------------------------------------
export async function handleTelegramInvite(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    if (!checkRateLimit(req, res, 'invite', 12, 10 * 60 * 1000)) return;

    const body = await readJsonBody<{ orderCode?: string }>(req);
    const rawCode = String(body.orderCode || '')
      .trim()
      .toUpperCase();

    if (!ORDER_CODE_REGEX.test(rawCode)) {
      throw new HttpError(400, 'Valid Unique Order Code is required.');
    }

    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);

    // Step 1: Verify order status
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
        'Course access is locked. Only APPROVED orders can generate a Telegram invite link.'
      );
    }

    // Step 2: Check single-use access grant lock
    const localGrants = readLocalAccessGrants();
    const grantUrl = `${baseUrl}/access_grants/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`;
    const existingGrantRes = await fetch(grantUrl);

    if (localGrants[rawCode] || existingGrantRes.ok) {
      throw new HttpError(
        403,
        'इस Unique Code के लिए Telegram Invite Link पहले ही जनरेट किया जा चुका है। सुरक्षा कारणों से प्रत्येक ऑर्डर से केवल एक बार ही लिंक जनरेट किया जा सकता है। सहायता के लिए WhatsApp Support से संपर्क करें।',
        'ACCESS_ALREADY_CLAIMED'
      );
    }

    // Step 3: Verify Telegram Bot configuration on server
    const botToken = getEffectiveBotToken();
    const channelId = await getEffectiveChannelId(fbConfig);
    if (!botToken || !channelId) {
      throw new HttpError(
        503,
        'Telegram Bot integration is not yet configured. Administrator must connect the Private Channel (-100...) in /admin and ensure TELEGRAM_BOT_TOKEN is set on the server.',
        'TELEGRAM_NOT_CONFIGURED'
      );
    }

    // Step 4: Call Telegram Bot API createChatInviteLink (member_limit=1, 5-minute expiry)
    const expireUnix = Math.floor(Date.now() / 1000) + 300;
    const tgResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelId,
          name: `Order ${rawCode}`,
          expire_date: expireUnix,
          member_limit: 1,
          creates_join_request: false,
        }),
      }
    );

    const tgData = (await tgResponse.json()) as {
      ok: boolean;
      description?: string;
      result?: { invite_link?: string };
    };

    if (!tgData.ok || !tgData.result?.invite_link) {
      console.error('Telegram API error:', tgData);
      throw new HttpError(
        502,
        `Telegram API rejected invite generation: ${
          tgData.description || 'Verify bot admin permissions (Invite Users via Link) and -100 channel ID.'
        }`
      );
    }

    // Step 5: Persist access-grant lock in Firestore
    const docRoot = getDocRoot(fbConfig);
    await fetch(`${baseUrl}:commit?key=${encodeURIComponent(fbConfig.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${docRoot}/access_grants/${rawCode}`,
              fields: {
                orderCode: { stringValue: rawCode },
              },
            },
            updateTransforms: [{ fieldPath: 'grantedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { exists: false },
          },
        ],
      }),
    });

    trySaveLocalAccessGrant({
      orderCode: rawCode,
      grantedAt: new Date().toISOString(),
      expiresAt: expireUnix * 1000,
    });

    sendJson(res, 200, {
      inviteLink: tgData.result.invite_link,
      expiresAt: expireUnix * 1000,
      memberLimit: 1,
    });
  } catch (err) {
    handleError(res, err, 'Internal server error while generating Telegram access.');
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
// 6. POST /api/uploads/course-asset & GET /api/course-assets/:assetId
// ---------------------------------------------------------------------------
export async function handleUploadCourseAsset(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const { idToken } = await requireAdminAuth(req);

    const body = await readJsonBody<{ dataUrl?: string; kind?: string }>(req);
    if (!body.dataUrl || typeof body.dataUrl !== 'string') {
      throw new HttpError(400, 'Missing image data.');
    }

    const parsed = parseImageDataUrl(body.dataUrl);
    if (!parsed) {
      throw new HttpError(400, 'Only JPG, JPEG, PNG, or WEBP images up to 5MB are allowed.');
    }

    const safeKind = body.kind === 'qr' ? 'qr' : 'cover';
    const hash = crypto.randomBytes(8).toString('hex');
    const assetId = `asset_${safeKind}_${hash}`;
    const fbConfig = getFirebaseConfig();

    const storageUrl = await tryUploadToFirebaseStorage({
      fbConfig,
      objectName: `course_assets/${assetId}.${parsed.ext}`,
      buffer: parsed.buffer,
      mime: parsed.mime,
      idToken,
    });

    if (storageUrl) {
      sendJson(res, 200, { url: storageUrl });
      return;
    }

    if (parsed.normalizedDataUrl.length > MAX_FIRESTORE_DATAURL_CHARS) {
      throw new HttpError(
        413,
        'Image is too large for database storage. Please compress it under 650 KB.'
      );
    }

    const baseUrl = getFirestoreBaseUrl(fbConfig);
    const docRoot = getDocRoot(fbConfig);
    const commitRes = await fetch(`${baseUrl}:commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${docRoot}/course_assets/${assetId}`,
              fields: {
                assetId: { stringValue: assetId },
                dataUrl: { stringValue: parsed.normalizedDataUrl },
                mimeType: { stringValue: parsed.mime },
              },
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    });

    if (!commitRes.ok) {
      throw new HttpError(500, 'Failed to store course asset.');
    }

    sendJson(res, 200, { url: `/api/course-assets/${assetId}` });
  } catch (err) {
    handleError(res, err, 'Failed to store course asset.');
  }
}

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

// ---------------------------------------------------------------------------
// 7. Admin Telegram Endpoints & Access Reset
// ---------------------------------------------------------------------------
export async function handleAdminTelegramStatus(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    await requireAdminAuth(req);

    const fbConfig = getFirebaseConfig();
    const botToken = getEffectiveBotToken();
    const channelId = await getEffectiveChannelId(fbConfig);
    const maskedChannelId =
      channelId.length > 6
        ? `${channelId.slice(0, 5)}••••${channelId.slice(-3)}`
        : channelId
          ? 'Configured'
          : '';

    let botUsername = '';
    let chatTitle = '';
    if (botToken) {
      try {
        const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const meData = (await meRes.json()) as {
          ok: boolean;
          result?: { username?: string };
        };
        if (meData.ok && meData.result?.username) {
          botUsername = meData.result.username;
        }
      } catch {
        // Non-blocking
      }
      if (channelId) {
        try {
          const cRes = await fetch(
            `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(channelId)}`
          );
          const cData = (await cRes.json()) as {
            ok: boolean;
            result?: { title?: string };
          };
          if (cData.ok && cData.result?.title) {
            chatTitle = cData.result.title;
          }
        } catch {
          // Non-blocking
        }
      }
    }

    sendJson(res, 200, {
      botTokenConfigured: Boolean(botToken),
      botUsername,
      channelIdConfigured: Boolean(channelId),
      channelIdMasked: maskedChannelId,
      channelIdValue: channelId,
      chatTitle,
    });
  } catch (err) {
    handleError(res, err, 'Failed to load Telegram status.');
  }
}

export async function handleAdminTelegramDetect(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'GET')) return;
    await requireAdminAuth(req);

    const botToken = getEffectiveBotToken();
    if (!botToken) {
      throw new HttpError(
        503,
        'TELEGRAM_BOT_TOKEN is not configured on the server yet.'
      );
    }

    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = (await meRes.json()) as {
      ok: boolean;
      result?: { id?: number; username?: string };
    };
    const botUsername = meData.result?.username || '';
    const botId = meData.result?.id;

    const updatesRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?allowed_updates=${encodeURIComponent(
        JSON.stringify(['my_chat_member', 'channel_post', 'message'])
      )}`
    );
    const updatesData = (await updatesRes.json()) as {
      ok: boolean;
      result?: Array<{
        my_chat_member?: { chat?: { id: number; title?: string; type?: string; username?: string } };
        channel_post?: { chat?: { id: number; title?: string; type?: string; username?: string } };
        message?: {
          chat?: { id: number; title?: string; type?: string; username?: string };
          forward_origin?: { chat?: { id: number; title?: string; type?: string; username?: string } };
        };
      }>;
    };

    const found = new Map<string, { id: string; title: string; type: string; username?: string; botIsAdmin: boolean }>();

    if (updatesData.ok && Array.isArray(updatesData.result)) {
      for (const upd of updatesData.result) {
        const candidates = [
          upd.my_chat_member?.chat,
          upd.channel_post?.chat,
          upd.message?.chat,
          upd.message?.forward_origin?.chat,
        ];
        for (const ch of candidates) {
          if (!ch || (ch.type !== 'channel' && ch.type !== 'supergroup')) continue;
          const idStr = String(ch.id);
          if (!found.has(idStr)) {
            let botIsAdmin = false;
            if (botId) {
              try {
                const memRes = await fetch(
                  `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(
                    idStr
                  )}&user_id=${botId}`
                );
                const memData = (await memRes.json()) as {
                  ok: boolean;
                  result?: { status?: string; can_invite_users?: boolean };
                };
                botIsAdmin = Boolean(
                  memData.ok &&
                    memData.result?.status === 'administrator' &&
                    memData.result?.can_invite_users !== false
                );
              } catch {
                // Ignore
              }
            }
            found.set(idStr, {
              id: idStr,
              title: ch.title || 'Private Channel',
              type: ch.type,
              username: ch.username,
              botIsAdmin,
            });
          }
        }
      }
    }

    sendJson(res, 200, {
      botUsername,
      channels: Array.from(found.values()),
    });
  } catch (err) {
    handleError(res, err, 'Failed to detect Telegram channels.');
  }
}

export async function handleAdminTelegramConfig(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const { user, idToken } = await requireAdminAuth(req);

    const body = await readJsonBody<{ channelId?: string }>(req);
    const trimmed = String(body.channelId || '').trim();
    if (!trimmed || !/^-?\d{5,20}$/.test(trimmed)) {
      throw new HttpError(
        400,
        'Please enter a valid numeric Telegram Channel ID starting with -100 (e.g., -1001234567890).'
      );
    }

    if (!trimmed.startsWith('-100')) {
      throw new HttpError(
        400,
        `यह ID (${trimmed}) एक Personal Account / Chat की है, Private Channel की नहीं। Telegram Channel ID हमेशा -100 से शुरू होती है (जैसे -1001234567890)।`
      );
    }

    const botToken = getEffectiveBotToken();
    let chatTitle = '';
    if (botToken) {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const meData = (await meRes.json()) as {
        ok: boolean;
        result?: { id?: number; username?: string };
      };
      const botId = meData.result?.id;
      const botName = meData.result?.username ? `@${meData.result.username}` : 'your bot';

      const tgRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(trimmed)}`
      );
      const tgData = (await tgRes.json()) as {
        ok: boolean;
        description?: string;
        result?: { title?: string; type?: string };
      };
      if (!tgData.ok) {
        throw new HttpError(
          400,
          `Telegram verification failed: ${
            tgData.description || `Make sure ${botName} is an Administrator in this channel.`
          }`
        );
      }
      if (tgData.result?.type !== 'channel' && tgData.result?.type !== 'supergroup') {
        throw new HttpError(
          400,
          `This ID belongs to a "${tgData.result?.type || 'private'}" chat, not a Channel or Supergroup. Please enter your Course Channel ID (-100...).`
        );
      }
      chatTitle = tgData.result?.title || 'Private Course Channel';

      if (botId) {
        const memRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(
            trimmed
          )}&user_id=${botId}`
        );
        const memData = (await memRes.json()) as {
          ok: boolean;
          result?: { status?: string; can_invite_users?: boolean };
        };
        if (!memData.ok || memData.result?.status !== 'administrator') {
          throw new HttpError(
            400,
            `Channel "${chatTitle}" मिल गया, लेकिन ${botName} अभी इसका Administrator नहीं है। कृपया Telegram में चैनल खोलकर ${botName} को Admin बनाएं और "Invite Users via Link" ऑन करें।`
          );
        }
        if (memData.result?.can_invite_users === false) {
          throw new HttpError(
            400,
            `${botName} को "${chatTitle}" में "Invite Users via Link" की अनुमति नहीं मिली है। कृपया Telegram Channel Admins में इसे ऑन करें।`
          );
        }
      }
    }

    // Save persistently in Firestore /telegram_settings/channel (works across Vercel serverless cold starts)
    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);
    const docRoot = getDocRoot(fbConfig);
    const commitRes = await fetch(`${baseUrl}:commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: `${docRoot}/telegram_settings/channel`,
              fields: {
                channelId: { stringValue: trimmed },
                chatTitle: { stringValue: chatTitle.slice(0, 150) },
              },
            },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      }),
    });

    if (!commitRes.ok) {
      const errTxt = await commitRes.text();
      console.error('Failed saving telegram_settings/channel:', commitRes.status, errTxt);
      throw new HttpError(500, 'Failed to save Telegram Channel ID to database.');
    }

    trySaveStoredTelegramConfig({
      channelId: trimmed,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email || user.uid,
    });

    sendJson(res, 200, {
      saved: true,
      chatTitle,
      botTokenConfigured: Boolean(botToken),
    });
  } catch (err) {
    handleError(res, err, 'Failed to save Telegram configuration.');
  }
}

export async function handleAdminResetAccessGrant(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  try {
    if (!requireMethod(req, res, 'POST')) return;
    const { idToken } = await requireAdminAuth(req);

    const body = await readJsonBody<{ orderCode?: string }>(req);
    const rawCode = String(body.orderCode || '')
      .trim()
      .toUpperCase();
    if (!ORDER_CODE_REGEX.test(rawCode)) {
      throw new HttpError(400, 'Invalid order code.');
    }

    tryRemoveLocalAccessGrant(rawCode);
    const fbConfig = getFirebaseConfig();
    const baseUrl = getFirestoreBaseUrl(fbConfig);
    await fetch(`${baseUrl}/access_grants/${encodeURIComponent(rawCode)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });

    sendJson(res, 200, { reset: true });
  } catch (err) {
    handleError(res, err, 'Failed to reset access grant.');
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
