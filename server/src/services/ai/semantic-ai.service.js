import { z } from 'zod';

const Fact = z.object({
  inputId: z.string(),
  objectType: z.string().default('business_item'),
  topic: z.string().default('unknown'),
  client: z.string().nullable().default(null),
  ownerRaw: z.string().nullable().default(null),
  ownerCanonical: z.string().nullable().default(null),
  lifecycleClaim: z.enum(['completed', 'open', 'cancelled', 'unknown']).default('unknown'),
  period: z.string().nullable().default(null),
  eventDate: z.string().nullable().default(null),
  reference: z.string().nullable().default(null),
  evidenceType: z.string().default('unstructured_claim'),
  evidenceStrength: z.number().min(0).max(1).default(0.3),
  text: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.5)
});

const FactList = z.array(Fact);

const cleanText = (value) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const valueOf = (customFields, name) => customFields?.[name]?.value ?? customFields?.[name] ?? null;

function match(text, pattern) {
  return cleanText(text).match(pattern)?.[1]?.trim() || null;
}

function slugifyTopic(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'business_record';
}

function inferGenericTopic(bundle) {
  const title = cleanText(bundle.title || '');
  const content = cleanText(bundle.content || '');
  const textSources = [title, content, ...Object.keys(bundle.customFields || {}).map((key) => String(key))].filter(Boolean);
  const customNames = Object.keys(bundle.customFields || {}).filter(Boolean).map((name) => String(name));
  const titleCandidate = title && !/^(record|item|entry|business|matter|task)$/i.test(title) ? title : null;
  const distinctiveCustom = customNames.find((name) => !/id|status|name|date|created|updated|owner|amount|value|note|description|details|summary/i.test(name))
    || customNames.find((name) => !/id|status|name|date|created|updated|owner|amount|value|note|description|details|summary/i.test(name) && name.length >= 3);
  const textCandidate = textSources.find((value) => value.length >= 3 && !/^(the|and|for|with|from|to|of|in|on|is|are|a|an|business|record|item|entry|task)$/i.test(value));
  const candidate = titleCandidate || distinctiveCustom || textCandidate || cleanText(bundle.title || bundle.content || 'business_record');
  return slugifyTopic(candidate || (bundle.source ? `${bundle.source}_record` : 'business_record'));
}

function fallbackFact(bundle) {
  const content = cleanText(bundle.content || JSON.stringify(bundle)).toLowerCase();
  const custom = bundle.customFields || {};
  const inferredTopic = inferGenericTopic(bundle);
  const topic = inferredTopic || 'unknown';

  let lifecycleClaim = 'unknown';
  if (/cancelled|canceled|stopped|withdrawn|no longer|not proceeding/.test(content)) lifecycleClaim = 'cancelled';
  else if (/draft|not submitted|pending|waiting|not yet|in progress|in_progress|remains open|open|ongoing/.test(content)) lifecycleClaim = 'open';
  else if (/done|completed|finished|closed|confirmed|received|submitted|successful|accepted|resolved/.test(content)) lifecycleClaim = 'completed';

  const documentary = ['documents', 'google_drive'].includes(bundle.source);
  let evidenceType = documentary ? 'document' : bundle.source === 'notion' ? 'work_tracker_claim' : 'crm_record';
  let evidenceStrength = documentary ? 0.72 : bundle.source === 'notion' ? 0.48 : 0.35;
  if (/confirmation|receipt|accepted|successfully/.test(content)) { evidenceType = 'official_receipt'; evidenceStrength = 0.97; }
  if (/draft|not submitted|pending|waiting|not yet|do not submit/.test(content)) { evidenceType = 'negative_documentary_evidence'; evidenceStrength = documentary ? 0.95 : 0.72; }
  if (/cancelled|stopped|withdrawn/.test(content)) { evidenceType = 'cancellation_instruction'; evidenceStrength = 0.96; }
  if (bundle.source === 'pipedrive' && bundle.notes?.length) { evidenceType = 'crm_note'; evidenceStrength = Math.max(evidenceStrength, 0.58); }

   const ownerRaw = valueOf(custom, 'Legacy')
      || match(bundle.content, /(?:assigned to|owned by|handled by|responsible:|prepared by|filed by|submitted by|uploaded by|reviewed by|by)\s+([A-Z][A-Za-z]+ (?:[A-Za-z ]+)?)\s+(?:ARN:|Status:|for|and|acknowledged\s+by\s+prepared|prepared\s+by)/i)
      || match(bundle.content, /(?:assigned to|owned by|handled by|responsible:|prepared by|filed by|submitted by|uploaded by)\s+([A-Za-z.]+?)\s*(?:ARN:|Status:|for|and)/i)
      || match(bundle.content, /(?:for)\s+([A-Z][A-Za-z]+ (?:[A-Za-z ]+)?)/i);
    const explicitOwner = match(bundle.content, /(?:assigned to|owned by|responsible:|prepared by|filed by|handled by|submitted by|uploaded by)\s+([A-Z][a-z]+ (?:[A-Za-z]{2,20}(?: [A-Za-z]{2,20})?)?)\s*(?:ARN:|Status:|for|and|and\s+the|\s+and|;|\s+\d+)/i);
  const reference = valueOf(custom, 'Ref')
    || match(bundle.content, /(?:reference|token|id|number|case no|case number):\s*([A-Za-z0-9-]+)/i);
  const period = valueOf(custom, 'Cycle')
    || match(bundle.content, /(?:period|quarter|semester|term|month|year|cycle):\s*([^\n,;]+)/i);
  const client = bundle.organization
    || match(bundle.content, /(?:for|client|customer|organization|party|student|member|applicant|account)\s*[:\-]?\s*([^\n,;]+)/i);
  const dateRaw = match(bundle.content, /(?:submitted|filed|updated|execution date):\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i);
  let eventDate = null;
  if (dateRaw) {
    const parsed = new Date(dateRaw);
    if (!Number.isNaN(parsed.getTime())) eventDate = parsed.toISOString().slice(0, 10);
  }
  const objectType = topic === 'unknown' ? 'business_item' : `record_${topic}`;
  return Fact.parse({
    inputId: bundle.inputId,
    objectType,
    topic,
    client,
    ownerRaw,
    ownerCanonical: explicitOwner && explicitOwner.includes(' ') ? explicitOwner : null,
    lifecycleClaim,
    period,
    eventDate,
    reference,
    evidenceType,
    evidenceStrength,
    text: cleanText(bundle.content || bundle.notes?.join(' ') || bundle.title).slice(0, 420),
    confidence: topic === 'unknown' ? 0.35 : 0.72
  });
}

