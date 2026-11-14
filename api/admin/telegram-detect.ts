import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAdminTelegramDetect } from '../_lib/backend.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleAdminTelegramDetect(req, res);
}
