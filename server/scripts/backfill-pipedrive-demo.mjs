import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipedriveConnector } from '../src/connectors/pipedrive.connector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, '../../demo-data/pipedrive-api-backfill.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const desiredNames = [...new Set(manifest.flatMap((row) => Object.keys(row.fields)))];

let fields = await pipedriveConnector.fetchV2Collection('/api/v2/dealFields');
const fieldName = (field) => field.field_name ?? field.name;
const fieldCode = (field) => field.field_code ?? field.key ?? field.code;
const createdFields = [];

for (const name of desiredNames) {
  if (!fields.some((field) => fieldName(field) === name)) {
    await pipedriveConnector.createTextDealField(name);
    createdFields.push(name);
  }
}

if (createdFields.length) fields = await pipedriveConnector.fetchV2Collection('/api/v2/dealFields');
const codesByName = new Map(fields.map((field) => [fieldName(field), fieldCode(field)]));
const deals = await pipedriveConnector.fetchV2Collection('/api/v2/deals', { status: 'open,won,lost' });
const dealsByTitle = new Map(deals.map((deal) => [deal.title, deal]));
const missingDeals = [];
let updatedDeals = 0;

for (const item of manifest) {
  const deal = dealsByTitle.get(item.dealTitle);
  if (!deal) {
    missingDeals.push(item.dealTitle);
    continue;
  }
  const customFields = {};
  for (const [name, value] of Object.entries(item.fields)) {
    const code = codesByName.get(name);
    if (code && value !== '') customFields[code] = String(value);
  }
  await pipedriveConnector.updateDealCustomFields(deal.id, customFields);
  updatedDeals += 1;
}

console.log(JSON.stringify({ createdFields, updatedDeals, missingDeals }, null, 2));
