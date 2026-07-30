import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFactsForBusinessTruths, isPlausibleOwnerName } from '../src/services/semantic/live-compiler.service.js';

const fact = (overrides) => ({
  source: 'pipedrive', sourceRecordId: 'record', topic: 'income_tax_filing',
  client: 'Example Private Limited', period: null, reference: null, text: '', path: null,
  lineageKey: null, rawEvidence: {}, ...overrides
});

test('links different CRM and receipt identifiers through cross-evidence signals', () => {
  const groups = groupFactsForBusinessTruths([
    fact({ sourceRecordId: 'crm-abc', client: 'ABC Pvt Ltd', period: '06/26', reference: '27AB-JUN', text: 'ack mail me 89123' }),
    fact({ source: 'google_drive', sourceRecordId: 'drive-abc', client: 'ABC Private Limited', period: '2025-26', reference: 'AA27072689123', text: 'Acknowledgement AA27072689123' }),
    fact({ sourceRecordId: 'crm-kite', client: 'Kite Exports', period: 'AY25-26', reference: 'KTE-AY26' }),
    fact({ source: 'google_drive', sourceRecordId: 'drive-kite', client: 'Kite Exports', period: '2025-26', reference: 'KTE260071', text: 'Reference: KTE-AY26; acknowledgement KTE260071' })
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.length).sort(), [2, 2]);
});

test('normalizes equivalent month formats but keeps different periods separate', () => {
  const groups = groupFactsForBusinessTruths([
    fact({ sourceRecordId: 'crm-june', client: 'Cedar Works', period: 'Jun26', reference: 'CDR-06' }),
    fact({ source: 'google_drive', sourceRecordId: 'drive-june', client: 'Cedar Works', period: 'June 2026', reference: null }),
    fact({ sourceRecordId: 'crm-july', client: 'Cedar Works', period: '07/26', reference: 'CDR-07' })
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.length).sort(), [1, 2]);
});

test('owner validation accepts names only and rejects document-derived text', () => {
  for (const valid of ['Garima Sharma', 'K. Sharma', 'A B C D']) assert.equal(isPlausibleOwnerName(valid), true);
  for (const invalid of ['ARN: 29871', 'Status Open', 'Synthetic document', 'Garima-Owner', 'Garima 2', 'garima Sharma', 'A B C D E']) assert.equal(isPlausibleOwnerName(invalid), false);
});
