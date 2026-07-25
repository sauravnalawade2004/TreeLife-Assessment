import { BusinessTruthModel } from '../../models/BusinessTruth.js';
import { SemanticMapModel } from '../../models/SemanticMap.js';
import { TenantModel } from '../../models/Tenant.js';
import { liveQueryPlannerService } from '../ai/live-query-planner.service.js';

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const crmEntityTerms = ['deal', 'deals', 'lead', 'leads', 'opportunity', 'opportunities', 'prospect', 'prospects', 'pipeline', 'pipelines', 'organization', 'organizations', 'stage', 'stages', 'owner', 'owners', 'account', 'accounts', 'client', 'clients', 'customer', 'customers', 'company', 'companies', 'business', 'businesses'];
const crmTermRegex = new RegExp(`\\b(?:${crmEntityTerms.join('|')})\\b`);
const filingTopic = (topic) => /filing|return|application/.test(topic || '');
const liveConnectorIds = new Set(['pipedrive-acme', 'documents-acme', 'google-drive-acme', 'notion-acme']);

function activeConnectors(connectors = []) {
  const live = connectors.filter((connector) => liveConnectorIds.has(connector.id));
  const selected = live.length ? live : connectors;
  return selected.some((connector) => connector.id === 'google-drive-acme')
    ? selected.filter((connector) => connector.id !== 'documents-acme')
    : selected;
}

function levenshtein(a, b) {
  const left = normalize(a), right = normalize(b);
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[right.length];
}

function fuzzyMatch(candidate, query) {
  const left = normalize(candidate), right = normalize(query);
  if (!right) return true;
  if (!left) return false;
  if (left.includes(right) || right.includes(left)) return true;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1) >= 0.72;
}

function periodDate(period) {
  const value = String(period ?? '').trim().toLowerCase();
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const word = value.match(/(jan|feb|mar|apr|may|jun|june|jul|july|aug|sep|sept|oct|nov|dec)[a-z]*[-/ ]*(\d{2,4})/);
  if (word) return new Date(Date.UTC(Number(word[2].length === 2 ? `20${word[2]}` : word[2]), months[word[1]], 1));
  const numeric = value.match(/\b(0?[1-9]|1[0-2])[-/ ]?(\d{2,4})\b/);
  if (numeric) return new Date(Date.UTC(Number(numeric[2].length === 2 ? `20${numeric[2]}` : numeric[2]), Number(numeric[1]) - 1, 1));
  const yearOnly = value.match(/\b(20\d{2})\b/);
  if (yearOnly) return new Date(Date.UTC(Number(yearOnly[1]), 0, 1));
  return null;
}

function inRange(truth, range) {
  if (range === 'all') return true;
  const date = truth.eventDate ? new Date(truth.eventDate) : periodDate(truth.period);
  if (!date || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (range === 'last_month' || range === 'this_month') {
    const monthOffset = range === 'last_month' ? -1 : 0;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset + 1, 1));
    return date >= start && date < end;
  }
  if (range === 'this_year') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    return date >= start && date < end;
  }
  if (range === 'last_year') {
    const start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return date >= start && date < end;
  }
  const yearMonth = range.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (yearMonth) {
    const year = Number(yearMonth[1]); const month = Number(yearMonth[2]) - 1;
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    return date >= start && date < end;
  }
  const yearOnly = range.match(/^(20\d{2})$/);
  if (yearOnly) {
    const start = new Date(Date.UTC(Number(yearOnly[1]), 0, 1));
    const end = new Date(Date.UTC(Number(yearOnly[1]) + 1, 0, 1));
    return date >= start && date < end;
  }
  return true;
}

function topicMatches(truth, plan) {
  if (plan.topic && normalize(truth.topic) !== normalize(plan.topic)) return false;
  if (plan.scope === 'crm_deals' && !truth.sources.includes('pipedrive')) return false;
  if (plan.scope === 'files' && !truth.sources.some((source) => ['documents', 'google_drive'].includes(source))) return false;
  if (plan.scope === 'filings' && !filingTopic(truth.topic)) return false;
  return true;
}

