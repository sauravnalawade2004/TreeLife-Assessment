import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessTruthModel } from '../src/models/BusinessTruth.js';
import { SemanticMapModel } from '../src/models/SemanticMap.js';
import { TenantModel } from '../src/models/Tenant.js';
import { liveQueryPlannerService } from '../src/services/ai/live-query-planner.service.js';
import { LiveAnswerService } from '../src/services/query/live-answer.service.js';

const basePlan = {
  operation: 'status',
  scope: 'filings',
  topic: 'income_tax_filing',
  person: null,
  client: 'Cedar Works',
  state: 'completed',
  timeRange: 'all',
  requiresClarification: false,
  clarification: null
};

function truth(overrides = {}) {
  return {
    truthId: 'cedar-truth',
    topic: 'income_tax_filing',
    client: 'Cedar Works',
    owners: ['Karan Shah'],
    ownerAliases: ['KS'],
    state: 'open',
    period: 'Jun26',
    reference: 'CDR-06',
    sources: ['pipedrive', 'google_drive', 'notion'],
    sourceRecordIds: ['deal:3', 'file:cedar', 'page:cedar'],
    evidence: [{ factId: 'cedar-drive-fact', source: 'google_drive', sourceRecordId: 'file:cedar', claim: 'open' }],
    bestPath: 'clients/cedar/final/ITR_FINAL.pdf',
    bestUrl: 'https://drive.google.com/file/d/cedar/view',
    conflict: false,
    confidence: 0.91,
    ...overrides
  };
}

