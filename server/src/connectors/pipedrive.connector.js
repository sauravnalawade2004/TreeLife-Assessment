const DEFAULT_BASE_URL = 'https://api.pipedrive.com';

export class PipedriveConnector {
  get configured() {
    return Boolean(process.env.PIPEDRIVE_API_TOKEN);
  }

  get baseUrl() {
    return (process.env.PIPEDRIVE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async request(path, { searchParams = {}, method = 'GET', body } = {}) {
    if (!this.configured) throw Object.assign(new Error('Pipedrive connector is not configured'), { status: 503 });
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-api-token': process.env.PIPEDRIVE_API_TOKEN
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

  async createTextDealField(fieldName) {
    const payload = await this.request('/api/v2/dealFields', {
      method: 'POST',
      body: { field_name: fieldName, field_type: 'varchar' }
    });
    return payload.data;
  }

  async updateDealCustomFields(dealId, customFields) {
    const payload = await this.request(`/api/v2/deals/${dealId}`, {
      method: 'PATCH',
      body: { custom_fields: customFields }
    });
    return payload.data;
  }

  async testConnection() {
    if (!this.configured) return { configured: false, status: 'not_configured', message: 'Add PIPEDRIVE_API_TOKEN to server/.env.' };
    try {
      const payload = await this.request('/api/v1/users/me');
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

  async fetchV2Collection(path, searchParams = {}) {
    const items = [];
    let cursor;
    for (let page = 0; page < 200; page += 1) {
      const payload = await this.request(path, { searchParams: { ...searchParams, limit: 500, cursor } });
      if (Array.isArray(payload.data)) items.push(...payload.data);
      cursor = payload.additional_data?.next_cursor
        ?? payload.additional_data?.pagination?.next_cursor
        ?? null;
      if (!cursor) break;
    }
    return items;
  }

  async fetchV1Collection(path, searchParams = {}) {
    const items = [];
    let start = 0;
    for (let page = 0; page < 500; page += 1) {
      const payload = await this.request(path, { searchParams: { ...searchParams, start, limit: 100 } });
      if (Array.isArray(payload.data)) items.push(...payload.data);
      const pagination = payload.additional_data?.pagination;
      if (!pagination?.more_items_in_collection) break;
      start = pagination.next_start ?? (start + 100);
    }
    return items;
  }

  async fetchSnapshot() {
    const [me, dealFields, deals, organizations, notes] = await Promise.all([
      this.request('/api/v1/users/me'),
      this.fetchV2Collection('/api/v2/dealFields'),
      this.fetchV2Collection('/api/v2/deals', { status: 'open,won,lost', include_fields: 'notes_count' }),
      this.fetchV2Collection('/api/v2/organizations', { include_fields: 'notes_count' }),
      this.fetchV1Collection('/api/v1/notes')
    ]);
    return {
      syncedAt: new Date().toISOString(),
      currentUser: me.data,
      dealFields,
      deals,
      organizations,
      notes
    };
  }
}

export const pipedriveConnector = new PipedriveConnector();
