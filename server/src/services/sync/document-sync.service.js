import { localDocumentsConnector } from '../../connectors/local-documents.connector.js';
import { databaseState, hydrateRepository } from '../../database/database.js';
import { BusinessRecordModel } from '../../models/BusinessRecord.js';
import { TenantModel } from '../../models/Tenant.js';

export async function syncLocalDocuments(tenantId = 'acme-law') {
  if (!databaseState.connected) throw Object.assign(new Error('MongoDB must be connected before syncing documents'), { status: 503 });
  const documents = await localDocumentsConnector.fetchDocuments();
  const syncedAt = new Date();
  if (documents.length) {
    await BusinessRecordModel.bulkWrite(documents.map((document) => ({
      updateOne: {
        filter: { tenantId, source: 'documents', recordId: `file:${document.id}` },
        update: {
          $set: {
            tenantId,
            source: 'documents',
            entity: 'file',
            recordId: `file:${document.id}`,
            fields: document,
            syncedAt
          }
        },
        upsert: true
      }
    })), { ordered: false });
  }
  const connector = { id: 'documents-acme', type: 'documents', name: 'Evidence Folder', status: 'healthy', lastSync: syncedAt, recordCount: documents.length };
  const existing = await TenantModel.exists({ tenantId, 'connectors.id': connector.id });
  if (existing) await TenantModel.updateOne({ tenantId, 'connectors.id': connector.id }, { $set: { 'connectors.$': connector } });
  else await TenantModel.updateOne({ tenantId }, { $push: { connectors: connector } });
  await hydrateRepository();
  return {
    tenantId,
    syncedAt: syncedAt.toISOString(),
    counts: {
      documents: documents.length,
      pdfs: documents.filter((document) => document.extension === '.pdf').length,
      textFiles: documents.filter((document) => document.extension !== '.pdf').length,
      ocrRequired: documents.filter((document) => document.ocrRequired).length
    }
  };
}
