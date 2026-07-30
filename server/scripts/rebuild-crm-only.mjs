import '../src/load-env.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { syncPipedrive } from '../src/services/sync/pipedrive-sync.service.js';
import { compileLiveSemanticLayer } from '../src/services/semantic/live-compiler.service.js';

if ((process.env.ENABLED_SOURCES || 'crm').trim().toLowerCase() !== 'crm') {
  throw new Error('Refusing CRM-only rebuild: set ENABLED_SOURCES=crm first.');
}

const state = await connectDatabase({ seedIfEmpty: false });
if (!state.connected) throw new Error(`Database connection is required: ${state.error || 'MONGODB_URI is not configured'}`);

try {
  const sync = await syncPipedrive('acme-law');
  const semanticMap = await compileLiveSemanticLayer('acme-law');
  console.log(JSON.stringify({ sync, compiled: { version: semanticMap.version, stats: semanticMap.stats, sourceProfiles: semanticMap.sourceProfiles } }, null, 2));
} finally {
  await disconnectDatabase();
}
