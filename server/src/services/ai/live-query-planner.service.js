import { z } from 'zod';

const Plan = z.object({
  operation: z.enum(['count', 'list', 'locate', 'status', 'verify', 'summarize']),
  scope: z.enum(['crm_deals', 'filings', 'files', 'business_items']).default('business_items'),
  topic: z.string().nullable().default(null),
  person: z.string().nullable().default(null),
  client: z.string().nullable().default(null),
  state: z.enum(['completed', 'open', 'cancelled', 'unknown']).nullable().default(null),
  timeRange: z.string().default('all'),
  expandedTerms: z.array(z.string()).default([]),
  supportedByTenant: z.boolean().default(true),
  requiresClarification: z.boolean().default(false),
  clarification: z.string().nullable().default(null)
});

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const crmEntityTerms = ['deal', 'deals', 'lead', 'leads', 'opportunity', 'opportunities', 'prospect', 'prospects', 'pipeline', 'pipelines', 'organization', 'organizations', 'org', 'orgs', 'stage', 'stages', 'owner', 'owners', 'contact', 'contacts', 'account', 'accounts', 'client', 'clients', 'customer', 'customers', 'company', 'companies', 'business', 'businesses'];
const crmTermRegex = new RegExp(`\\b(?:${crmEntityTerms.join('|')})\\b`);
const broadBusinessQuery = /\b(?:how many|how much|how many of|what is the|what are the|what are|total|overall|count|number of|show me|list|give me|all of|any of|where is|where are|status of|how many have|how many were|how many are)\b/;

function normalizeMonth(value) {
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', july: '07', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
  };
  const key = String(value || '').trim().toLowerCase().slice(0, 3);
  return monthMap[key] || null;
}

function extractTimeRange(question) {
  const q = question.toLowerCase();
  if (/(?:last month|pichle mahine|pichhle mahine)/.test(q)) return 'last_month';
  if (/(?:this month|is mahine|aaj ke mahine)/.test(q)) return 'this_month';
  if (/(?:this year|is saal|is varsh)/.test(q)) return String(new Date().getUTCFullYear());
  if (/(?:last year|pichla saal|pichhle saal)/.test(q)) return String(new Date().getUTCFullYear() - 1);

  const monthMatch = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s+(\d{2,4}|this year|last year))?/);
  if (monthMatch) {
    const month = normalizeMonth(monthMatch[1]);
    let year = monthMatch[2];
    if (year === 'this year') year = String(new Date().getUTCFullYear());
    if (year === 'last year') year = String(new Date().getUTCFullYear() - 1);
    if (year && /^\d{2}$/.test(year)) year = `20${year}`;
    if (month && year && /^\d{4}$/.test(year)) return `${year}-${month}`;
  }

  const yearMatch = q.match(/\b(20\d{2})\b/);
  if (yearMatch) return yearMatch[1];
  return 'all';
}

function broadlyScopedQuestion(question, plan) {
  const q = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (plan.scope === 'crm_deals') return broadBusinessQuery.test(q) && crmTermRegex.test(q);
  if (plan.scope === 'filings') return /\b(?:how many|how much|list|show|all|total|overall)\b.*\b(?:filings?|returns?|applications?)\b/.test(q)
    || /\b(?:all|total|overall)\s+(?:filings?|returns?|applications?)\b/.test(q);
  if (plan.scope === 'business_items') return broadBusinessQuery.test(q) && crmTermRegex.test(q)
    || /\b(?:all|total|overall)\b.*\b(?:work|matters?|cases?|business items?|records?|tasks?)\b/.test(q);
  return false;
}

function enoughBroadTenantSignal(question, plan) {
  const q = question.toLowerCase();
  const countWords = broadBusinessQuery.test(q);
  const orgWords = crmTermRegex.test(q);
  return countWords && orgWords && ['crm_deals','business_items'].includes(plan.scope);
}

export function guardPlanForTenant(question, inputPlan, glossary = {}) {
  const plan = Plan.parse(inputPlan);
  const topics = (glossary.topics || []).map(normalize);
  const people = Object.entries(glossary.people || {}).flatMap(([person, aliases]) => [person, ...(aliases || [])]).map(normalize);
  const clients = (glossary.clients || []).map(normalize);
  const mappedTopic = plan.topic && topics.includes(normalize(plan.topic));
  const mappedPerson = plan.person && people.some((person) => person === normalize(plan.person));
  const mappedClient = plan.client && clients.some((client) => client === normalize(plan.client));
  const suppliedUnknownEntity = (plan.topic && !mappedTopic) || (plan.person && !mappedPerson) || (plan.client && !mappedClient);
  const broadPipedriveQuestion = broadlyScopedQuestion(question, plan);
  const broadOrgSignal = enoughBroadTenantSignal(question, plan);
  const supported = plan.supportedByTenant !== false
    && !suppliedUnknownEntity
    && Boolean(mappedTopic || mappedPerson || mappedClient || broadPipedriveQuestion || broadOrgSignal);
  if (supported || plan.requiresClarification) return plan;
  return {
    ...plan,
    supportedByTenant: false,
    requiresClarification: true,
    clarification: 'This question does not map to the connected business data. Please ask about a known client, person, filing, deal, document, or learned business topic.'
  };
}

