import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPipedrive } from '../src/services/sync/pipedrive-sync.service.js';
import { TenantModel } from '../src/models/Tenant.js';

const originalEnv = { ...process.env };

test('syncPipedrive accepts tenant-specific connector config and preserves it on the tenant', async () => {
  process.env.PIPEDRIVE_API_TOKEN = 'test-token';
  const tenantId = 'tenant-with-custom-pipedrive';
  const tenantName = 'Northstar Advisory';
  const connectorName = 'Northstar CRM';

  const original = await TenantModel.findOneAndDelete({ tenantId }).catch(() => null);
  if (original) {
    await TenantModel.deleteOne({ tenantId });
  }

  const result = await syncPipedrive(tenantId, {
    tenantName,
    connectorName,
    connectorConfig: { apiToken: 'test-token', baseUrl: 'https://api.pipedrive.com' }
  });

  assert.equal(result.tenantId, tenantId);
  const tenant = await TenantModel.findOne({ tenantId }).lean();
  assert.ok(tenant);
  const connector = tenant.connectors?.find((item) => item.id === 'pipedrive-acme');
  assert.ok(connector);
  assert.equal(connector.name, connectorName);
  assert.equal(connector.config?.apiToken, 'test-token');
  assert.equal(connector.config?.baseUrl, 'https://api.pipedrive.com');
  process.env.PIPEDRIVE_API_TOKEN = originalEnv.PIPEDRIVE_API_TOKEN;
});

process.env = originalEnv;
