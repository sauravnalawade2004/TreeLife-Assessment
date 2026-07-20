import test from 'node:test';
import assert from 'node:assert/strict';
import { guardPlanForTenant } from '../src/services/ai/live-query-planner.service.js';

const glossary = {
  topics: ['income_tax_filing', 'gst_filing', 'inventory_register'],
  people: { 'Garima Sharma': ['Grima', 'G. Sharma'] },
  clients: ['Cedar Works']
};
const base = {
  operation: 'count', scope: 'business_items', topic: null, person: null, client: null,
  state: null, timeRange: 'all', expandedTerms: [], supportedByTenant: true,
  requiresClarification: false, clarification: null
};

test('rejects unrelated general-knowledge questions before query execution', () => {
  const plan = guardPlanForTenant('How many FIFA World Cups has Argentina won?', base, glossary);
  assert.equal(plan.supportedByTenant, false);
  assert.equal(plan.requiresClarification, true);
});

test('allows a topic mapped to the compiled tenant glossary', () => {
  const plan = guardPlanForTenant('How many GST filings are completed?', { ...base, scope: 'filings', topic: 'gst_filing' }, glossary);
  assert.equal(plan.requiresClarification, false);
});

test('allows an explicitly broad business query but rejects an unknown filing subtype', () => {
  const broad = guardPlanForTenant('How many open matters are there?', { ...base, state: 'open' }, glossary);
  const unknown = guardPlanForTenant('How many payroll filings did we complete?', { ...base, scope: 'filings', state: 'completed' }, glossary);
  assert.equal(broad.requiresClarification, false);
  assert.equal(unknown.requiresClarification, true);
});
