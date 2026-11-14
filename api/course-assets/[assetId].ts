import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleGetCourseAsset } from '../_lib/backend.ts';

function extractAssetId(req: IncomingMessage & { query?: Record<string, string | string[]> }): string {
  const qVal = req.query?.assetId;
  if (typeof qVal === 'string' && qVal) return qVal;
  if (Array.isArray(qVal) && qVal[0]) return qVal[0];
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  return decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
}

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string | string[]> },
  res: ServerResponse
): Promise<void> {
  await handleGetCourseAsset(req, res, extractAssetId(req));
}
