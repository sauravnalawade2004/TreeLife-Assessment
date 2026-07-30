import crypto from 'node:crypto';
import { repository } from '../../repositories/demoRepository.js';
import { SemanticFactModel } from '../../models/SemanticFact.js';
import { BusinessTruthModel } from '../../models/BusinessTruth.js';
import { SemanticMapModel } from '../../models/SemanticMap.js';
import { semanticAiService } from '../ai/semantic-ai.service.js';

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const distinct = (values) => [...new Set(values.filter(Boolean))];
const clamp = (value) => Math.max(0, Math.min(1, value));
const stripCompanySuffixes = (value) => String(value ?? '').toLowerCase()
  .replace(/\b(private|pvt|limited|ltd|llp|inc|corp|corporation|services|traders)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '');

const OWNER_FIELD_HINTS = ['deal owner', 'lead owner', 'assigned to', 'assignee', 'responsible', 'handled by', 'handler', 'relationship manager', 'case handler', 'owner'];

function cleanOwnerLabel(name) {
  return String(name || '')
    .replace(/\s*(?:ARN:|Status:.*|for.*|reference.*|token.*|case.*)\s*$/i, '')
    .replace(/\s+[A-Z0-9]+[A-Z0-9-]*$|^\s*(?:[A-Z][a-z]+\s+){1,}(?:ARN|Status|Reference|Token)[a-z]*\s*$/, '')
    .replace(/^(?:.,?\s*)?(Synthetic|assessment|evidence|document|--|of|1|all\s+of\s+\d+|GST|ID|A\/N)\s+/, '')
    .trim();
}

function isPlausibleOwnerLabel(name) {
  const cleaned = cleanOwnerLabel(name);
  return cleaned.length > 1 && /^[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*$/.test(cleaned);
}

function sanitizeOwnerLabels(values) {
  return distinct(values.map(cleanOwnerLabel).filter(isPlausibleOwnerLabel));
}

function fieldHintScore(fieldName, hints) {
  const normalized = String(fieldName ?? '').trim().toLowerCase();
  if (hints.some((hint) => normalized.includes(String(hint).toLowerCase()))) return 1;
  const words = [...new Set(normalized.replace(/[_]+/g, ' ').match(/[a-z0-9]+/g) || [])];
  if (!words.length) return 0;
  return Math.max(...hints.map((hint) => {
    const hintWords = [...new Set(String(hint).toLowerCase().replace(/[_]+/g, ' ').match(/[a-z0-9]+/g) || [])];
    if (!hintWords.length) return 0;
    const intersection = words.filter((word) => hintWords.includes(word)).length;
    return intersection / new Set([...words, ...hintWords]).size;
  }));
}

function similarity(a, b) {
  const left = stripCompanySuffixes(a), right = stripCompanySuffixes(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const A = new Set(left.split('')), B = new Set(right.split(''));
  return [...A].filter((item) => B.has(item)).length / new Set([...A, ...B]).size;
}

const monthNumber = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10,
  october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function fullYear(value) {
  const year = Number(value);
  return String(value).length === 2 ? 2000 + year : year;
}

function periodIdentity(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  const fiscal = text.match(/(?:\bay\b|\bfy\b)?\s*(20\d{2}|\d{2})\s*[-/]\s*(20\d{2}|\d{2})/i);
  if (fiscal) return `year:${fullYear(fiscal[1])}-${fullYear(fiscal[2])}`;
  const wordMonth = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s*[-/]?\s*(20\d{2}|\d{2})\b/i);
  if (wordMonth) return `month:${fullYear(wordMonth[2])}-${String(monthNumber[wordMonth[1]]).padStart(2, '0')}`;
  const compactWordMonth = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(20\d{2}|\d{2})\b/i);
  if (compactWordMonth) return `month:${fullYear(compactWordMonth[2])}-${String(monthNumber[compactWordMonth[1]]).padStart(2, '0')}`;
  const numericMonth = text.match(/\b(0?[1-9]|1[0-2])\s*[-/]\s*(20\d{2}|\d{2})\b/);
  if (numericMonth) return `month:${fullYear(numericMonth[2])}-${String(Number(numericMonth[1])).padStart(2, '0')}`;
  return `literal:${normalize(text)}`;
}

