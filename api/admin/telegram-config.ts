import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAdminTelegramConfig } from '../_lib/backend.ts';

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  await handleAdminTelegramConfig(req, res);
}
