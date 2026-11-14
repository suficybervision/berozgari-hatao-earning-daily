import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleHealth } from './_lib/backend.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleHealth(req, res);
}