function isGenericCrmQuestion(question) {
  const q = String(question || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const genericWords = ['how', 'many', 'much', 'of', 'the', 'a', 'an', 'and', 'or', 'in', 'our', 'we', 'you', 'are', 'is', 'there', 'there', 'what', 'show', 'list', 'give', 'me', 'total', 'overall', 'count', 'all', 'for', 'have', 'has', 'to', 'on', 'by', 'with'];
  const generic = q.replace(/\b(?:how many|how much|how many of|what is the|what are the|what are|total|overall|count|number of|show me|list|give me|all of|any of|where is|where are|status of|how many have|how many were|how many are|there are|there is|are there)\b/g, '')
    .replace(/\b(?:deal|deals|lead|leads|opportunity|opportunities|prospect|prospects|pipeline|pipelines|organization|organizations|stage|stages|owner|owners|account|accounts|client|clients|customer|customers|company|companies|business|businesses)\b/g, '')
    .split(/\s+/).filter(Boolean);
  return generic.every((token) => genericWords.includes(token));
}

function coverage(tenant, checkedSources) {
  return activeConnectors(tenant?.connectors || []).map((connector) => ({
    source: connector.type,
    status: checkedSources.has(connector.type) || checkedSources.has(connector.name?.toLowerCase()) ? 'checked' : 'not_relevant',
    freshness: connector.lastSync,
    health: connector.status
  }));
}

function label(topic, count = 2) {
  const text = String(topic || 'business item').replaceAll('_', ' ');
  if (count === 1) return text.endsWith('s') ? text.slice(0, -1) : text;
  return text.endsWith('s') ? text : `${text}s`;
}

export class LiveAnswerService {
  async available(tenantId) {
    return Boolean(await SemanticMapModel.exists({ tenantId, status: 'compiled' }) && await BusinessTruthModel.exists({ tenantId }));
  }

  async answer(tenantId, question) {
    const [semanticMap, tenant, truths] = await Promise.all([
      SemanticMapModel.findOne({ tenantId }).lean(),
      TenantModel.findOne({ tenantId }).lean(),
      BusinessTruthModel.find({ tenantId }).lean()
    ]);
    if (!semanticMap || !truths.length) throw Object.assign(new Error('Live semantic layer has not been compiled'), { status: 409 });
    const planned = await liveQueryPlannerService.plan(question, semanticMap);
    const plan = planned.plan;
    const checkedSources = new Set(activeConnectors(tenant?.connectors || []).map((connector) => connector.type));
    const sourceCoverage = coverage(tenant, checkedSources);
    if (plan.requiresClarification) {
      return {
        status: 'NEEDS_CLARIFICATION', question, answer: null, clarification: plan.clarification,
        interpretation: plan, confidence: 0.5, ai: planned,
        evidence: { matchedRecordIds: [], sourceCoverage },
        reasoning: ['The planner found a genuine business-language ambiguity and stopped before executing a calculation.']
      };
    }
    const candidates = truths.filter((truth) => topicMatches(truth, plan));
    const scopedCandidates = candidates.filter((truth) => {
      if (plan.person && ![...(truth.owners || []), ...(truth.ownerAliases || [])].some((owner) => fuzzyMatch(owner, plan.person))) return false;
      if (plan.client && !fuzzyMatch(truth.client, plan.client)) return false;
      if (!inRange(truth, plan.timeRange)) return false;
      return true;
    });
    const matched = scopedCandidates.filter((truth) => !plan.state || truth.state === plan.state);
    const unresolved = scopedCandidates.filter((truth) => truth.state === 'unknown' || truth.conflict);
    const broadCount = plan.operation === 'count' && !plan.topic && crmTermRegex.test(String(question || '').toLowerCase()) && isGenericCrmQuestion(question);
    const countCandidates = broadCount ? truths.filter((truth) => truth.sources.includes('pipedrive') && inRange(truth, plan.timeRange)) : [];
    const allHealthy = sourceCoverage.filter((item) => item.status === 'checked').every((item) => ['healthy', 'demo'].includes(item.health));
    let status = 'ANSWERED', answer = null;
    let evidenceItems = matched;
    let selectedStatusItem = null;
    if (plan.operation === 'locate') {
      const located = matched.find((truth) => truth.bestPath) || candidates.find((truth) => truth.bestPath && (!plan.topic || normalize(truth.topic) === normalize(plan.topic)));
      if (!located) status = 'UNKNOWN';
      else answer = { value: located.bestPath, url: located.bestUrl || null, text: `The best verified location is ${located.bestPath}.` };
    } else if (['status', 'verify'].includes(plan.operation)) {
      const item = matched[0] || scopedCandidates[0] || candidates.find((truth) => !plan.client || fuzzyMatch(truth.client, plan.client));
      selectedStatusItem = item || null;
      if (item) evidenceItems = [item];
      if (!item) {
        status = 'UNKNOWN';
        answer = { value: null, text: 'No record with enough evidence was found to verify that status.' };
      }
      else if (item.conflict || item.state === 'unknown') {
        status = 'CONFLICT';
        answer = { value: null, text: `${item.client || 'The item'} could not be verified because the available evidence conflicts or is incomplete.` };
      } else answer = { value: item.state, text: `${item.client || 'The item'} is ${item.state}.` };
    } else if (plan.operation === 'list' || plan.operation === 'summarize') {
      if (!matched.length) status = unresolved.length ? 'UNKNOWN' : (allHealthy ? 'VERIFIED_ZERO' : 'UNKNOWN');
      else answer = { value: matched.map((truth) => ({ client: truth.client, topic: truth.topic, state: truth.state, reference: truth.reference })), text: matched.map((truth) => `${truth.client || truth.reference || truth.truthId} (${truth.state})`).join(', ') };
      if (status === 'UNKNOWN') answer = { value: null, text: 'A verified list cannot be returned because relevant evidence is incomplete or conflicting.' };
    } else {
      if (!matched.length && broadCount && countCandidates.length) {
        evidenceItems = countCandidates;
      }
      if (!matched.length) status = unresolved.length ? 'UNKNOWN' : (allHealthy ? 'VERIFIED_ZERO' : 'UNKNOWN');
      const value = matched.length || (broadCount ? countCandidates.length : 0);
      answer = status === 'UNKNOWN'
        ? { value: null, unit: label(plan.topic || plan.scope), text: 'A verified number cannot be given because relevant evidence is incomplete or conflicting.' }
        : status === 'VERIFIED_ZERO'
        ? { value: 0, unit: label(plan.topic || plan.scope), text: `No verified matching ${label(plan.topic || plan.scope)} were found.` }
        : { value, unit: label(plan.topic || plan.scope, value), text: `${value} verified ${label(plan.topic || plan.scope, value)} matched the question.` };
    }
    const average = evidenceItems.length ? evidenceItems.reduce((sum, truth) => sum + truth.confidence, 0) / evidenceItems.length : 0.78;
    const confidence = status === 'UNKNOWN' ? 0.35 : status === 'CONFLICT' ? 0.58 : Math.min(0.97, average);
    const matchedFacts = evidenceItems.flatMap((truth) => truth.evidence || []);
    const evidenceIds = new Set(evidenceItems.map((truth) => truth.truthId));
    const unresolvedExcluded = unresolved.filter((truth) => !evidenceIds.has(truth.truthId));
    return {
      status,
      question,
      answer,
      interpretation: plan,
      confidence,
      ai: planned,
      evidence: {
        matchedRecordIds: evidenceItems.map((truth) => truth.truthId),
        sourceRecordIds: [...new Set(evidenceItems.flatMap((truth) => truth.sourceRecordIds || []))],
        sourceCoverage,
        records: evidenceItems.map((truth) => ({ truthId: truth.truthId, client: truth.client, topic: truth.topic, state: truth.state, reference: truth.reference, confidence: truth.confidence, sources: truth.sources, bestPath: truth.bestPath, bestUrl: truth.bestUrl })),
        sourceEvidence: matchedFacts,
        unresolvedExcluded: unresolvedExcluded.map((truth) => truth.truthId)
      },
      reasoning: [
        `Used live semantic map version ${semanticMap.version}; query topic resolved to ${plan.topic || plan.scope}.`,
        `Retrieved ${candidates.length} candidate business truths from ${sourceCoverage.filter((item) => item.status === 'checked').map((item) => item.source).join(', ') || 'the indexed sources'}.`,
        selectedStatusItem && !matched.includes(selectedStatusItem)
          ? `The requested state did not match; evaluated ${selectedStatusItem.client || 'the selected item'} from its actual evidence-backed state.`
          : `Applied person, client, state, and time filters and retained ${matched.length} deduplicated items.`,
        unresolvedExcluded.length
          ? `${unresolvedExcluded.length} unresolved or conflicting item${unresolvedExcluded.length === 1 ? ' was' : 's were'} excluded from verified counts.`
          : selectedStatusItem?.conflict || selectedStatusItem?.state === 'unknown'
            ? 'The selected item remains unresolved and was returned as a conflict, not converted into a yes, no, or zero.'
            : 'No unresolved item was included in the verified result.',
        'The backend calculated the result; Gemini produced the query plan and did not supply the final number.'
      ],
      semanticMap: { version: semanticMap.version, compiledAt: semanticMap.compiledAt }
    };
  }
}

export const liveAnswerService = new LiveAnswerService();
