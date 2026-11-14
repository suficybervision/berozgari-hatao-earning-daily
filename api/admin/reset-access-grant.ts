import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAdminResetAccessGrant } from '../_lib/backend.ts';

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  await handleAdminResetAccessGrant(req, res);
}
