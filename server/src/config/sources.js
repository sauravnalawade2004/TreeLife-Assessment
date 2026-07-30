const sourceAliases = {
  crm: 'pipedrive',
  pipedrive: 'pipedrive',
  documents: 'documents',
  google_drive: 'google_drive',
  notion: 'notion'
};

// CRM-only is the safe deployment default. Other connectors remain available
// in the codebase and can be enabled explicitly when their evidence is needed.
const configuredSources = (process.env.ENABLED_SOURCES || 'crm')
  .split(',')
  .map((source) => source.trim().toLowerCase())
  .filter(Boolean);

export const enabledSources = new Set(configuredSources.map((source) => sourceAliases[source] || source));

export function isSourceEnabled(source) {
  return enabledSources.has(sourceAliases[String(source || '').toLowerCase()] || String(source || '').toLowerCase());
}

export function assertSourceEnabled(source) {
  if (!isSourceEnabled(source)) {
    throw Object.assign(new Error(`${source} is disabled by ENABLED_SOURCES=${configuredSources.join(',') || 'none'}`), { status: 403 });
  }
}
