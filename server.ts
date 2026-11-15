import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleGetCourseAsset,
  handleGetScreenshot,
  handleHealth,
  handleLegacyLocalUpload,
  handleOrderSubmit,
  handleOrderTrack,
  sendJson,
} from './api/_lib/backend.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // Ensure malformed JSON or oversized payloads on /api/* always return JSON
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      const e = err as { status?: number; type?: string; message?: string };
      if (e?.type === 'entity.too.large' || e?.status === 413) {
        sendJson(res, 413, {
          error: 'Screenshot file is too large. Please upload a JPG or PNG under 4 MB.',
        });
        return;
      }
      if (e instanceof SyntaxError || e?.status === 400) {
        sendJson(res, 400, { error: 'Invalid JSON request payload.' });
        return;
      }
    }
    next(err);
  });

  app.all('/api/health', (req, res) => void handleHealth(req, res));
  app.all('/api/orders/submit', (req, res) => void handleOrderSubmit(req, res));
  app.all('/api/orders/track', (req, res) => void handleOrderTrack(req, res));
  app.all('/api/screenshots/:orderCode', (req, res) =>
    void handleGetScreenshot(req, res, req.params.orderCode)
  );
  app.all('/api/course-assets/:assetId', (req, res) =>
    void handleGetCourseAsset(req, res, req.params.assetId)
  );
  app.all('/api/uploads/:filename', (req, res) =>
    void handleLegacyLocalUpload(req, res, req.params.filename)
  );

  // Catch any unknown /api/* route with JSON 404 (never HTML)
  app.use('/api', (req, res) => {
    sendJson(res, 404, { error: `API route not found: ${req.method} ${req.originalUrl}` });
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
