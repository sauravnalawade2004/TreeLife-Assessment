const DEFAULT_BASE_URL = 'https://api.pipedrive.com';

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export class PipedriveConnector {
  resolveConfig(config = {}) {
    const token = config.apiToken || process.env.PIPEDRIVE_API_TOKEN;
    const baseUrl = normalizeBaseUrl(config.baseUrl || process.env.PIPEDRIVE_API_BASE_URL || DEFAULT_BASE_URL);
    return { configured: Boolean(token), apiToken: token, baseUrl };
  }

  async request(path, { searchParams = {}, method = 'GET', body, config } = {}) {
    const resolved = this.resolveConfig(config);
    if (!resolved.configured) throw Object.assign(new Error('Pipedrive connector is not configured'), { status: 503 });
    const url = new URL(path, `${resolved.baseUrl}/`);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-api-token': resolved.apiToken
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    if (response.status === 429) {
      throw Object.assign(new Error('Pipedrive rate limited the sync'), {
        status: 429,
        retryAfter: response.headers.get('retry-after')
      });
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error || ''; } catch { /* response was not JSON */ }
      throw Object.assign(new Error(`Pipedrive API ${response.status}${detail ? `: ${detail}` : ''}`), { status: response.status });
    }
    const payload = await response.json();
    if (payload.success === false) throw Object.assign(new Error(payload.error || 'Pipedrive request failed'), { status: 502 });
    return payload;
  }

  async createTextDealField(fieldName, config) {
    const payload = await this.request('/api/v2/dealFields', {
      method: 'POST',
      body: { field_name: fieldName, field_type: 'varchar' },
      config
    });
    return payload.data;
  }

  async updateDealCustomFields(dealId, customFields, config) {
    const payload = await this.request(`/api/v2/deals/${dealId}`, {
      method: 'PATCH',
      body: { custom_fields: customFields },
      config
    });
    return payload.data;
  }

  async testConnection(config) {
    const resolved = this.resolveConfig(config);
    if (!resolved.configured) return { configured: false, status: 'not_configured', message: 'Add PIPEDRIVE_API_TOKEN to server/.env or provide a connector config.' };
    try {
      const payload = await this.request('/api/v1/users/me', { config: resolved });
      return {
        configured: true,
        status: 'healthy',
        user: payload.data?.name || null,
        company: payload.data?.company_name || null,
        companyDomain: payload.data?.company_domain || null
      };
    } catch (error) {
      return { configured: true, status: 'error', httpStatus: error.status || 502, message: error.message };
    }
  }

  async fetchV2Collection(path, searchParams = {}, config) {
    const items = [];
    let cursor;
    for (let page = 0; page < 200; page += 1) {
      const payload = await this.request(path, { searchParams: { ...searchParams, limit: 500, cursor }, config });
      if (Array.isArray(payload.data)) items.push(...payload.data);
      cursor = payload.additional_data?.next_cursor
        ?? payload.additional_data?.pagination?.next_cursor
        ?? null;
      if (!cursor) break;
    }
    return items;
  }

  async fetchV1Collection(path, searchParams = {}, config) {
    const items = [];
    let start = 0;
    for (let page = 0; page < 500; page += 1) {
      const payload = await this.request(path, { searchParams: { ...searchParams, start, limit: 100 }, config });
      if (Array.isArray(payload.data)) items.push(...payload.data);
      const pagination = payload.additional_data?.pagination;
      if (!pagination?.more_items_in_collection) break;
      start = pagination.next_start ?? (start + 100);
    }
    return items;
  }

  async fetchMissingUsersByIds(missingIds, config) {
    const users = [];
    for (const id of missingIds) {
      try {
        const payload = await this.request(`/api/v1/users/${id}`, { config });
        if (payload.data) users.push(payload.data);
      } catch {
        console.warn(`[Pipedrive] Could not fetch user ${id}: creating placeholder`);
        users.push({ id: Number(id), name: `User ${id}` });
      }
    }
    return users;
  }

  async fetchSnapshot(config) {
    const [me, dealFields, deals, organizations, notes] = await Promise.all([
      this.request('/api/v1/users/me', { config }),
      this.fetchV2Collection('/api/v2/dealFields', {}, config),
      this.fetchV2Collection('/api/v2/deals', { status: 'open,won,lost', include_fields: 'notes_count' }, config),
      this.fetchV2Collection('/api/v2/organizations', { include_fields: 'notes_count' }, config),
      this.fetchV1Collection('/api/v1/notes', {}, config)
    ]);

    let users = [];
    try {
      users = await this.fetchV1Collection('/api/v1/users', {}, config);
      console.log(`[Pipedrive] Fetched ${users.length} users from /api/v1/users`);
    } catch (err) {
      console.warn(`[Pipedrive] /api/v1/users failed: ${err.message}`);
      users = [];
    }

    const knownUserIds = new Set([
      me.data?.id,
      ...users.map((u) => u.id)
    ].filter(Boolean).map(String));

    const dealOwnerIds = new Set();
    for (const deal of deals) {
      const ownerId = String(deal.owner_id || deal.user_id || '');
      if (ownerId && ownerId !== '0' && !knownUserIds.has(ownerId)) {
        dealOwnerIds.add(ownerId);
      }
    }

    if (dealOwnerIds.size > 0) {
      console.log(`[Pipedrive] Bulk users returned ${users.length} but deals reference ${dealOwnerIds.size} unknown owner_ids: [${[...dealOwnerIds].join(', ')}]. Fetching individually...`);
      const missing = await this.fetchMissingUsersByIds([...dealOwnerIds], config);
      users.push(...missing);
      console.log(`[Pipedrive] Total users after individual fetch: ${users.length}`);
    } else {
      console.log(`[Pipedrive] All deal owner_ids covered by bulk users response`);
    }

    if (me.data?.id && !users.some((u) => String(u.id) === String(me.data.id))) {
      users.unshift(me.data);
    }

    return {
      syncedAt: new Date().toISOString(),
      currentUser: me.data,
      dealFields,
      deals,
      organizations,
      notes,
      users: Array.isArray(users) ? users : []
    };
  }
}

export const pipedriveConnector = new PipedriveConnector();
  