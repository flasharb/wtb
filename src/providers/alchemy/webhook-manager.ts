import { config } from '../../config/index.js';

export class AlchemyWebhookManager {
  private authToken: string;
  private baseUrl = 'https://dashboard.alchemy.com/api';

  constructor(authToken: string = config.ALCHEMY_AUTH_TOKEN) {
    this.authToken = authToken;
  }

  async getAllWebhooks(): Promise<any[]> {
    if (!this.authToken) {
      throw new Error('ALCHEMY_AUTH_TOKEN is required to manage Alchemy webhooks');
    }

    const res = await fetch(`${this.baseUrl}/team-webhooks`, {
      headers: {
        'X-Alchemy-Token': this.authToken,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch Alchemy webhooks (${res.status}): ${err}`);
    }

    const json = (await res.json()) as any;
    return json.data || [];
  }

  async syncWebhook(
    targetAddresses: string[],
    webhookUrl: string = `${config.PUBLIC_BASE_URL}/hooks/alchemy`
  ): Promise<{ action: 'created' | 'updated' | 'skipped'; webhookId: string; addressCount: number }> {
    if (!this.authToken) {
      throw new Error('ALCHEMY_AUTH_TOKEN is required to manage Alchemy webhooks');
    }

    const existingWebhooks = await this.getAllWebhooks();
    const existing = existingWebhooks.find(
      (w) => w.webhook_type === 'ADDRESS_ACTIVITY' && (w.url === webhookUrl || w.network === 'ETH_MAINNET')
    );

    const desiredAddresses = Array.from(new Set(targetAddresses.map((a) => a.toLowerCase())));

    if (!existing) {
      console.log(`[Alchemy] Creating new Address Activity webhook for ${desiredAddresses.length} addresses...`);
      const createRes = await fetch(`${this.baseUrl}/create-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Alchemy-Token': this.authToken,
        },
        body: JSON.stringify({
          network: 'ETH_MAINNET',
          webhook_type: 'ADDRESS_ACTIVITY',
          webhook_url: webhookUrl,
          addresses: desiredAddresses,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Alchemy webhook creation failed (${createRes.status}): ${err}`);
      }

      const created = (await createRes.json()) as any;
      return { action: 'created', webhookId: created.data.id, addressCount: desiredAddresses.length };
    }

    console.log(`[Alchemy] Updating webhook ${existing.id} addresses (${desiredAddresses.length} addresses)...`);
    const updateRes = await fetch(`${this.baseUrl}/update-webhook-addresses`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Alchemy-Token': this.authToken,
      },
      body: JSON.stringify({
        webhook_id: existing.id,
        addresses_to_add: desiredAddresses,
        addresses_to_remove: [],
      }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`Alchemy webhook update failed (${updateRes.status}): ${err}`);
    }

    return { action: 'updated', webhookId: existing.id, addressCount: desiredAddresses.length };
  }
}