test('status evidence follows the selected actual item without changing numeric state filtering', async () => {
  const originals = {
    businessFind: BusinessTruthModel.find,
    mapFindOne: SemanticMapModel.findOne,
    tenantFindOne: TenantModel.findOne,
    plannerPlan: liveQueryPlannerService.plan
  };
  let truths = [];
  let plan = basePlan;
  BusinessTruthModel.find = () => ({ lean: async () => truths });
  SemanticMapModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', version: 9, compiledAt: new Date('2026-07-17T00:00:00Z') }) });
  TenantModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', connectors: [{ id: 'google-drive-acme', type: 'google_drive', name: 'Google Drive Evidence', status: 'healthy', lastSync: new Date('2026-07-17T00:00:00Z') }] }) });
  liveQueryPlannerService.plan = async () => ({ provider: 'deterministic-test', aiCalls: 0, plan });

  try {
    const service = new LiveAnswerService();

    truths = [truth()];
    const openResult = await service.answer('acme-law', 'Is Cedar Works filed?');
    assert.equal(openResult.status, 'ANSWERED');
    assert.equal(openResult.answer.value, 'open');
    assert.deepEqual(openResult.evidence.matchedRecordIds, ['cedar-truth']);
    assert.deepEqual(openResult.evidence.sourceRecordIds, ['deal:3', 'file:cedar', 'page:cedar']);
    assert.equal(openResult.evidence.records[0].state, 'open');
    assert.equal(openResult.evidence.sourceEvidence[0].factId, 'cedar-drive-fact');

    truths = [truth({ state: 'unknown', conflict: true, confidence: 0.52 })];
    const unknownResult = await service.answer('acme-law', 'Is Cedar Works filed?');
    assert.equal(unknownResult.status, 'CONFLICT');
    assert.deepEqual(unknownResult.evidence.matchedRecordIds, ['cedar-truth']);
    assert.equal(unknownResult.evidence.records[0].state, 'unknown');
    assert.deepEqual(unknownResult.evidence.unresolvedExcluded, []);

    const completed = truth({ truthId: 'filed-truth', client: 'ABC Private Limited', state: 'completed', conflict: false, sourceRecordIds: ['deal:1'], evidence: [] });
    truths = [truth(), completed];
    plan = { ...basePlan, operation: 'count', client: null };
    const countResult = await service.answer('acme-law', 'How many income tax filings are completed?');
    assert.equal(countResult.status, 'ANSWERED');
    assert.equal(countResult.answer.value, 1);
    assert.deepEqual(countResult.evidence.matchedRecordIds, ['filed-truth']);

    truths = [
      truth({ truthId: 'july-truth', period: 'Jul26', state: 'completed', client: 'Cedar Works', conflict: false, sourceRecordIds: ['deal:4'] }),
      truth({ truthId: 'education-lead', topic: 'education_deal', client: 'Education Private Limited', state: 'open', conflict: false, sourceRecordIds: ['deal:5'], sources: ['pipedrive'] })
    ];
    plan = { ...basePlan, operation: 'count', client: null, topic: 'education_deal', state: null, scope: 'crm_deals' };
    const educationResult = await service.answer('acme-law', 'How many education deals are there?');
    assert.equal(educationResult.status, 'ANSWERED');
    assert.equal(educationResult.answer.value, 1);
    assert.deepEqual(educationResult.evidence.matchedRecordIds, ['education-lead']);

    truths = [truth({ truthId: 'july-truth', period: 'Jul26', state: 'completed', client: 'Cedar Works', conflict: false, sourceRecordIds: ['deal:4'] })];
    plan = { ...basePlan, operation: 'count', client: null, timeRange: '2026-07' };
    const julyResult = await service.answer('acme-law', 'How many completed filings occurred in July 2026?');
    assert.equal(julyResult.status, 'ANSWERED');
    assert.equal(julyResult.answer.value, 1);
    assert.deepEqual(julyResult.evidence.matchedRecordIds, ['july-truth']);

    truths = [
      truth({ truthId: 'education-false-match', topic: 'income_tax_filing', client: 'Cedar Works', conflict: false, sourceRecordIds: ['deal:9'], evidence: [{ factId: 'education-text', source: 'pipedrive', sourceRecordId: 'deal:9', claim: 'open', text: 'This deal mentions education in the notes but is not an education record.' }] }),
      truth({ truthId: 'education-true-match', topic: 'education_deal', client: 'Northview College', state: 'open', conflict: false, sourceRecordIds: ['deal:10'], sources: ['pipedrive'], evidence: [{ factId: 'education-true', source: 'pipedrive', sourceRecordId: 'deal:10', claim: 'open', text: 'Education enrollment record.' }] })
    ];
    plan = { ...basePlan, operation: 'count', client: null, topic: 'education_deal', state: null, scope: 'crm_deals' };
    const educationTopicResult = await service.answer('acme-law', 'How many education deals are there?');
    assert.equal(educationTopicResult.status, 'ANSWERED');
    assert.equal(educationTopicResult.answer.value, 1);
    assert.deepEqual(educationTopicResult.evidence.matchedRecordIds, ['education-true-match']);
  } finally {
    BusinessTruthModel.find = originals.businessFind;
    SemanticMapModel.findOne = originals.mapFindOne;
    TenantModel.findOne = originals.tenantFindOne;
    liveQueryPlannerService.plan = originals.plannerPlan;
  }
});