export class SemanticAiService {
  async extractFacts(bundles) {
    const facts = [];
    let aiCalls = 0;
    let fallbackBatches = 0;
    for (let index = 0; index < bundles.length; index += 8) {
      const batch = bundles.slice(index, index + 8);
      if (!process.env.GEMINI_API_KEY) {
        facts.push(...batch.map(fallbackFact));
        fallbackBatches += 1;
        continue;
      }
      try {
        const result = await this.#geminiFacts(batch);
        const byId = new Map(result.map((fact) => [fact.inputId, fact]));
        facts.push(...batch.map((bundle) => byId.get(bundle.inputId) || fallbackFact(bundle)));
        aiCalls += 1;
      } catch {
        facts.push(...batch.map(fallbackFact));
        fallbackBatches += 1;
      }
    }
    return { facts, ai: { provider: process.env.GEMINI_API_KEY ? 'gemini-with-fallback' : 'deterministic', aiCalls, fallbackBatches } };
  }

  async #geminiFacts(batch) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const inputs = batch.map((bundle) => ({
      inputId: bundle.inputId,
      source: bundle.source,
      title: bundle.title,
      organization: bundle.organization,
      officialStatus: bundle.officialStatus,
      customFields: bundle.customFields,
      notes: bundle.notes,
      path: bundle.path,
      content: cleanText(bundle.content).slice(0, 1800)
    }));
    const prompt = `You extract source-grounded business facts for a client-specific semantic layer.
Return a JSON array with exactly one object per inputId. Never calculate counts and never invent missing data.
Use snake_case topic names which describe the actual work, for example student_enrollment, course_fee, support_ticket, contract, inventory_record, or any other topic that fits the evidence. You may create other topic names when evidence requires them.
Official CRM statuses can be stale. Explicit notes and document contents override filenames and official status claims.
lifecycleClaim must be completed, open, cancelled, or unknown. A draft/final filename alone is not completion. Clear completion language such as done, completed, confirmed, received, accepted, or successful submission is strong evidence. Negations such as not submitted, pending, waiting, or in progress are strong open evidence.
ownerRaw preserves the exact alias/code. ownerCanonical is non-null only when a real full name is explicit. eventDate is YYYY-MM-DD or null. evidenceStrength is 0..1.
Every output object must contain: inputId, objectType, topic, client, ownerRaw, ownerCanonical, lifecycleClaim, period, eventDate, reference, evidenceType, evidenceStrength, text, confidence.
Inputs: ${JSON.stringify(inputs)}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 4000 } }),
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    return FactList.parse(JSON.parse(text));
  }
}

export const semanticAiService = new SemanticAiService();
