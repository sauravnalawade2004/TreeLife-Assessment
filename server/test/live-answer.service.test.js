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
  } finally {
    BusinessTruthModel.find = originals.businessFind;
    SemanticMapModel.findOne = originals.mapFindOne;
    TenantModel.findOne = originals.tenantFindOne;
    liveQueryPlannerService.plan = originals.plannerPlan;
  }
});