test('unsupported negation and ranking questions return clarification before execution', async () => {
  const originals = {
    businessFind: BusinessTruthModel.find,
    mapFindOne: SemanticMapModel.findOne,
    tenantFindOne: TenantModel.findOne,
    geminiKey: process.env.GEMINI_API_KEY
  };
  delete process.env.GEMINI_API_KEY;
  BusinessTruthModel.find = () => ({ lean: async () => [truth({ sources: ['pipedrive'] })] });
  SemanticMapModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', version: 10, glossary: { topics: ['transaction_deals'], people: { 'Garima Sharma': ['Garima'] }, clients: [] } }) });
  TenantModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', connectors: [{ id: 'pipedrive-acme', type: 'crm', name: 'Pipedrive', status: 'healthy' }] }) });
  try {
    const service = new LiveAnswerService();
    const negationCases = [
      ['organizations without any open deals', 'VERIFIED_ZERO', 0],
      ['deals not owned by garima', 'ANSWERED', 1]
    ];
    for (const [question, expectedStatus, expectedCount] of negationCases) {
      const result = await service.answer('acme-law', question);
      assert.equal(result.status, expectedStatus);
      assert.notEqual(result.answer, null);
      assert.equal(result.answer.value, expectedCount);
    }
    const rankingResult = await service.answer('acme-law', 'which client has the most deals');
    assert.equal(rankingResult.status, 'ANSWERED');
    assert.notEqual(rankingResult.answer, null);
    assert.equal(rankingResult.answer.value.client, 'Cedar Works');
    assert.equal(rankingResult.answer.value.count, 1);
    assert.ok(rankingResult.answer.text.includes('most'));
  } finally {
    BusinessTruthModel.find = originals.businessFind;
    SemanticMapModel.findOne = originals.mapFindOne;
    TenantModel.findOne = originals.tenantFindOne;
    if (originals.geminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originals.geminiKey;
  }
});

test('executes Gemini-provided negated filters and organization absence groups', async () => {
  const originals = {
    businessFind: BusinessTruthModel.find,
    mapFindOne: SemanticMapModel.findOne,
    tenantFindOne: TenantModel.findOne,
    plannerPlan: liveQueryPlannerService.plan
  };
  let plan;
  const truths = [
    truth({ truthId: 'garima-open', client: 'Aster', owners: ['Garima Sharma'], ownerAliases: ['Garima'], state: 'open', sources: ['pipedrive'] }),
    truth({ truthId: 'karan-completed', client: 'Aster', owners: ['Karan Shah'], ownerAliases: ['Karan'], state: 'completed', sources: ['pipedrive'] }),
    truth({ truthId: 'priya-completed', client: 'Beta', owners: ['Priya Rao'], ownerAliases: ['Priya'], state: 'completed', sources: ['pipedrive'] })
  ];
  BusinessTruthModel.find = () => ({ lean: async () => truths });
  SemanticMapModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', version: 11, glossary: {} }) });
  TenantModel.findOne = () => ({ lean: async () => ({ tenantId: 'acme-law', connectors: [{ id: 'pipedrive-acme', type: 'crm', name: 'Pipedrive', status: 'healthy' }] }) });
  liveQueryPlannerService.plan = async () => ({ provider: 'gemini-test', aiCalls: 1, plan });
  try {
    const service = new LiveAnswerService();
    plan = { ...basePlan, operation: 'count', scope: 'crm_deals', topic: null, person: 'Garima Sharma', client: null, state: null, negated: true, negatedPerson: true };
    for (const question of ['deals excluding Garima', 'everyone else\'s deals besides Garima']) {
      const result = await service.answer('acme-law', question);
      assert.equal(result.status, 'ANSWERED');
      assert.equal(result.answer.value, 2);
      assert.deepEqual(result.evidence.matchedRecordIds.sort(), ['karan-completed', 'priya-completed']);
    }

    plan = { ...basePlan, operation: 'count', scope: 'crm_deals', topic: null, person: null, client: null, state: 'open', groupByClient: true, requireNoMatchingInGroup: true };
    for (const question of ['organizations that have zero open deals', 'orgs with no open pipeline']) {
      const result = await service.answer('acme-law', question);
      assert.equal(result.status, 'ANSWERED');
      assert.equal(result.answer.value, 1);
      assert.deepEqual(result.evidence.matchedRecordIds, ['priya-completed']);
    }

    plan = { ...basePlan, operation: 'count', scope: 'crm_deals', topic: null, person: null, client: null, state: null, groupByClient: true, requireNoMatchingInGroup: false };
    for (const question of ['how many organizations are there', 'total organizations', 'count of distinct clients']) {
      const result = await service.answer('acme-law', question);
      assert.equal(result.status, 'ANSWERED');
      assert.equal(result.answer.value, 2);
    }

    plan = { ...basePlan, operation: 'list', scope: 'crm_deals', topic: null, person: null, client: null, state: null, groupByClient: true, requireAllStatesInGroup: true, states: ['open', 'completed'] };
    for (const question of ['which organizations have both open and completed deals', 'organizations with open and completed deals']) {
      const result = await service.answer('acme-law', question);
      assert.equal(result.status, 'ANSWERED');
      assert.equal(result.answer.value.length, 1);
      assert.equal(result.answer.value[0].client, 'Aster');
    }
  } finally {
    BusinessTruthModel.find = originals.businessFind;
    SemanticMapModel.findOne = originals.mapFindOne;
    TenantModel.findOne = originals.tenantFindOne;
    liveQueryPlannerService.plan = originals.plannerPlan;
  }
});
