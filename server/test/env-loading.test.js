import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServerEnv } from '../src/load-env.js';
import '../src/database/database.js';

test('loadServerEnv reads the server .env file from the server directory', () => {
  const env = loadServerEnv();
  assert.ok(env.MONGODB_URI || process.env.MONGODB_URI, 'MongoDB URI should be loaded');
  assert.ok(env.PIPEDRIVE_API_TOKEN || process.env.PIPEDRIVE_API_TOKEN, 'Pipedrive token should be loaded');
});