function periodsCompatible(left, right) {
  if (!normalize(left) || !normalize(right)) return true;
  return periodIdentity(left) === periodIdentity(right);
}

function evidenceText(fact) {
  return [
    fact.reference,
    fact.text,
    fact.path,
    fact.rawEvidence?.title,
    fact.rawEvidence?.notes?.join?.(' ')
  ].filter(Boolean).join(' ');
}

function identifierSignals(fact) {
  const text = evidenceText(fact);
  const signals = new Set();
  const reference = normalize(fact.reference);
  if (reference.length >= 5 && /\d/.test(reference)) signals.add(reference);
  for (const match of text.matchAll(/\b\d{5,}\b/g)) signals.add(match[0]);
  for (const match of text.matchAll(/\b[a-z0-9]+(?:[-_/][a-z0-9]+)+\b/gi)) {
    const signal = normalize(match[0]);
    if (signal.length >= 6 && /[a-z]/.test(signal) && /\d/.test(signal)) signals.add(signal);
  }
  return signals;
}

function referencesLinked(left, right) {
  const leftReference = normalize(left.reference), rightReference = normalize(right.reference);
  if (leftReference && leftReference === rightReference) return true;
  const leftEvidence = normalize(evidenceText(left)), rightEvidence = normalize(evidenceText(right));
  if (leftReference.length >= 5 && rightEvidence.includes(leftReference)) return true;
  if (rightReference.length >= 5 && leftEvidence.includes(rightReference)) return true;
  const rightSignals = identifierSignals(right);
  return [...identifierSignals(left)].some((leftSignal) => [...rightSignals]
    .some((rightSignal) => leftSignal === rightSignal || leftSignal.includes(rightSignal) || rightSignal.includes(leftSignal)));
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

function ownerSimilarity(alias, canonical) {
  const a = normalize(alias), c = normalize(canonical);
  if (!a || !c) return 0;
  if (a === c) return 1;
  const first = normalize(String(canonical).split(/\s+/)[0]);
  const words = String(canonical).split(/\s+/).filter(Boolean);
  const initials = words.map((word) => normalize(word)[0]).join('');
  const aliasInitials = String(alias).split(/[.\s_-]+/).filter(Boolean).map((word) => normalize(word)[0]).join('');
  if (a === initials || aliasInitials === initials) return 0.9;
  if (words.length > 1 && a.startsWith(first[0]) && a.includes(normalize(words.at(-1)))) return 0.88;
  return 1 - levenshtein(a, first) / Math.max(a.length, first.length, 1);
}

function buildBundles(records) {
  const organizations = new Map(records.filter((record) => record.source === 'pipedrive' && record.entity === 'organization')
    .map((record) => [String(record.fields.raw?.id ?? record.id.replace('organization:', '')), record.fields.name]));
  const notesByDeal = new Map();
  for (const note of records.filter((record) => record.source === 'pipedrive' && record.entity === 'note')) {
    const dealId = String(note.fields.deal_id ?? '');
    if (!notesByDeal.has(dealId)) notesByDeal.set(dealId, []);
    notesByDeal.get(dealId).push(String(note.fields.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  const bundles = [];
  for (const deal of records.filter((record) => record.source === 'pipedrive' && record.entity === 'deal')) {
    const dealId = String(deal.fields.raw?.id ?? deal.id.replace('deal:', ''));
    const organization = organizations.get(String(deal.fields.organization_id ?? deal.fields.raw?.org_id ?? '')) || null;
    const notes = notesByDeal.get(dealId) || [];
    const rawFields = Object.entries(deal.fields)
      .filter(([key]) => key !== 'custom_fields' && key !== 'raw' && key !== 'notes')
      .reduce((acc, [name, value]) => {
        if (value === undefined || value === null || value === '') return acc;
        const fieldValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return { ...acc, [name]: { value: fieldValue } };
      }, {});
    const customFields = { ...rawFields, ...(deal.fields.custom_fields || {}) };
    const customText = Object.entries(customFields).map(([name, item]) => `${name}: ${item?.value ?? item}`).join('; ');
    const rawSummary = Object.entries(deal.fields.raw || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .filter(([key]) => !['custom_fields'].includes(key))
      .map(([key, value]) => {
        if (typeof value === 'object') return `${key}: ${JSON.stringify(value)}`;
        return `${key}: ${String(value)}`;
      })
      .join('\n');
    const titleValue = deal.fields.title || deal.fields.summary || deal.fields.raw?.title || deal.fields.raw?.name || deal.fields.raw?.deal_title || '';
    const statusValue = deal.fields.official_status || deal.fields.raw?.status || deal.fields.raw?.stage || deal.fields.raw?.pipeline_stage_name || '';
    bundles.push({
      inputId: deal.id,
      source: 'pipedrive',
      sourceRecordId: deal.id,
      title: titleValue,
      organization,
      officialStatus: statusValue,
      customFields,
      notes,
      path: null,
      content: `${titleValue || ''}\nOrganization: ${organization || ''}\nOfficial status: ${statusValue || ''}\n${customText}\n${notes.join('\n')}\n${rawSummary}`
    });
  }
  for (const document of records.filter((record) => ['documents', 'google_drive'].includes(record.source) && record.entity === 'file')) {
    bundles.push({
      inputId: document.id,
      source: document.source,
      sourceRecordId: document.id,
      title: document.fields.name,
      organization: null,
      officialStatus: null,
      customFields: {},
      notes: [],
      path: document.fields.relativePath,
      content: document.fields.content,
      rawDocument: {
        modifiedAt: document.fields.modifiedAt,
        checksum: document.fields.checksum,
        ocrRequired: document.fields.ocrRequired,
        webViewLink: document.fields.webViewLink || null
      }
    });
  }
  for (const item of records.filter((record) => record.source === 'notion' && record.entity === 'work_item')) {
    const properties = item.fields.properties || {};
    const property = (pattern) => Object.entries(properties).find(([name]) => pattern.test(name))?.[1] ?? null;
    const customFields = Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, { value }]));
    const content = [`Task: ${item.fields.title || ''}`, ...Object.entries(properties).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value ?? ''}`)].join('\n');
    bundles.push({
      inputId: item.id,
      source: 'notion',
      sourceRecordId: item.id,
      title: item.fields.title,
      organization: property(/client|account|company|org/i),
      officialStatus: property(/status|state|stage|bucket|board/i),
      customFields,
      notes: [],
      path: null,
      content
    });
  }
  return bundles;
}

export function groupFactsForBusinessTruths(facts) {
  const parent = facts.map((_, index) => index);
  const find = (value) => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const union = (a, b) => { const left = find(a), right = find(b); if (left !== right) parent[right] = left; };
  for (let i = 0; i < facts.length; i += 1) {
    for (let j = i + 1; j < facts.length; j += 1) {
      const left = facts[i], right = facts[j];
      const sameReference = normalize(left.reference) && normalize(left.reference) === normalize(right.reference);
      const sameLineage = left.lineageKey && left.lineageKey === right.lineageKey;
      const linkedReference = referencesLinked(left, right);
      const referencesCompatible = !(normalize(left.reference) && normalize(right.reference)) || linkedReference;
      const compatiblePeriod = periodsCompatible(left.period, right.period);
      const sameClientTopic = left.topic !== 'unknown' && left.topic === right.topic
        && similarity(left.client, right.client) >= 0.82
        && (linkedReference || (referencesCompatible && compatiblePeriod));
      if (sameReference || sameLineage || sameClientTopic) union(i, j);
    }
  }
  const groups = new Map();
  facts.forEach((fact, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(fact);
  });
  return [...groups.values()];
}

function chooseMostUseful(values) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return null;
  return filtered.sort((a, b) => String(b).length - String(a).length)[0];
}

function chooseTopic(group) {
  const scores = new Map();
  for (const fact of group) {
    if (!fact.topic || fact.topic === 'unknown') continue;
    scores.set(fact.topic, (scores.get(fact.topic) || 0) + fact.evidenceStrength * fact.extractionConfidence);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}

function canonicalOwners(groups) {
  const rawExplicit = distinct(groups.flatMap((group) => group.map((fact) => fact.ownerCanonical).filter(Boolean)));
  const rawFromRaw = distinct(groups.flatMap((group) => group.map((fact) => fact.ownerRaw).filter(Boolean)));
  const allCandidates = sanitizeOwnerLabels([...rawExplicit, ...rawFromRaw]);
  const completeness = (name) => {
    const words = String(name).split(/\s+/).filter(Boolean);
    return (words.length > 1 ? 2 : 0) + (normalize(words[0]).length > 2 ? 2 : 0) + String(name).length / 100;
  };
  const canonicalMap = new Map();
  const ranked = [...allCandidates].sort((a, b) => completeness(b) - completeness(a));
  for (const name of allCandidates) {
    const better = ranked.find((candidate) => completeness(candidate) >= completeness(name) && ownerSimilarity(name, candidate) >= 0.85);
    canonicalMap.set(name, better || name);
  }
  const explicit = distinct([...canonicalMap.values()]);
  const aliasMap = new Map();
  for (const group of groups) {
    const localCanonical = group.map((fact) => fact.ownerCanonical).find(Boolean);
    const localRaw = group.map((fact) => fact.ownerRaw).filter(Boolean);
    const canonical = canonicalMap.get(localCanonical) || localCanonical || localRaw[0];
    if (canonical) localRaw.forEach((alias) => aliasMap.set(normalize(alias), canonical));
  }
  for (const [name, canonical] of canonicalMap) aliasMap.set(normalize(name), canonical);
  return { explicit, aliasMap };
}

function resolveOwner(alias, ownerIndex) {
  if (!alias) return null;
  const direct = ownerIndex.aliasMap.get(normalize(alias));
  if (direct) return direct;
  let best = null, score = 0;
  for (const canonical of ownerIndex.explicit) {
    const candidate = ownerSimilarity(alias, canonical);
    if (candidate > score) { best = canonical; score = candidate; }
  }
  return score >= 0.76 ? best : alias;
}

function fuseGroup(group, ownerIndex, tenantId) {
  const topic = chooseTopic(group);
  const client = chooseMostUseful(group.map((fact) => fact.client));
  const references = distinct(group.map((fact) => fact.reference));
  const reference = references.find((value) => group.filter((fact) => normalize(fact.reference) === normalize(value)).length > 1) || references[0] || null;
  const aliases = sanitizeOwnerLabels(group.flatMap((fact) => [fact.ownerRaw, fact.ownerCanonical]));
  const owners = distinct(aliases.map((alias) => cleanOwnerLabel(resolveOwner(alias, ownerIndex)))).filter(isPlausibleOwnerLabel);
  const valid = group.filter((fact) => fact.evidenceType !== 'stale_export');
  const completedStrong = valid.filter((fact) => fact.lifecycleClaim === 'completed' && fact.evidenceStrength >= 0.75);
  const openStrong = valid.filter((fact) => fact.lifecycleClaim === 'open' && fact.evidenceStrength >= 0.7);
  const cancelledStrong = valid.filter((fact) => fact.lifecycleClaim === 'cancelled' && fact.evidenceStrength >= 0.7);
  const unverifiedClaim = valid.some((fact) => /says filed|believes.*filed|filed but|ack.*not found|no arn|no acknowledgement|not available/i.test(fact.text || ''));
  let state = 'unknown';
  let conflict = false;
  if (cancelledStrong.length && completedStrong.length) { state = 'unknown'; conflict = true; }
  else if (cancelledStrong.length) state = 'cancelled';
  else if (completedStrong.length && openStrong.length) { state = 'unknown'; conflict = true; }
  else if (completedStrong.length) state = 'completed';
  else if (openStrong.length) state = 'open';
  else if (unverifiedClaim) { state = 'unknown'; conflict = true; }
  else {
    const strongest = [...valid].sort((a, b) => b.evidenceStrength - a.evidenceStrength)[0];
    if (strongest?.evidenceStrength >= 0.58) state = strongest.lifecycleClaim;
  }
  const bestDocument = group.filter((fact) => ['documents', 'google_drive'].includes(fact.source) && fact.path && fact.evidenceType !== 'stale_export')
    .sort((a, b) => (b.evidenceStrength + (/current|latest|reallylatest/i.test(b.text || b.path) ? 0.2 : 0)) - (a.evidenceStrength + (/current|latest|reallylatest/i.test(a.text || a.path) ? 0.2 : 0)))[0];
  const evidence = group.map((fact) => ({
    factId: fact.factId,
    source: fact.source,
    sourceRecordId: fact.sourceRecordId,
    evidenceType: fact.evidenceType,
    strength: fact.evidenceStrength,
    claim: fact.lifecycleClaim,
    text: fact.text,
    path: fact.path,
    url: fact.rawEvidence?.webViewLink || null,
    lineageKey: fact.lineageKey
  }));
  const strongest = Math.max(...valid.map((fact) => fact.evidenceStrength), 0.25);
  const independentEvidence = new Set(valid.map((fact) => fact.lineageKey?.startsWith('document:') ? fact.lineageKey : fact.source));
  const multiSource = independentEvidence.size > 1;
  const confidence = clamp(strongest + (multiSource ? 0.05 : 0) - (conflict ? 0.25 : 0));
  const stableKey = reference || `${normalize(client)}:${topic}:${normalize(chooseMostUseful(group.map((fact) => fact.period)))}`;
  const truthId = crypto.createHash('sha256').update(stableKey || group.map((fact) => fact.factId).join('|')).digest('hex').slice(0, 24);
  return {
    tenantId,
    truthId,
    objectType: chooseMostUseful(group.map((fact) => fact.objectType)) || 'business_item',
    topic,
    client,
    owners,
    ownerAliases: aliases,
    state,
    period: chooseMostUseful(group.map((fact) => fact.period)),
    eventDate: group.map((fact) => fact.eventDate).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null,
    reference,
    sources: distinct(group.map((fact) => fact.source)),
    sourceRecordIds: distinct(group.map((fact) => fact.sourceRecordId)),
    evidence,
    bestPath: bestDocument?.path || null,
    bestUrl: bestDocument?.rawEvidence?.webViewLink || null,
    conflict,
    confidence,
    explanation: [
      `${group.length} source record${group.length === 1 ? '' : 's'} were linked into one business item.`,
      `State ${state} was selected from the strongest available evidence.`,
      multiSource ? 'The item has independent corroborating evidence.' : 'Only one independent evidence lineage currently supports this item.'
    ],
    compiledAt: new Date()
  };
}

function profileCustomFields(bundles, facts) {
  const pipedrive = bundles.filter((bundle) => bundle.source === 'pipedrive');
  const factById = new Map(facts.map((fact) => [fact.sourceRecordId, fact]));
  const names = distinct(pipedrive.flatMap((bundle) => Object.keys(bundle.customFields || {})));
  return names.map((name) => {
    const rows = pipedrive.map((bundle) => ({ bundle, value: bundle.customFields?.[name]?.value ?? bundle.customFields?.[name] })).filter((row) => row.value !== '' && row.value != null);
    const ratio = (predicate) => rows.length ? rows.filter(({ bundle, value }) => predicate(factById.get(bundle.sourceRecordId), value)).length / rows.length : 0;
    const ownerScore = ratio((fact, value) => normalize(fact?.ownerRaw) === normalize(value));
    const referenceScore = ratio((fact, value) => normalize(fact?.reference) === normalize(value));
    const periodScore = ratio((fact, value) => normalize(fact?.period) === normalize(value));
    const ownerFieldHintScore = fieldHintScore(name, OWNER_FIELD_HINTS);
    const boostedOwnerScore = ownerFieldHintScore > 0 ? Math.max(ownerScore, Math.min(1, ownerFieldHintScore * 0.95 + 0.05)) : ownerScore;
    const stateByValue = new Map();
    for (const { bundle, value } of rows) {
      const state = factById.get(bundle.sourceRecordId)?.lifecycleClaim || 'unknown';
      if (!stateByValue.has(String(value))) stateByValue.set(String(value), []);
      stateByValue.get(String(value)).push(state);
    }
    const repeated = [...stateByValue.values()].filter((states) => states.length >= 2);
    const repeatedRows = repeated.reduce((sum, states) => sum + states.length, 0);
    const consistentRepeatedRows = repeated.reduce((sum, states) => {
      const counts = Object.groupBy(states, (state) => state);
      return sum + Math.max(...Object.values(counts).map((items) => items.length));
    }, 0);
    const lifecycleScore = rows.length && repeatedRows
      ? (repeatedRows / rows.length) * (consistentRepeatedRows / repeatedRows)
      : 0;
    const scores = {
      owner: boostedOwnerScore,
      reference: referenceScore,
      period: periodScore,
      lifecycle_code: ownerFieldHintScore >= 0.8 ? lifecycleScore * 0.65 : lifecycleScore
    };
    const [role, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return {
      field: name,
      coverage: +(rows.length / Math.max(pipedrive.length, 1)).toFixed(2),
      samples: distinct(rows.map((row) => String(row.value))).slice(0, 8),
      proposedRole: score >= 0.45 ? role : 'unknown',
      validatedConfidence: +score.toFixed(2),
      scores
    };
  });
}

export async function compileLiveSemanticLayer(tenantId = 'acme-law') {
  const indexedRecords = repository.findRecords(tenantId).filter((record) => ['pipedrive', 'documents', 'google_drive', 'notion'].includes(record.source));
  const hasLiveDrive = indexedRecords.some((record) => record.source === 'google_drive' && record.entity === 'file');
  // The local folder mirrors Drive for offline development. Never compile both copies as independent evidence.
  const records = hasLiveDrive ? indexedRecords.filter((record) => record.source !== 'documents') : indexedRecords;
  const bundles = buildBundles(records);
  if (!bundles.length) throw Object.assign(new Error('No live source records are indexed'), { status: 422 });
  const extracted = await semanticAiService.extractFacts(bundles);
  const bundleById = new Map(bundles.map((bundle) => [bundle.inputId, bundle]));
  const facts = extracted.facts.map((fact) => {
    const bundle = bundleById.get(fact.inputId);
    const stale = /archive exports|crm_dump/i.test(bundle?.path || bundle?.title || '');
    const notionEvidence = bundle.source === 'notion';
    return {
      tenantId,
      factId: crypto.createHash('sha256').update(`${bundle.source}:${bundle.sourceRecordId}`).digest('hex').slice(0, 24),
      source: bundle.source,
      sourceRecordId: bundle.sourceRecordId,
      objectType: fact.objectType,
      topic: normalize(fact.topic) ? fact.topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : 'unknown',
      client: fact.client,
      ownerRaw: fact.ownerRaw,
      ownerCanonical: fact.ownerCanonical,
      lifecycleClaim: fact.lifecycleClaim,
      period: fact.period,
      eventDate: fact.eventDate ? new Date(`${fact.eventDate}T00:00:00Z`) : null,
      reference: fact.reference,
      lineageKey: bundle.rawDocument?.checksum ? `document:${bundle.rawDocument.checksum}` : `${bundle.source}:${bundle.sourceRecordId}`,
      evidenceType: stale ? 'stale_export' : notionEvidence ? 'work_tracker_claim' : fact.evidenceType,
      evidenceStrength: stale ? Math.min(0.2, fact.evidenceStrength) : notionEvidence ? Math.min(0.65, fact.evidenceStrength) : fact.evidenceStrength,
      path: bundle.path,
      text: fact.text,
      extractedBy: extracted.ai.provider,
      extractionConfidence: fact.confidence,
      rawEvidence: {
        title: bundle.title,
        organization: bundle.organization,
        officialStatus: bundle.officialStatus,
        customFields: bundle.customFields,
        notes: bundle.notes,
        path: bundle.path,
        checksum: bundle.rawDocument?.checksum || null,
        webViewLink: bundle.rawDocument?.webViewLink || null
      }
    };
  });
  const fieldHypotheses = profileCustomFields(bundles, facts);
  const roleField = (role, minimum) => fieldHypotheses.filter((field) => field.proposedRole === role && field.validatedConfidence >= minimum).sort((a, b) => b.validatedConfidence - a.validatedConfidence)[0]?.field;
  const ownerField = roleField('owner', 0.6);
  const referenceField = roleField('reference', 0.7);
  const periodField = roleField('period', 0.7);
  console.log('[DEBUG] Field hypotheses:', JSON.stringify(fieldHypotheses, null, 2));
  for (const fact of facts) {
    const custom = fact.rawEvidence?.customFields || {};
    const observed = (field) => custom?.[field]?.value ?? custom?.[field] ?? null;
    if (ownerField && observed(ownerField)) fact.ownerRaw = String(observed(ownerField));
    if (referenceField && observed(referenceField)) fact.reference = String(observed(referenceField));
    if (periodField && observed(periodField)) fact.period = String(observed(periodField));
    const evidenceText = `${fact.text || ''} ${(fact.rawEvidence?.notes || []).join(' ')} ${fact.rawEvidence?.title || ''}`.toLowerCase();
    if (/duplicate from old|same as first|do not use|don't use/.test(evidenceText)) {
      fact.lifecycleClaim = 'unknown'; fact.evidenceType = 'duplicate_record'; fact.evidenceStrength = 0.1;
    } else if (/(confirmed|received|accepted|successful|completed|resolved|submitted)/.test(evidenceText) && !/(not|no|missing|pending|waiting|in progress|draft)/.test(evidenceText)) {
      fact.lifecycleClaim = 'completed'; fact.evidenceStrength = Math.max(fact.evidenceStrength, 0.85);
    }
    if (/(says|believes|team says).*(not found|missing|unclear|conflicting)|but.*(not found|missing|unclear|conflicting)|not available/.test(evidenceText)) {
      fact.lifecycleClaim = 'unknown'; fact.evidenceType = 'unverified_completion_claim'; fact.evidenceStrength = Math.min(fact.evidenceStrength, 0.65);
    }
  }
  const groups = groupFactsForBusinessTruths(facts);
  const ownerIndex = canonicalOwners(groups);
  const truths = groups.map((group) => fuseGroup(group, ownerIndex, tenantId));

  await Promise.all([
    SemanticFactModel.deleteMany({ tenantId }),
    BusinessTruthModel.deleteMany({ tenantId })
  ]);
  if (facts.length) await SemanticFactModel.insertMany(facts);
  if (truths.length) await BusinessTruthModel.insertMany(truths);

  const peopleEntries = ownerIndex.explicit.map((person) => {
    const cleanPersonName = cleanOwnerLabel(person);
    const ownerAliases = sanitizeOwnerLabels(truths.filter((truth) => truth.owners.includes(cleanPersonName)).flatMap((truth) => truth.ownerAliases));
    const uniquePeople = distinct([...ownerAliases, cleanPersonName].filter(Boolean));
    return [cleanPersonName, uniquePeople];
  });
  const glossary = {
    topics: distinct(truths.map((truth) => truth.topic)),
    people: Object.fromEntries(peopleEntries),
    clients: distinct(truths.map((truth) => truth.client))
  };
  const sourceProfiles = {
    pipedrive: { deals: bundles.filter((bundle) => bundle.source === 'pipedrive').length, customFields: fieldHypotheses },
    documents: { files: bundles.filter((bundle) => bundle.source === 'documents').length, ocrRequired: records.filter((record) => record.source === 'documents' && record.fields.ocrRequired).length },
    googleDrive: { files: bundles.filter((bundle) => bundle.source === 'google_drive').length, ocrRequired: records.filter((record) => record.source === 'google_drive' && record.fields.ocrRequired).length, authoritative: hasLiveDrive },
    notion: { workItems: bundles.filter((bundle) => bundle.source === 'notion').length }
  };
  const previous = await SemanticMapModel.findOne({ tenantId }).lean();
  const semanticMap = await SemanticMapModel.findOneAndUpdate(
    { tenantId },
    {
      $set: {
        version: (previous?.version || 0) + 1,
        status: 'compiled',
        sourceProfiles,
        glossary,
        fieldHypotheses,
        warnings: [
          'Official CRM owner is shared and should not be treated as the actual handler.',
          'Official CRM lifecycle can be stale; documentary evidence is weighted more strongly.',
          'A stale CRM export exists in the document source and is excluded from independent counts.',
          hasLiveDrive
            ? 'Google Drive is the authoritative document source; its local mirror is excluded to prevent duplicate evidence.'
            : 'The local evidence folder is an offline fallback until Google Drive is synced.'
        ],
        stats: { bundles: bundles.length, facts: facts.length, truths: truths.length, conflicts: truths.filter((truth) => truth.conflict).length, unknown: truths.filter((truth) => truth.state === 'unknown').length },
        ai: extracted.ai,
        compiledAt: new Date()
      }
    },
    { upsert: true, new: true }
  ).lean();
  return semanticMap;
}
