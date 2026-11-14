import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleOrderSubmit } from '../_lib/backend.ts';

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  await handleOrderSubmit(req, res);
}
