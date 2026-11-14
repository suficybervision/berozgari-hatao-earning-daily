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

const BOOTSTRAPPED_ADMIN_EMAIL = 'hajshdbdb262837@gmail.com';
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const TELEGRAM_CONFIG_PATH = path.resolve(__dirname, '.telegram-config.json');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getFirebaseConfig(): FirebaseAppletConfig {
  const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf-8');
  return JSON.parse(raw) as FirebaseAppletConfig;
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

function getEffectiveChannelId(): string {
  const envVal = (process.env.TELEGRAM_CHANNEL_ID || '').trim();
  if (envVal) return envVal;
  const stored = getStoredTelegramConfig();
  return stored?.channelId?.trim() || '';
}

function getEffectiveBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
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
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    fbConfig.projectId
  )}/databases/${encodeURIComponent(fbConfig.firestoreDatabaseId)}/documents/admins/${encodeURIComponent(user.uid)}`;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Upload payment screenshot fallback (secured by Firebase Auth UID + allowed image types only)
  app.post('/api/uploads/screenshot', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dataUrl, orderId } = req.body as { dataUrl?: string; orderId?: string };
      if (!dataUrl || typeof dataUrl !== 'string') {
        res.status(400).json({ error: 'Missing image data.' });
        return;
      }
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(orderId)) {
        res.status(400).json({ error: 'Invalid orderId format.' });
        return;
      }
      const parsed = parseImageDataUrl(dataUrl);
      if (!parsed || parsed.ext === 'webp') {
        res.status(400).json({ error: 'Only JPG, JPEG, and PNG screenshots up to 5MB are allowed.' });
        return;
      }
      const safeUid = req.user!.uid.replace(/[^a-zA-Z0-9_-]/g, '');
      const hash = crypto.randomBytes(6).toString('hex');
      const filename = `ss_${safeUid}_${orderId}_${hash}.${parsed.ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), parsed.buffer);
      res.json({ url: `/api/uploads/${filename}` });
    } catch (err) {
      console.error('Screenshot upload error:', err);
      res.status(500).json({ error: 'Failed to store payment screenshot.' });
    }
  });

  // Upload course cover or payment QR asset (Admin only)
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

  // Serve uploaded files (public for course assets, strictly owner/admin for payment screenshots)
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
          res.status(401).json({ error: 'Authentication required to view payment screenshots.' });
          return;
        }
        const idToken = match[1].trim();
        const user = await verifyFirebaseIdToken(idToken);
        if (!user) {
          res.status(401).json({ error: 'Invalid authentication token.' });
          return;
        }
        const parts = filename.split('_');
        const ownerUid = parts[1] || '';
        const isAdmin = await checkIsAdmin(user, idToken);
        if (user.uid !== ownerUid && !isAdmin) {
          res.status(403).json({ error: 'Not authorized to view this screenshot.' });
          return;
        }
      }

      const ext = path.extname(filename).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', filename.startsWith('asset_') ? 'public, max-age=86400' : 'private, no-store');
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
            error: `Telegram verification failed: ${tgData.description || 'Make sure the bot is an administrator in this channel.'}`,
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

  // User: Generate single-use private Telegram invite link ONLY if order is APPROVED
  app.post('/api/telegram/invite', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { orderId } = req.body as { orderId?: string };
      if (!orderId || typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(orderId)) {
        res.status(400).json({ error: 'Valid Order ID is required.' });
        return;
      }

      const fbConfig = getFirebaseConfig();
      const orderUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        fbConfig.projectId
      )}/databases/${encodeURIComponent(fbConfig.firestoreDatabaseId)}/documents/orders/${encodeURIComponent(orderId)}`;

      const fsRes = await fetch(orderUrl, {
        headers: {
          Authorization: `Bearer ${req.idToken}`,
        },
      });

      if (!fsRes.ok) {
        res.status(403).json({ error: 'Order not found or access denied.' });
        return;
      }

      const orderDoc = (await fsRes.json()) as {
        fields?: {
          userId?: { stringValue?: string };
          status?: { stringValue?: string };
        };
      };

      const ownerUid = orderDoc.fields?.userId?.stringValue;
      const status = orderDoc.fields?.status?.stringValue;

      if (ownerUid !== req.user!.uid) {
        res.status(403).json({ error: 'You are not authorized to access this order.' });
        return;
      }

      if (status !== 'APPROVED') {
        res.status(403).json({
          error: 'Course access is locked. Only APPROVED payments can generate a Telegram invite link.',
        });
        return;
      }

      const botToken = getEffectiveBotToken();
      const channelId = getEffectiveChannelId();

      if (!botToken || !channelId) {
        res.status(503).json({
          code: 'TELEGRAM_NOT_CONFIGURED',
          error:
            'Telegram Bot integration is not yet configured on the server. Administrator must set TELEGRAM_BOT_TOKEN in server environment secrets and configure the numeric Telegram Channel ID in Admin Settings.',
        });
        return;
      }

      const expireUnix = Math.floor(Date.now() / 1000) + 600; // 10-minute single-use expiry
      const tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: channelId,
          name: `Order ${orderId}`,
          expire_date: expireUnix,
          member_limit: 1,
          creates_join_request: false,
        }),
      });

      const tgData = (await tgResponse.json()) as {
        ok: boolean;
        description?: string;
        result?: { invite_link?: string; expire_date?: number };
      };

      if (!tgData.ok || !tgData.result?.invite_link) {
        console.error('Telegram API error:', tgData);
        res.status(502).json({
          error: `Telegram API rejected invite generation: ${tgData.description || 'Verify bot admin permissions (Invite Users via Link).'}`,
        });
        return;
      }

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
