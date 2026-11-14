import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

interface AuthenticatedRequest extends Request {
  user?: VerifiedFirebaseUser;
  idToken?: string;
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

const BOOTSTRAPPED_ADMIN_EMAIL = 'hajshdbdb262837@gmail.com';
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const TELEGRAM_CONFIG_PATH = path.resolve(__dirname, '.telegram-config.json');
const ACCESS_GRANTS_PATH = path.resolve(__dirname, '.access-grants.json');
const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_CODE_REGEX = /^SUFI-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Simple sliding-window IP rate limiter
const rateBuckets = new Map<string, number[]>();

function createRateLimiter(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const bucketKey = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const recent = (rateBuckets.get(bucketKey) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
      return;
    }
    recent.push(now);
    rateBuckets.set(bucketKey, recent);
    next();
  };
}

function getFirebaseConfig(): FirebaseAppletConfig {
  const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

function getFirestoreBaseUrl(fbConfig: FirebaseAppletConfig): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    fbConfig.projectId
  )}/databases/${encodeURIComponent(fbConfig.firestoreDatabaseId)}/documents`;
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

function saveStoredTelegramConfig(config: TelegramServerConfig): void {
  fs.writeFileSync(TELEGRAM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
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

function saveLocalAccessGrant(record: AccessGrantRecord): void {
  const current = readLocalAccessGrants();
  current[record.orderCode] = record;
  fs.writeFileSync(ACCESS_GRANTS_PATH, JSON.stringify(current, null, 2), 'utf-8');
}

function removeLocalAccessGrant(orderCode: string): void {
  const current = readLocalAccessGrants();
  if (current[orderCode]) {
    delete current[orderCode];
    fs.writeFileSync(ACCESS_GRANTS_PATH, JSON.stringify(current, null, 2), 'utf-8');
  }
}

function getEffectiveChannelId(): string {
  const envVal = (process.env.TELEGRAM_CHANNEL_ID || '').trim();
  if (envVal) return envVal;
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

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
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

async function checkIsAdmin(user: VerifiedFirebaseUser, idToken: string): Promise<boolean> {
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

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    const idToken = match[1].trim();
    const user = await verifyFirebaseIdToken(idToken);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired authentication session.' });
      return;
    }
    req.user = user;
    req.idToken = idToken;
    next();
  } catch (err) {
    console.error('Auth verification error:', err);
    res.status(401).json({ error: 'Authentication verification failed.' });
  }
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    if (!req.user || !req.idToken) return;
    const isAdmin = await checkIsAdmin(req.user, req.idToken);
    if (!isAdmin) {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }
    next();
  });
}

function parseImageDataUrl(dataUrl: string): { ext: string; mime: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1];
  const rawExt = match[2];
  const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
  const buffer = Buffer.from(match[3], 'base64');
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
    return null;
  }
  return { ext, mime, buffer };
}

async function uploadToFirebaseStorageOrFallback(params: {
  fbConfig: FirebaseAppletConfig;
  orderCode: string;
  buffer: Buffer;
  mime: string;
  ext: string;
}): Promise<string> {
  const objectName = `payment_screenshots/${params.orderCode}.${params.ext}`;
  const downloadToken = crypto.randomUUID();

  try {
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
      params.fbConfig.storageBucket
    )}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': params.mime,
        'X-Goog-Meta-firebaseStorageDownloadTokens': downloadToken,
      },
      body: new Uint8Array(params.buffer),
    });

    if (res.ok) {
      const uploaded = (await res.json()) as { downloadTokens?: string; name?: string };
      const token = uploaded.downloadTokens || downloadToken;
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
        params.fbConfig.storageBucket
      )}/o/${encodeURIComponent(objectName)}?alt=media&token=${encodeURIComponent(token)}`;
    }
  } catch {
    // Fall back to protected server storage when Firebase Storage rules aren't configured
  }

  const hash = crypto.randomBytes(6).toString('hex');
  const filename = `ss_${params.orderCode}_${hash}.${params.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), params.buffer);
  return `/api/uploads/${filename}`;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  const submitLimiter = createRateLimiter('submit', 12, 10 * 60 * 1000);
  const trackLimiter = createRateLimiter('track', 25, 60 * 1000);
  const inviteLimiter = createRateLimiter('invite', 10, 10 * 60 * 1000);

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // 1. Public Order Submission (No Student Login Required - Validated & Committed Server-Side)
  app.post('/api/orders/submit', submitLimiter, async (req: Request, res: Response) => {
    try {
      const { name, mobile, utr, screenshotDataUrl } = req.body as {
        name?: string;
        mobile?: string;
        utr?: string;
        screenshotDataUrl?: string;
      };

      const cleanName = String(name || '').trim();
      const cleanMobile = String(mobile || '').trim();
      const cleanUtr = String(utr || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

      if (cleanName.length < 2 || cleanName.length > 120) {
        res.status(400).json({ error: 'Please enter a valid Full Name (2–120 characters).' });
        return;
      }
      const digitsOnly = cleanMobile.replace(/\D/g, '');
      if (!/^[0-9+\-\s]{10,15}$/.test(cleanMobile) || digitsOnly.length < 10) {
        res.status(400).json({ error: 'Please enter a valid 10-digit Mobile Number.' });
        return;
      }
      if (!/^[A-Z0-9]{6,40}$/.test(cleanUtr)) {
        res.status(400).json({
          error: 'Please enter a valid UTR / Transaction ID (6–40 letters or digits).',
        });
        return;
      }
      if (!screenshotDataUrl || typeof screenshotDataUrl !== 'string') {
        res.status(400).json({ error: 'Payment screenshot is required.' });
        return;
      }

      const parsedImage = parseImageDataUrl(screenshotDataUrl);
      if (!parsedImage || parsedImage.ext === 'webp') {
        res.status(400).json({
          error: 'Only JPG, JPEG, or PNG payment screenshots up to 5 MB are allowed.',
        });
        return;
      }

      const fbConfig = getFirebaseConfig();
      const baseUrl = getFirestoreBaseUrl(fbConfig);

      // Verify course availability & authoritative price on backend
      const courseMeta = await fetchCourseSettingsFromFirestore(fbConfig);
      if (!courseMeta.isAvailable) {
        res.status(403).json({
          error: 'Course enrollments are currently paused by the administrator.',
        });
        return;
      }

      // Check duplicate UTR before generating code or storing screenshot
      const utrCheckRes = await fetch(
        `${baseUrl}/utr_locks/${encodeURIComponent(cleanUtr)}?key=${encodeURIComponent(fbConfig.apiKey)}`
      );
      if (utrCheckRes.ok) {
        res.status(409).json({
          error: `UTR "${cleanUtr}" पहले ही सबमिट किया जा चुका है। Duplicate UTR submissions are not allowed.`,
        });
        return;
      }

      // Generate cryptographically random unique order code (e.g. SUFI-8K29-XP51)
      let orderCode = generateCryptoOrderCode();
      for (let attempt = 0; attempt < 3; attempt++) {
        const existsRes = await fetch(
          `${baseUrl}/order_tracking/${encodeURIComponent(orderCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
        );
        if (!existsRes.ok) break;
        orderCode = generateCryptoOrderCode();
      }

      // Upload screenshot to Firebase Storage (or protected server fallback)
      const screenshotUrl = await uploadToFirebaseStorageOrFallback({
        fbConfig,
        orderCode,
        buffer: parsedImage.buffer,
        mime: parsedImage.mime,
        ext: parsedImage.ext,
      });

      const docRoot = `projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents`;

      // Atomic Firestore batch commit: orders/{orderCode} + order_tracking/{orderCode} + utr_locks/{utr}
      const commitRes = await fetch(
        `${baseUrl}:commit?key=${encodeURIComponent(fbConfig.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            writes: [
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
                updateTransforms: [
                  { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                ],
                currentDocument: { exists: false },
              },
            ],
          }),
        }
      );

      if (!commitRes.ok) {
        const errBody = await commitRes.text();
        console.error('Firestore commit failed:', commitRes.status, errBody);
        if (errBody.includes('ALREADY_EXISTS')) {
          res.status(409).json({
            error: `UTR "${cleanUtr}" पहले ही सबमिट किया जा चुका है। Duplicate UTR submissions are not allowed.`,
          });
          return;
        }
        res.status(500).json({ error: 'Unable to save order to database. Please try again.' });
        return;
      }

      res.status(201).json({
        orderCode,
        status: 'PENDING',
        amount: courseMeta.coursePrice,
      });
    } catch (err) {
      console.error('Order submit error:', err);
      res.status(500).json({ error: 'Unexpected error while submitting payment request.' });
    }
  });

  // 2. Public Unique Order Code Tracking (No Login Required, Rate Limited, Zero PII)
  app.post('/api/orders/track', trackLimiter, async (req: Request, res: Response) => {
    try {
      const rawCode = String((req.body as { orderCode?: string }).orderCode || '')
        .trim()
        .toUpperCase();

      if (!ORDER_CODE_REGEX.test(rawCode)) {
        res.status(400).json({
          error: 'कृपया सही Unique Order Code दर्ज करें (उदाहरण: SUFI-8K29-XP51)।',
        });
        return;
      }

      const fbConfig = getFirebaseConfig();
      const baseUrl = getFirestoreBaseUrl(fbConfig);
      const trackRes = await fetch(
        `${baseUrl}/order_tracking/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
      );

      if (!trackRes.ok) {
        res.status(404).json({
          error: 'इस Unique Code से कोई ऑर्डर नहीं मिला। कृपया कोड दोबारा जांचें।',
        });
        return;
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

      // Check whether single-use Telegram access was already claimed
      const localGrants = readLocalAccessGrants();
      let accessClaimed = Boolean(localGrants[rawCode]);
      if (!accessClaimed) {
        const grantRes = await fetch(
          `${baseUrl}/access_grants/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
        );
        accessClaimed = grantRes.ok;
      }

      res.json({
        orderCode: rawCode,
        status,
        rejectionReason,
        amount,
        createdAt: doc.fields?.createdAt?.timestampValue || null,
        updatedAt: doc.fields?.updatedAt?.timestampValue || null,
        accessClaimed,
      });
    } catch (err) {
      console.error('Track order error:', err);
      res.status(500).json({ error: 'Unable to check order status right now.' });
    }
  });

  // 3. Telegram Single-Use Invite Link Generation (Verified APPROVED Order Code Only, One-Time Grant)
  app.post('/api/telegram/invite', inviteLimiter, async (req: Request, res: Response) => {
    try {
      const rawCode = String((req.body as { orderCode?: string }).orderCode || '')
        .trim()
        .toUpperCase();

      if (!ORDER_CODE_REGEX.test(rawCode)) {
        res.status(400).json({ error: 'Valid Unique Order Code is required.' });
        return;
      }

      const fbConfig = getFirebaseConfig();
      const baseUrl = getFirestoreBaseUrl(fbConfig);

      // Step 1: Verify order status in Firestore
      const trackRes = await fetch(
        `${baseUrl}/order_tracking/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`
      );
      if (!trackRes.ok) {
        res.status(404).json({ error: 'Order code not found.' });
        return;
      }

      const trackDoc = (await trackRes.json()) as {
        fields?: { status?: { stringValue?: string } };
      };
      const status = trackDoc.fields?.status?.stringValue;

      if (status !== 'APPROVED') {
        res.status(403).json({
          error:
            'Course access is locked. Only APPROVED orders can generate a Telegram invite link.',
        });
        return;
      }

      // Step 2: Check access-grant records to block repeated unlimited invite generation
      const localGrants = readLocalAccessGrants();
      const grantUrl = `${baseUrl}/access_grants/${encodeURIComponent(rawCode)}?key=${encodeURIComponent(fbConfig.apiKey)}`;
      const existingGrantRes = await fetch(grantUrl);

      if (localGrants[rawCode] || existingGrantRes.ok) {
        res.status(403).json({
          code: 'ACCESS_ALREADY_CLAIMED',
          error:
            'इस Unique Code के लिए Telegram Invite Link पहले ही जनरेट किया जा चुका है। सुरक्षा कारणों से प्रत्येक ऑर्डर से केवल एक बार ही लिंक जनरेट किया जा सकता है। सहायता के लिए WhatsApp Support से संपर्क करें।',
        });
        return;
      }

      // Step 3: Verify Telegram Bot configuration on server
      const botToken = getEffectiveBotToken();
      const channelId = getEffectiveChannelId();
      if (!botToken || !channelId) {
        res.status(503).json({
          code: 'TELEGRAM_NOT_CONFIGURED',
          error:
            'Telegram Bot integration is not yet configured on the server. Administrator must set TELEGRAM_BOT_TOKEN in server environment secrets and configure the numeric Telegram Channel ID in /admin.',
        });
        return;
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
        res.status(502).json({
          error: `Telegram API rejected invite generation: ${
            tgData.description || 'Verify bot admin permissions (Invite Users via Link).'
          }`,
        });
        return;
      }

      // Step 5: Persist access-grant lock in Firestore + local store
      const docRoot = `projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents`;
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
              updateTransforms: [
                { fieldPath: 'grantedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              currentDocument: { exists: false },
            },
          ],
        }),
      });

      saveLocalAccessGrant({
        orderCode: rawCode,
        grantedAt: new Date().toISOString(),
        expiresAt: expireUnix * 1000,
      });

      res.json({
        inviteLink: tgData.result.invite_link,
        expiresAt: expireUnix * 1000,
        memberLimit: 1,
      });
    } catch (err) {
      console.error('Telegram invite error:', err);
      res.status(500).json({ error: 'Internal server error while generating Telegram access.' });
    }
  });

  // Admin: Upload course cover or payment QR asset
  app.post('/api/uploads/course-asset', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dataUrl, kind } = req.body as { dataUrl?: string; kind?: string };
      if (!dataUrl || typeof dataUrl !== 'string') {
        res.status(400).json({ error: 'Missing image data.' });
        return;
      }
      const parsed = parseImageDataUrl(dataUrl);
      if (!parsed) {
        res.status(400).json({ error: 'Only JPG, JPEG, PNG, or WEBP images up to 5MB are allowed.' });
        return;
      }
      const safeKind = kind === 'qr' ? 'qr' : 'cover';
      const hash = crypto.randomBytes(8).toString('hex');
      const filename = `asset_${safeKind}_${hash}.${parsed.ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), parsed.buffer);
      res.json({ url: `/api/uploads/${filename}` });
    } catch (err) {
      console.error('Course asset upload error:', err);
      res.status(500).json({ error: 'Failed to store course asset.' });
    }
  });

  // Serve uploaded files (public for course assets, strictly Admin-only for payment screenshots)
  app.get('/api/uploads/:filename', async (req: Request, res: Response) => {
    try {
      const filename = String(req.params.filename || '');
      if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
        res.status(400).json({ error: 'Invalid filename.' });
        return;
      }
      const filePath = path.join(UPLOADS_DIR, filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }

      if (filename.startsWith('ss_')) {
        const authHeader = req.headers.authorization || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
          res.status(401).json({ error: 'Admin authentication required to view payment screenshots.' });
          return;
        }
        const idToken = match[1].trim();
        const user = await verifyFirebaseIdToken(idToken);
        if (!user) {
          res.status(401).json({ error: 'Invalid authentication token.' });
          return;
        }
        const isAdmin = await checkIsAdmin(user, idToken);
        if (!isAdmin) {
          res.status(403).json({ error: 'Only authorized administrators can view payment screenshots.' });
          return;
        }
      }

      const ext = path.extname(filename).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Cache-Control',
        filename.startsWith('asset_') ? 'public, max-age=86400' : 'private, no-store'
      );
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('Serve upload error:', err);
      res.status(500).json({ error: 'Failed to load file.' });
    }
  });

  // Admin: inspect Telegram integration status (never exposes bot token)
  app.get('/api/admin/telegram-status', requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const botToken = getEffectiveBotToken();
    const channelId = getEffectiveChannelId();
    const maskedChannelId =
      channelId.length > 6
        ? `${channelId.slice(0, 5)}••••${channelId.slice(-3)}`
        : channelId
          ? 'Configured'
          : '';
    res.json({
      botTokenConfigured: Boolean(botToken),
      channelIdConfigured: Boolean(channelId),
      channelIdMasked: maskedChannelId,
      channelIdValue: channelId,
    });
  });

  // Admin: configure Telegram Channel ID (numeric chat_id like -1001234567890)
  app.post('/api/admin/telegram-config', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channelId } = req.body as { channelId?: string };
      const trimmed = (channelId || '').trim();
      if (!trimmed || !/^-?\d{5,20}$/.test(trimmed)) {
        res.status(400).json({
          error: 'Please enter a valid numeric Telegram Channel ID (e.g., -1001234567890).',
        });
        return;
      }

      const botToken = getEffectiveBotToken();
      let chatTitle = '';
      if (botToken) {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(trimmed)}`
        );
        const tgData = (await tgRes.json()) as {
          ok: boolean;
          description?: string;
          result?: { title?: string };
        };
        if (!tgData.ok) {
          res.status(400).json({
            error: `Telegram verification failed: ${
              tgData.description || 'Make sure the bot is an administrator in this channel.'
            }`,
          });
          return;
        }
        chatTitle = tgData.result?.title || '';
      }

      saveStoredTelegramConfig({
        channelId: trimmed,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user!.email || req.user!.uid,
      });

      res.json({
        saved: true,
        chatTitle,
        botTokenConfigured: Boolean(botToken),
      });
    } catch (err) {
      console.error('Telegram config save error:', err);
      res.status(500).json({ error: 'Failed to save Telegram configuration.' });
    }
  });

  // Admin: Reset Telegram access grant for an order code (in case a user's link expired before use)
  app.post('/api/admin/reset-access-grant', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rawCode = String((req.body as { orderCode?: string }).orderCode || '')
        .trim()
        .toUpperCase();
      if (!ORDER_CODE_REGEX.test(rawCode)) {
        res.status(400).json({ error: 'Invalid order code.' });
        return;
      }
      removeLocalAccessGrant(rawCode);
      const fbConfig = getFirebaseConfig();
      const baseUrl = getFirestoreBaseUrl(fbConfig);
      await fetch(`${baseUrl}/access_grants/${encodeURIComponent(rawCode)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${req.idToken}` },
      });
      res.json({ reset: true });
    } catch (err) {
      console.error('Reset access grant error:', err);
      res.status(500).json({ error: 'Failed to reset access grant.' });
    }
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
