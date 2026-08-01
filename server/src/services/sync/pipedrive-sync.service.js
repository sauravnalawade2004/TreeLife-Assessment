import { pipedriveConnector } from '../../connectors/pipedrive.connector.js';
import { databaseState, hydrateRepository } from '../../database/database.js';
import { BusinessRecordModel } from '../../models/BusinessRecord.js';
import { TenantModel } from '../../models/Tenant.js';

function resolveConnectorConfig(tenant, options = {}) {
  const explicit = options.connectorConfig || options.config || {};
  const existing = tenant?.connectors?.find((connector) => connector.id === 'pipedrive-acme' || connector.type === 'crm');
  const merged = {
    apiToken: explicit.apiToken || explicit.token || existing?.config?.apiToken || process.env.PIPEDRIVE_API_TOKEN,
    baseUrl: explicit.baseUrl || existing?.config?.baseUrl || process.env.PIPEDRIVE_API_BASE_URL
  };
  return merged;
}

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

function genericDealSummary(deal) {
  const summary = [];
  const append = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'object') {
      summary.push(`${label}: ${JSON.stringify(value)}`);
    } else {
      summary.push(`${label}: ${String(value)}`);
    }
  };
  const preferredTitle = deal.title || deal.name || deal.deal_title || deal.label || deal.subject || deal.heading || '';
  append('title', preferredTitle);
  append('status', deal.status || deal.stage || deal.pipeline_stage_name || deal.deal_stage || deal.current_stage);
  append('owner', deal.owner_id || deal.owner || deal.assigned_to);
  append('value', deal.value || deal.amount || deal.expected_value);
  append('organization', deal.org_id || deal.organization_id || deal.org_name || deal.company_name);
  for (const [key, value] of Object.entries(deal)) {
    if (['title','name','deal_title','label','subject','heading','status','stage','pipeline_stage_name','deal_stage','current_stage','owner_id','owner','assigned_to','value','amount','expected_value','org_id','organization_id','org_name','company_name','custom_fields'].includes(key)) continue;
    append(key, value);
  }
  return summary.join(' | ');
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
        title: deal.title || deal.name || deal.deal_title || deal.label || deal.subject || deal.heading || '',
        official_status: deal.status || deal.stage || deal.pipeline_stage_name || deal.deal_stage || deal.current_stage || '',
        official_owner: deal.owner_id || deal.owner || deal.assigned_to || '',
        organization_id: deal.org_id || deal.organization_id || deal.org_name || deal.company_name || '',
        person_id: deal.person_id || deal.contact_id || deal.person || '',
        stage_id: deal.stage_id || deal.pipeline_stage_id || '',
        pipeline_id: deal.pipeline_id || deal.pipeline || '',
        value: deal.value || deal.amount || deal.expected_value || '',
        currency: deal.currency || deal.currency_code || '',
        created_at: deal.add_time || deal.created_at || deal.createdTime || '',
        updated_at: deal.update_time || deal.updated_at || deal.updatedTime || '',
        closed_at: deal.close_time || deal.closed_at || deal.closeTime || '',
        custom_fields: labelledCustomFields(deal, schemaByCode),
        summary: genericDealSummary(deal),
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
  for (const user of (snapshot.users || [])) {
    if (user.id && user.name) {
      docs.push({
        tenantId,
        source: 'pipedrive',
        entity: 'user',
        recordId: `user:${user.id}`,
        fields: { name: user.name, email: user.email || null, raw: user },
        syncedAt
      });
    }
  }
  return docs;
}

export async function syncPipedrive(tenantId = 'acme-law', options = {}) {
  if (!databaseState.connected) throw Object.assign(new Error('MongoDB must be connected before syncing Pipedrive'), { status: 503 });
  const tenant = await TenantModel.findOne({ tenantId }).lean();
  const connectorConfig = resolveConnectorConfig(tenant, options);
  const snapshot = await pipedriveConnector.fetchSnapshot(connectorConfig);
  if (!snapshot?.deals?.length && !snapshot?.organizations?.length && !snapshot?.notes?.length) {
    throw Object.assign(new Error('Pipedrive returned no records for this connector. Check the token and account permissions.'), { status: 502 });
  }
  const docs = operations(tenantId, snapshot);
  if (docs.length) {
    const persisted = await BusinessRecordModel.bulkWrite(docs.map((doc) => ({
      updateOne: {
        filter: { tenantId: doc.tenantId, source: doc.source, recordId: doc.recordId },
        update: { $set: doc },
        upsert: true
      }
    })), { ordered: false });
    if (!persisted?.result?.ok) {
      throw Object.assign(new Error('Pipedrive sync failed to persist records to the database'), { status: 500 });
    }
  }

  const counts = {
    deals: snapshot.deals.length,
    organizations: snapshot.organizations.length,
    notes: snapshot.notes.length,
    dealFields: snapshot.dealFields.length,
    storedRecords: docs.length
  };
  const connector = { id: 'pipedrive-acme', type: 'crm', name: options.connectorName || 'Pipedrive', status: 'healthy', lastSync: new Date(snapshot.syncedAt), recordCount: docs.length, config: connectorConfig };
  await TenantModel.updateOne(
    { tenantId },
    { $setOnInsert: { tenantId, name: options.tenantName || tenant?.name || 'Tenant', industry: options.industry || tenant?.industry || 'Unknown' } },
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
