import { notionConnector } from '../../connectors/notion.connector.js';
import { databaseState, hydrateRepository } from '../../database/database.js';
import { BusinessRecordModel } from '../../models/BusinessRecord.js';
import { TenantModel } from '../../models/Tenant.js';

export async function syncNotion(tenantId = 'acme-law') {
  if (!databaseState.connected) throw Object.assign(new Error('MongoDB must be connected before syncing Notion'), { status: 503 });
  const snapshot = await notionConnector.fetchSnapshot();
  const syncedAt = new Date(snapshot.syncedAt);
  const records = snapshot.pages.map((page) => ({
    tenantId,
    source: 'notion',
    entity: 'work_item',
    recordId: `page:${page.id}`,
    fields: page,
    syncedAt
  }));
  records.push({
    tenantId,
    source: 'notion',
    entity: 'schema',
    recordId: `data-source:${snapshot.schema.id}`,
    fields: { id: snapshot.schema.id, name: snapshot.schema.name, properties: snapshot.schema.properties, raw: snapshot.schema },
    syncedAt
  });
  if (records.length) {
    await BusinessRecordModel.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { tenantId, source: record.source, recordId: record.recordId },
        update: { $set: record },
        upsert: true
      }
    })), { ordered: false });
  }
  await BusinessRecordModel.deleteMany({ tenantId, source: 'notion', recordId: { $nin: records.map((record) => record.recordId) } });
  const connector = { id: 'notion-acme', type: 'work_tracker', name: 'Notion Work Tracker', status: 'healthy', lastSync: syncedAt, recordCount: records.length };
  await TenantModel.updateOne({ tenantId }, { $setOnInsert: { tenantId, name: 'Acme Legal', industry: 'Law firm' } }, { upsert: true });
  const existing = await TenantModel.exists({ tenantId, 'connectors.id': connector.id });
  if (existing) await TenantModel.updateOne({ tenantId, 'connectors.id': connector.id }, { $set: { 'connectors.$': connector } });
  else await TenantModel.updateOne({ tenantId }, { $push: { connectors: connector } });
  await hydrateRepository();
  return { tenantId, syncedAt: snapshot.syncedAt, dataSource: snapshot.schema.name || snapshot.schema.id, counts: { pages: snapshot.pages.length, schemaRecords: 1, storedRecords: records.length } };
}
