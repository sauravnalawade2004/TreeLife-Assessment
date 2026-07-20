const DEFAULT_BASE_URL = 'https://api.notion.com';
const DEFAULT_VERSION = '2026-03-11';

const richText = (items = []) => items.map((item) => item?.plain_text ?? item?.text?.content ?? '').join('').trim();

function propertyValue(property = {}) {
  switch (property.type) {
    case 'title': return richText(property.title);
    case 'rich_text': return richText(property.rich_text);
    case 'number': return property.number;
    case 'select': return property.select?.name ?? null;
    case 'status': return property.status?.name ?? null;
    case 'multi_select': return (property.multi_select || []).map((item) => item.name).join(', ');
    case 'people': return (property.people || []).map((person) => person.name || person.person?.email || person.id).join(', ');
    case 'date': return property.date ? `${property.date.start}${property.date.end ? ` to ${property.date.end}` : ''}` : null;
    case 'checkbox': return property.checkbox;
    case 'url': return property.url;
    case 'email': return property.email;
    case 'phone_number': return property.phone_number;
    case 'relation': return (property.relation || []).map((item) => item.id).join(', ');
    case 'files': return (property.files || []).map((file) => file.name || file.file?.url || file.external?.url).filter(Boolean).join(', ');
    case 'created_time': return property.created_time;
    case 'last_edited_time': return property.last_edited_time;
    case 'created_by': return property.created_by?.name || property.created_by?.id || null;
    case 'last_edited_by': return property.last_edited_by?.name || property.last_edited_by?.id || null;
    case 'unique_id': return property.unique_id ? `${property.unique_id.prefix || ''}${property.unique_id.number}` : null;
    case 'formula': return property.formula ? property.formula[property.formula.type] ?? null : null;
    default: return property[property.type] ?? null;
  }
}

function flattenPage(page) {
  const properties = Object.fromEntries(Object.entries(page.properties || {}).map(([name, property]) => [name, propertyValue(property)]));
  const titleEntry = Object.entries(page.properties || {}).find(([, property]) => property.type === 'title');
  return {
    id: page.id,
    title: titleEntry ? propertyValue(titleEntry[1]) : `Untitled ${page.id}`,
    properties,
    url: page.url,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    archived: Boolean(page.archived || page.in_trash),
    raw: page
  };
}

export class NotionConnector {
  #resolvedDataSourceId = null;

  get configured() { return Boolean(process.env.NOTION_TOKEN && (process.env.NOTION_DATA_SOURCE_ID || process.env.NOTION_DATABASE_ID)); }
  get baseUrl() { return (process.env.NOTION_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''); }
  get version() { return process.env.NOTION_VERSION || DEFAULT_VERSION; }

  async request(path, { method = 'GET', body } = {}) {
    if (!this.configured) throw Object.assign(new Error('Notion connector is not configured'), { status: 503 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${process.env.NOTION_TOKEN}`,
          'notion-version': this.version,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25000)
      });
      if (response.status === 429 && attempt < 2) {
        const seconds = Math.min(Number(response.headers.get('retry-after')) || 1, 5);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }
      if (!response.ok) {
        let detail = '';
        try { detail = (await response.json())?.message || ''; } catch { /* Notion did not return JSON. */ }
        throw Object.assign(new Error(`Notion API ${response.status}${detail ? `: ${detail}` : ''}`), { status: response.status });
      }
      return response.json();
    }
    throw Object.assign(new Error('Notion remained rate limited after retries'), { status: 429 });
  }

  async resolveDataSourceId() {
    if (this.#resolvedDataSourceId) return this.#resolvedDataSourceId;
    if (process.env.NOTION_DATA_SOURCE_ID) {
      this.#resolvedDataSourceId = process.env.NOTION_DATA_SOURCE_ID;
      return this.#resolvedDataSourceId;
    }
    const database = await this.request(`/v1/databases/${process.env.NOTION_DATABASE_ID}`);
    const sources = database.data_sources || [];
    if (!sources.length) throw Object.assign(new Error('The Notion database has no accessible data sources'), { status: 422 });
    const preferred = process.env.NOTION_DATA_SOURCE_NAME
      ? sources.find((source) => String(source.name).toLowerCase() === process.env.NOTION_DATA_SOURCE_NAME.toLowerCase())
      : null;
    this.#resolvedDataSourceId = (preferred || sources[0]).id;
    return this.#resolvedDataSourceId;
  }

  async retrieveSchema() {
    const dataSourceId = await this.resolveDataSourceId();
    return this.request(`/v1/data_sources/${dataSourceId}`);
  }

  async queryAll() {
    const dataSourceId = await this.resolveDataSourceId();
    const pages = [];
    let startCursor;
    for (let page = 0; page < 100; page += 1) {
      const payload = await this.request(`/v1/data_sources/${dataSourceId}/query`, {
        method: 'POST',
        body: { page_size: 100, ...(startCursor ? { start_cursor: startCursor } : {}) }
      });
      pages.push(...(payload.results || []).filter((item) => item.object === 'page' && !item.in_trash));
      if (!payload.has_more || !payload.next_cursor) break;
      startCursor = payload.next_cursor;
    }
    return pages;
  }

  async testConnection() {
    if (!this.configured) return { configured: false, status: 'not_configured', message: 'Add NOTION_TOKEN and either NOTION_DATA_SOURCE_ID or NOTION_DATABASE_ID to server/.env.' };
    try {
      const schema = await this.retrieveSchema();
      return { configured: true, status: 'healthy', dataSourceId: schema.id, name: richText(schema.title) || schema.name || 'Notion data source', properties: Object.keys(schema.properties || {}).length };
    } catch (error) {
      return { configured: true, status: 'error', httpStatus: error.status || 502, message: error.message };
    }
  }

  async fetchSnapshot() {
    const [schema, rawPages] = await Promise.all([this.retrieveSchema(), this.queryAll()]);
    return { syncedAt: new Date().toISOString(), schema, pages: rawPages.map(flattenPage) };
  }
}

export const notionConnector = new NotionConnector();
