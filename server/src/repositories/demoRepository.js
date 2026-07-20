import { aliases, records, tenants } from '../data/tenants.js';

export class DemoRepository {
  constructor(){this.tenants=tenants;this.records=records;this.aliases=aliases;}
  hydrate(data){this.tenants=data.tenants;this.records=data.records;this.aliases=data.aliases;}
  listTenants() { return structuredClone(this.tenants); }
  getTenant(id) { return structuredClone(this.tenants.find(t => t.id === id)); }
  findRecords(tenantId, { source, entity } = {}) {
    return structuredClone(this.records.filter(r => r.tenantId === tenantId && (!source || r.source === source) && (!entity || r.entity === entity)));
  }
  findAliases(tenantId, type) { return structuredClone(this.aliases.filter(a => a.tenantId === tenantId && (!type || a.type === type))); }
}

export const repository = new DemoRepository();
