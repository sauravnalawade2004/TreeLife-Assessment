import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleDriveConnector } from '../src/connectors/google-drive.connector.js';

const folderMimeType = 'application/vnd.google-apps.folder';

test('recursively lists paginated folders and extracts blob and Workspace text', async () => {
  const listCalls = [];
  const driveClient = {
    files: {
      get: async (params) => {
        if (params.alt === 'media') return { data: Buffer.from('client,work\nABC,ITR filed') };
        return { data: { id: 'root-id', name: 'Evidence', mimeType: folderMimeType, webViewLink: 'https://drive.example/root' } };
      },
      list: async (params) => {
        listCalls.push({ q: params.q, pageToken: params.pageToken });
        if (params.q.includes("'root-id'")) {
          if (!params.pageToken) {
            return {
              data: {
                files: [
                  { id: 'nested-id', name: 'wrong client folder', mimeType: folderMimeType },
                  { id: 'csv-id', name: 'messy.csv', mimeType: 'text/csv', size: '25', modifiedTime: '2026-07-17T00:00:00Z', md5Checksum: 'csv-md5' }
                ],
                nextPageToken: 'second-page'
              }
            };
          }
          return { data: { files: [{ id: 'doc-id', name: 'notes', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-07-17T00:01:00Z', version: '2' }] } };
        }
        return { data: { files: [{ id: 'txt-id', name: 'proof.txt', mimeType: 'text/plain', size: '12', modifiedTime: '2026-07-17T00:02:00Z' }] } };
      },
      export: async () => ({ data: Buffer.from('ack received; return accepted') })
    }
  };
  const connector = new GoogleDriveConnector({ driveClient, rootFolderId: 'root-id', concurrency: 2 });
  const snapshot = await connector.fetchSnapshot();

  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.documents.length, 3);
  assert.equal(snapshot.counts.folders, 2);
  assert.equal(snapshot.counts.exported, 1);
  assert.equal(snapshot.documents.find((item) => item.id === 'txt-id').relativePath, 'wrong client folder/proof.txt');
  assert.match(snapshot.documents.find((item) => item.id === 'csv-id').content, /ABC,ITR filed/);
  assert.match(snapshot.documents.find((item) => item.id === 'doc-id').content, /return accepted/);
  assert.ok(listCalls.some((call) => call.pageToken === 'second-page'));
});

test('retries a rate-limited listing and honors the successful complete snapshot', async () => {
  let attempts = 0;
  const delays = [];
  const driveClient = {
    files: {
      get: async () => ({ data: { id: 'root-id', name: 'Evidence', mimeType: folderMimeType } }),
      list: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw { response: { status: 429, headers: { get: () => '0' }, data: { error: { message: 'rate limited' } } } };
        }
        return { data: { files: [] } };
      },
      export: async () => ({ data: Buffer.alloc(0) })
    }
  };
  const connector = new GoogleDriveConnector({
    driveClient,
    rootFolderId: 'root-id',
    maxAttempts: 2,
    sleep: async (delay) => delays.push(delay),
    random: () => 0
  });
  const snapshot = await connector.fetchSnapshot();

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [0]);
  assert.equal(snapshot.documents.length, 0);
});

test('returns a safe not-configured result without reading credentials', async () => {
  const connector = new GoogleDriveConnector({ rootFolderId: '' });
  const result = await connector.testConnection();
  assert.equal(result.status, 'not_configured');
  assert.equal(result.configured, false);
});