function fallbackPlan(question, glossary = {}) {
  const q = question.toLowerCase();
  const operation = /\bwhere|kidhar|location|locate\b/.test(q) ? 'locate'
    : /\bwhich|list|show|dikhao\b/.test(q) ? 'list'
      : /\bstatus|what.*happening|chal raha\b/.test(q) ? 'status'
        : /\bwas|is|did|verify\b/.test(q) ? 'verify'
          : /\bsummary|summarize\b/.test(q) ? 'summarize' : 'count';
  const scope = /\b(?:deal|deals|lead|leads|opportunity|opportunities|prospect|prospects|pipeline|pipelines|organization|organizations|org|orgs|stage|stages|owner|owners|contact|contacts|account|accounts|client|clients|customer|customers|company|companies|business|businesses)\b/.test(q) ? 'crm_deals' : /\bfile|document|pdf\b/.test(q) && operation === 'locate' ? 'files' : /fil|return|itr|gst|tds|cfa|application/.test(q) ? 'filings' : 'business_items';
  const topicPatterns = [
    ['income_tax_filing', /income tax|\bitr\b|it return/],
    ['gst_filing', /\bgst\b|gstr|3b/],
    ['tds_return', /\btds\b|26q/],
    ['corporate_filing_application', /\bcfa\b|corporate filing|\bmca\b/],
    ['inventory_register', /inventory|stock/],
    ['contract', /contract|agreement/]
  ];
  const topic = topicPatterns.find(([, pattern]) => pattern.test(q))?.[0]
    || glossary.topics?.find((item) => q.includes(String(item).replaceAll('_', ' '))) || null;
  const state = /open|pending|in progress|chal raha/.test(q) ? 'open'
    : /cancel|lost|stopped/.test(q) ? 'cancelled'
      : /complete|filed|filled|done|closed|submit/.test(q) ? 'completed' : null;
  const normalizedQuestion = normalize(q);
  const people = Object.entries(glossary.people || {});
  const person = people.find(([candidate, variants]) => [candidate, ...(variants || [])].some((variant) => {
    const value = normalize(variant);
    return value.length >= 2 && normalizedQuestion.includes(value);
  }))?.[0] || people.find(([candidate]) => normalizedQuestion.includes(normalize(candidate).slice(0, 5)))?.[0] || null;
  const clients = glossary.clients || [];
  const client = clients.find((candidate) => normalize(q).includes(normalize(candidate))) || null;
  return Plan.parse({
    operation,
    scope,
    topic,
    person,
    client,
    state,
    timeRange: extractTimeRange(q),
    expandedTerms: topic ? [topic, topic.replaceAll('_', ' ')] : [],
    supportedByTenant: true,
    requiresClarification: false,
    clarification: null
  });
}

export class LiveQueryPlannerService {
  async plan(question, semanticMap) {
    const glossary = semanticMap?.glossary || {};
    if (!process.env.GEMINI_API_KEY) return { plan: guardPlanForTenant(question, fallbackPlan(question, glossary), glossary), aiCalls: 0, provider: 'deterministic' };
    try {
      const plan = guardPlanForTenant(question, await this.#gemini(question, semanticMap), glossary);
      return { plan, aiCalls: 1, provider: 'gemini' };
    } catch {
      return { plan: guardPlanForTenant(question, fallbackPlan(question, glossary), glossary), aiCalls: 0, provider: 'deterministic-fallback' };
    }
  }

  async #gemini(question, semanticMap) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const glossary = semanticMap?.glossary || {};
    const prompt = `Plan a deterministic query over a tenant-specific semantic business layer. Return JSON only and never answer the question.
Allowed operation: count,list,locate,status,verify,summarize.
Allowed scope: crm_deals,filings,files,business_items.
Allowed state: completed,open,cancelled,unknown or null.
Allowed timeRange: all,last_month,this_month,this_year,last_year,YYYY,YYYY-MM.
Map user terminology to one available topic when supported by the glossary. Use expandedTerms for synonyms and abbreviations. "Filed/filled/done/submitted" means completed. "Open/pending/chal raha" means open.
If a term is genuinely ambiguous (for example closed could include completed and cancelled), set requiresClarification and provide one short clarification. Do not invent a client or person.
Set supportedByTenant=false and requiresClarification=true when the question is unrelated to the connected business data or its subject cannot be mapped to the tenant glossary. Never map an unrelated general-knowledge question to business_items.
Tenant glossary: ${JSON.stringify({ topics: glossary.topics || [], people: glossary.people || {}, clients: glossary.clients || [] })}
Question: ${JSON.stringify(question)}
Return fields: operation,scope,topic,person,client,state,timeRange,expandedTerms,supportedByTenant,requiresClarification,clarification.`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 700 } }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const json = await response.json();
    return Plan.parse(JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
  }
}

export const liveQueryPlannerService = new LiveQueryPlannerService();
