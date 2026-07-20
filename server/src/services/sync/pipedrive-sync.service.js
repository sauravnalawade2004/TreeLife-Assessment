import { pipedriveConnector } from '../../connectors/pipedrive.connector.js';
import { databaseState, hydrateRepository } from '../../database/database.js';
import { BusinessRecordModel } from '../../models/BusinessRecord.js';
import { TenantModel } from '../../models/Tenant.js';

const compactObject = (value) => Object.fromEntries(Object.entries(value || {}).filter(([, entry]) => entry !== undefined));

function fieldCode(field) {
  return String(field?.key ?? field?.code ?? field?.field_code ?? field?.id ?? '');
}

function labelledCustomFields(deal, schemaByCode) {
  const nested = deal.custom_fields && typeof deal.custom_fields === 'object' ? deal.custom_fields : {};
  const values = {};
  for (const [code, schema] of schemaByCode) {
    const value = nested[code] ?? deal[code];
    if (value !== undefined && value !== null && value !== '') {
      values[schema.name || schema.field_name || code] = { code, value };
    }
  }
  return values;
}

function operations(tenantId, snapshot) {
  const schemaByCode = new Map(snapshot.dealFields
    .filter((field) => field.is_custom_field === true)
    .map((field) => [fieldCode(field), field])
    .filter(([code]) => code));
  const syncedAt = new Date(snapshot.syncedAt);
  const docs = [];

  for (const field of snapshot.dealFields) {
    const code = fieldCode(field);
    docs.push({ tenantId, source: 'pipedrive', entity: 'schema', recordId: `deal-field:${code}`, fields: { code, raw: field }, syncedAt });
  }
  for (const organization of snapshot.organizations) {
    docs.push({
      tenantId,
      source: 'pipedrive',
      entity: 'organization',
      recordId: `organization:${organization.id}`,
      fields: compactObject({ name: organization.name, official_owner: organization.owner_id, updated_at: organization.update_time, raw: organization }),
      syncedAt
    });
  }
  for (const deal of snapshot.deals) {
    docs.push({
      tenantId,
      source: 'pipedrive',
      entity: 'deal',
      recordId: `deal:${deal.id}`,
      fields: compactObject({
        title: deal.title,
        official_status: deal.status,
        official_owner: deal.owner_id,
        organization_id: deal.org_id,
        person_id: deal.person_id,
        stage_id: deal.stage_id,
        pipeline_id: deal.pipeline_id,
        value: deal.value,
        currency: deal.currency,
        created_at: deal.add_time,
        updated_at: deal.update_time,
        closed_at: deal.close_time,
        custom_fields: labelledCustomFields(deal, schemaByCode),
        raw: deal
      }),
      syncedAt
    });
  }
  for (const note of snapshot.notes) {
    docs.push({
      tenantId,
      source: 'pipedrive',
      entity: 'note',
      recordId: `note:${note.id}`,
      fields: compactObject({
        content: note.content,
        deal_id: note.deal_id,
        organization_id: note.org_id,
        person_id: note.person_id,
        user_id: note.user_id,
        created_at: note.add_time,
        updated_at: note.update_time,
        raw: note
      }),
      syncedAt
    });
  }
  if (snapshot.currentUser?.id) {
    docs.push({
      tenantId,
      source: 'pipedrive',
      entity: 'user',
      recordId: `user:${snapshot.currentUser.id}`,
      fields: { name: snapshot.currentUser.name, email: snapshot.currentUser.email, raw: snapshot.currentUser },
      syncedAt
    });
  }
  return docs;
}

export async function syncPipedrive(tenantId = 'acme-law') {
  if (!databaseState.connected) throw Object.assign(new Error('MongoDB must be connected before syncing Pipedrive'), { status: 503 });
  const snapshot = await pipedriveConnector.fetchSnapshot();
  const docs = operations(tenantId, snapshot);
  if (docs.length) {
    await BusinessRecordModel.bulkWrite(docs.map((doc) => ({
      updateOne: {
        filter: { tenantId: doc.tenantId, source: doc.source, recordId: doc.recordId },
        update: { $set: doc },
        upsert: true
      }
    })), { ordered: false });
  }

  const counts = {
    deals: snapshot.deals.length,
    organizations: snapshot.organizations.length,
    notes: snapshot.notes.length,
    dealFields: snapshot.dealFields.length,
    storedRecords: docs.length
  };
  const connector = { id: 'pipedrive-acme', type: 'crm', name: 'Pipedrive', status: 'healthy', lastSync: new Date(snapshot.syncedAt), recordCount: docs.length };
  await TenantModel.updateOne(
    { tenantId },
    { $setOnInsert: { tenantId, name: 'Acme Legal', industry: 'Law firm' } },
    { upsert: true }
  );
  const existing = await TenantModel.exists({ tenantId, 'connectors.id': connector.id });
  if (existing) {
    await TenantModel.updateOne({ tenantId, 'connectors.id': connector.id }, { $set: { 'connectors.$': connector } });
  } else {
    await TenantModel.updateOne({ tenantId }, { $push: { connectors: connector } });
  }
  await hydrateRepository();
  return { tenantId, syncedAt: snapshot.syncedAt, user: snapshot.currentUser?.name || null, counts };
}
