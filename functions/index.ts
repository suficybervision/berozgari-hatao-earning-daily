/**
 * Firebase Cloud Functions reference implementation for deploying to Firebase Functions (Blaze plan).
 * Note: In the AI Studio runtime, equivalent endpoints run live via /api/* in server.ts.
 *
 * Configure secrets before deploying:
 *   firebase functions:secrets:set TELEGRAM_BOT_TOKEN
 *   firebase functions:secrets:set TELEGRAM_CHANNEL_ID
 */

export interface TelegramInviteRequest {
  orderId: string;
}

export async function generateSingleUseTelegramLink(params: {
  botToken: string;
  channelId: string;
  orderId: string;
}): Promise<{ inviteLink: string; expiresAt: number }> {
  const expireUnix = Math.floor(Date.now() / 1000) + 600;
  const response = await fetch(
    `https://api.telegram.org/bot${params.botToken}/createChatInviteLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.channelId,
        name: `Order ${params.orderId}`,
        expire_date: expireUnix,
        member_limit: 1,
        creates_join_request: false,
      }),
    }
  );

  const data = (await response.json()) as {
    ok: boolean;
    description?: string;
    result?: { invite_link?: string };
  };

  if (!data.ok || !data.result?.invite_link) {
    throw new Error(data.description || 'Failed to create Telegram invite link');
  }

  return {
    inviteLink: data.result.invite_link,
    expiresAt: expireUnix * 1000,
  };
}
