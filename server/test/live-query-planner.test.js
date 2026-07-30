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

test('treats common CRM terms like leads as supported business questions', () => {
  const plan = guardPlanForTenant('How many leads are open?', { ...base, scope: 'crm_deals' }, glossary);
  assert.equal(plan.requiresClarification, false);
  assert.equal(plan.supportedByTenant, true);
});

test('accepts plain CRM keyword queries like leads and deals completed', () => {
  const leadPlan = guardPlanForTenant('leads', { ...base, scope: 'crm_deals' }, glossary);
  const dealsPlan = guardPlanForTenant('deals completed', { ...base, scope: 'crm_deals' }, glossary);
  assert.equal(leadPlan.supportedByTenant, true);
  assert.equal(leadPlan.requiresClarification, false);
  assert.equal(dealsPlan.supportedByTenant, true);
  assert.equal(dealsPlan.requiresClarification, false);
});

test('accepts natural pipeline and task phrasing', () => {
  const pipeline = guardPlanForTenant('What is the current pipeline?', { ...base, scope: 'crm_deals' }, glossary);
  const tasks = guardPlanForTenant('How many pending tasks are there?', { ...base, scope: 'business_items' }, glossary);
  assert.equal(pipeline.requiresClarification, false);
  assert.equal(tasks.requiresClarification, false);
});

test('accepts generic business words like record and application', () => {
  const recordPlan = guardPlanForTenant('How many records are there?', { ...base, scope: 'business_items' }, glossary);
  const applicationPlan = guardPlanForTenant('How many applications are open?', { ...base, scope: 'business_items' }, glossary);
  assert.equal(recordPlan.requiresClarification, false);
  assert.equal(applicationPlan.requiresClarification, false);
  assert.equal(recordPlan.supportedByTenant, true);
  assert.equal(applicationPlan.supportedByTenant, true);
});

test('accepts student and enrollment phrasing for unfamiliar domains', () => {
  const studentPlan = guardPlanForTenant('How many students have pending fees?', { ...base, scope: 'business_items' }, { ...glossary, topics: ['student_enrollment'] });
  const enrollmentPlan = guardPlanForTenant('How many enrollments are open?', { ...base, scope: 'business_items' }, { ...glossary, topics: ['student_enrollment'] });
  assert.equal(studentPlan.requiresClarification, false);
  assert.equal(enrollmentPlan.requiresClarification, false);
  assert.equal(studentPlan.supportedByTenant, true);
  assert.equal(enrollmentPlan.supportedByTenant, true);
});

test('accepts CRM phrasing across client, company, customer, and organization synonyms', () => {
  const queries = [
    'How many clients do we have?',
    'How many customers are in the pipeline?',
    'What is the total number of companies?',
    'Show me all organizations.',
    'Where are the deals?',
    'Give me the count of leads.'
  ];
  const plans = queries.map((query) => guardPlanForTenant(query, { ...base, scope: 'crm_deals' }, glossary));
  for (const plan of plans) {
    assert.equal(plan.requiresClarification, false, `Failed on: ${plan}`);
    assert.equal(plan.supportedByTenant, true, `Failed on: ${plan}`);
  }
});

test('accepts direct CRM topic-only queries for leads and deals', () => {
  const leadPlan = guardPlanForTenant('leads', { ...base, scope: 'crm_deals' }, glossary);
  const dealPlan = guardPlanForTenant('deals', { ...base, scope: 'crm_deals' }, glossary);
  assert.equal(leadPlan.requiresClarification, false);
  assert.equal(leadPlan.supportedByTenant, true);
  assert.equal(dealPlan.requiresClarification, false);
  assert.equal(dealPlan.supportedByTenant, true);
});

test('extracts explicit month and year ranges from plain language', async () => {
  const service = new (await import('../src/services/ai/live-query-planner.service.js')).LiveQueryPlannerService();
  const result = await service.plan('How many deals were open in July 2026?', { glossary: { topics: [], people: {}, clients: [] } });
  assert.equal(result.plan.scope, 'crm_deals');
  assert.equal(result.plan.timeRange, '2026-07');
  assert.equal(result.plan.requiresClarification, false);
});

test('classifies existential count questions as count, not verify', async () => {
  const service = new (await import('../src/services/ai/live-query-planner.service.js')).LiveQueryPlannerService();
  const queries = [
    'how many organization is there in pipedrive',
    'How many leads are there?',
    'What is the total number of companies?',
    'Give me the count of deals.',
    'How many customers do we have overall?'
  ];
  for (const question of queries) {
    const result = await service.plan(question, { glossary: { topics: [], people: {}, clients: [] } });
    assert.equal(result.plan.operation, 'count', `Expected count for: ${question}`);
  }
});

test('still classifies explicit verification questions as verify', async () => {
  const service = new (await import('../src/services/ai/live-query-planner.service.js')).LiveQueryPlannerService();
  const result = await service.plan('Was the income tax filing completed?', { glossary: { topics: ['income_tax_filing'], people: {}, clients: [] } });
  assert.equal(result.plan.operation, 'verify');
});
