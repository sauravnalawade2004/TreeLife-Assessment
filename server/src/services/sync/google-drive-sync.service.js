import { googleDriveConnector } from '../../connectors/google-drive.connector.js';
import { databaseState, hydrateRepository } from '../../database/database.js';
import { BusinessRecordModel } from '../../models/BusinessRecord.js';
import { TenantModel } from '../../models/Tenant.js';

function connectorId() {
  return process.env.GOOGLE_DRIVE_CONNECTOR_ID || 'google-drive-acme';
}

export async function syncGoogleDrive(tenantId = 'acme-law') {
  if (!databaseState.connected) throw Object.assign(new Error('MongoDB must be connected before syncing Google Drive'), { status: 503 });

  const existing = await BusinessRecordModel.find({ tenantId, source: 'google_drive', entity: 'file' }).lean();
  const previousById = new Map(existing.map((record) => [String(record.recordId).replace(/^file:/, ''), record.fields]));
  const snapshot = await googleDriveConnector.fetchSnapshot({ previousById });
  if (!snapshot.complete) throw Object.assign(new Error('Google Drive did not return a complete snapshot'), { status: 502 });

  const syncedAt = new Date(snapshot.syncedAt);
  const records = snapshot.documents.map((document) => ({
    tenantId,
    source: 'google_drive',
    entity: 'file',
    recordId: `file:${document.id}`,
    fields: document,
    syncedAt
  }));

  if (records.length) {
    await BusinessRecordModel.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { tenantId, source: record.source, recordId: record.recordId },
        update: { $set: record },
        upsert: true
      }
    })), { ordered: false });
  }

  // Prune only after a complete traversal and extraction. A failed sync throws
  // before this point, preserving the last known-good evidence snapshot.
  const deletion = await BusinessRecordModel.deleteMany({
    tenantId,
    source: 'google_drive',
    entity: 'file',
    recordId: { $nin: records.map((record) => record.recordId) }
  });

  const connector = {
    id: connectorId(),
    type: 'google_drive',
    name: 'Google Drive Evidence',
    status: snapshot.coverageComplete ? 'healthy' : 'degraded',
    lastSync: syncedAt,
    recordCount: records.length
  };
  await TenantModel.updateOne(
    { tenantId },
    { $setOnInsert: { tenantId, name: 'Acme Legal', industry: 'Law firm' } },
    { upsert: true }
  );
  const exists = await TenantModel.exists({ tenantId, 'connectors.id': connector.id });
  if (exists) {
    await TenantModel.updateOne({ tenantId, 'connectors.id': connector.id }, { $set: { 'connectors.$': connector } });
  } else {
    await TenantModel.updateOne({ tenantId }, { $push: { connectors: connector } });
  }

  await hydrateRepository();
  return {
    tenantId,
    syncedAt: snapshot.syncedAt,
    root: snapshot.root.name,
    connectorStatus: connector.status,
    counts: {
      ...snapshot.counts,
      storedRecords: records.length,
      removedRecords: deletion.deletedCount || 0
    },
    warnings: [
      ...(snapshot.counts.ocrRequired ? [`${snapshot.counts.ocrRequired} PDF file(s) require OCR before their content can be trusted.`] : []),
      ...(snapshot.counts.skipped ? [`${snapshot.counts.skipped} file(s) were skipped because they were unsupported, restricted, shortcuts, or too large.`] : [])
    ]
  };
}
