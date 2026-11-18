import { config } from '../../config/index.js';

export interface HeliusWebhookConfig {
  webhookId?: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced' | 'raw';
  authHeader?: string;
}

export class HeliusWebhookManager {
  private apiKey: string;
  private baseUrl = 'https://api.helius.xyz/v0/webhooks';

  constructor(apiKey: string = config.HELIUS_API_KEY) {
    this.apiKey = apiKey;
  }

  async getAllWebhooks(): Promise<any[]> {
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY is not configured');
    }

    const res = await fetch(`${this.baseUrl}?api-key=${this.apiKey}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch Helius webhooks (${res.status}): ${err}`);
    }

    return (await res.json()) as any[];
  }

  async syncWebhook(
    targetAddresses: string[],
    webhookUrl: string = `${config.PUBLIC_BASE_URL}/hooks/helius`
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; webhookId: string; addressCount: number }> {
    if (!this.apiKey) {
      throw new Error('HELIUS_API_KEY is required to sync Helius webhooks');
    }

    const existingWebhooks = await this.getAllWebhooks();
    const existing = existingWebhooks.find(
      (w) => w.webhookURL === webhookUrl || w.webhookType === 'enhanced'
    );

    const desiredAddresses = Array.from(new Set(targetAddresses));

    if (!existing) {
      console.log(`[Helius] No existing webhook found. Creating new enhanced webhook with ${desiredAddresses.length} addresses...`);
      const createRes = await fetch(`${this.baseUrl}?api-key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookURL: webhookUrl,
          transactionTypes: ['SWAP'],
          accountAddresses: desiredAddresses,
          webhookType: 'enhanced',
          authHeader: config.HELIUS_WEBHOOK_AUTH_HEADER || undefined,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Helius webhook creation failed (${createRes.status}): ${err}`);
      }

      const created = (await createRes.json()) as any;
      return { action: 'created', webhookId: created.webhookID, addressCount: desiredAddresses.length };
    }

    // Check if addresses changed to save the 100 credits edit fee
    const currentAddresses = new Set(existing.accountAddresses || []);
    const isIdentical =
      currentAddresses.size === desiredAddresses.length &&
      desiredAddresses.every((addr) => currentAddresses.has(addr));

    if (isIdentical) {
      console.log(`[Helius] Webhook ${existing.webhookID} address list is already identical (${currentAddresses.size} addresses). Skipping update to save 100 credits.`);
      return { action: 'skipped', webhookId: existing.webhookID, addressCount: currentAddresses.size };
    }

    console.log(
      `[Helius] Updating webhook ${existing.webhookID}: ${currentAddresses.size} -> ${desiredAddresses.length} addresses in ONE batched request (Costs 100 credits)...`
    );

    const updateRes = await fetch(`${this.baseUrl}/${existing.webhookID}?api-key=${this.apiKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ['SWAP'],
        accountAddresses: desiredAddresses,
        webhookType: 'enhanced',
        authHeader: config.HELIUS_WEBHOOK_AUTH_HEADER || undefined,
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`Helius webhook update failed (${updateRes.status}): ${err}`);
    }

    const updated = (await updateRes.json()) as any;
    return { action: 'updated', webhookId: updated.webhookID, addressCount: desiredAddresses.length };
  }
}
