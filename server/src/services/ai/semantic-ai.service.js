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

function fallbackFact(bundle) {
  const content = cleanText(bundle.content || JSON.stringify(bundle)).toLowerCase();
  const custom = bundle.customFields || {};
  let topic = 'unknown';
  if (/\bgst|gstr|3b\b/.test(content)) topic = 'gst_filing';
  else if (/\btds\b|26q|challan/.test(content)) topic = 'tds_return';
  else if (/\bcfa\b|corporate filing|\bmca\b|\bsrn\b/.test(content)) topic = 'corporate_filing_application';
  else if (/inventory|stock register|stock jul/.test(content)) topic = 'inventory_register';
  else if (/agreement|contract|redline/.test(content)) topic = 'contract';
  else if (/income tax|\bitr\b|tax return|return submission|e-filing/.test(content)) topic = 'income_tax_filing';

  let lifecycleClaim = 'unknown';
  if (/cancelled|canceled|client said stop|stop the|no filing|no return should/.test(content)) lifecycleClaim = 'cancelled';
  else if (/draft|not submitted|otp pending|missing|not ready|do not submit|remains open|pending/.test(content)) lifecycleClaim = 'open';
  else if (/successfully|acknowledgement|submission receipt|arn .*(received|confirmed)|srn received|status: filed|upload ok|status: accepted|signed by both|current stock register/.test(content)) lifecycleClaim = 'completed';

  const documentary = ['documents', 'google_drive'].includes(bundle.source);
  let evidenceType = documentary ? 'document' : bundle.source === 'notion' ? 'work_tracker_claim' : 'crm_record';
  let evidenceStrength = documentary ? 0.72 : bundle.source === 'notion' ? 0.48 : 0.35;
  if (/acknowledgement|submission receipt|e-filing receipt|upload confirmation|service request receipt/.test(content)) { evidenceType = 'official_receipt'; evidenceStrength = 0.97; }
  if (/draft|not submitted|otp pending|missing|do not submit/.test(content)) { evidenceType = 'negative_documentary_evidence'; evidenceStrength = documentary ? 0.95 : 0.72; }
  if (/cancelled|client said stop/.test(content)) { evidenceType = 'cancellation_instruction'; evidenceStrength = 0.96; }
  if (bundle.source === 'pipedrive' && bundle.notes?.length) { evidenceType = 'crm_note'; evidenceStrength = Math.max(evidenceStrength, 0.58); }

  const ownerRaw = valueOf(custom, 'Legacy') || match(bundle.content, /(?:prepared by|filed by|handled by|submitted by|uploaded by|reviewed by):\s*([^\n,;]+)/i);
  const explicitOwner = match(bundle.content, /(?:prepared by|filed by|handled by|submitted by|uploaded by):\s*([A-Za-z. ]+)/i);
  const reference = valueOf(custom, 'Ref')
    || match(bundle.content, /(?:reference|acknowledgement|arn|srn|token):\s*([A-Za-z0-9-]+)/i);
  const period = valueOf(custom, 'Cycle')
    || match(bundle.content, /(?:period|quarter|assessment year|tax period):\s*([^\n,;]+)/i);
  const client = bundle.organization
    || match(bundle.content, /(?:legal name|client|taxpayer|entity|party|deductor):\s*([^\n,;]+)/i);
  const dateRaw = match(bundle.content, /(?:submitted|filed|updated|execution date):\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i);
  let eventDate = null;
  if (dateRaw) {
    const parsed = new Date(dateRaw);
    if (!Number.isNaN(parsed.getTime())) eventDate = parsed.toISOString().slice(0, 10);
  }
  return Fact.parse({
    inputId: bundle.inputId,
    objectType: topic === 'inventory_register' ? 'file_register' : topic === 'contract' ? 'contract' : 'filing_or_matter',
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
Use snake_case topic names which describe the actual work, for example income_tax_filing, gst_filing, tds_return, corporate_filing_application, contract, inventory_register. You may create other topic names when evidence requires them.
Official CRM statuses can be stale. Explicit notes and document contents override filenames and official status claims.
lifecycleClaim must be completed, open, cancelled, or unknown. A draft/final filename alone is not completion. Acknowledgement, ARN/SRN, accepted token, or explicit successful submission is strong evidence. Negations such as NOT SUBMITTED and OTP pending are strong open evidence.
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
