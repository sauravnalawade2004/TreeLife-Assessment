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
  negated: z.boolean().default(false),
  negatedTopic: z.boolean().default(false),
  negatedPerson: z.boolean().default(false),
  negatedClient: z.boolean().default(false),
  negatedState: z.boolean().default(false),
  groupByClient: z.boolean().default(false),
  requireNoMatchingInGroup: z.boolean().default(false),
  unsupportedFeature: z.enum(['negation', 'ranking']).nullable().default(null),
  supportedByTenant: z.boolean().default(true),
  requiresClarification: z.boolean().default(false),
  clarification: z.string().nullable().default(null)
});

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const crmEntityTerms = ['deal', 'deals', 'lead', 'leads', 'opportunity', 'opportunities', 'prospect', 'prospects', 'pipeline', 'pipelines', 'organization', 'organizations', 'org', 'orgs', 'stage', 'stages', 'owner', 'owners', 'contact', 'contacts', 'account', 'accounts', 'client', 'clients', 'customer', 'customers', 'company', 'companies', 'business', 'businesses', 'record', 'records', 'item', 'items', 'entry', 'entries', 'member', 'members', 'case', 'cases', 'application', 'applications', 'student', 'students', 'enrollment', 'enrollments'];
const crmTermRegex = new RegExp(`\\b(?:${crmEntityTerms.join('|')})\\b`);
const broadBusinessQuery = /\b(?:how many|how much|how many of|what is the|what are the|what are|total|overall|count|number of|show me|list|give me|all of|any of|where is|where are|status of|how many have|how many were|how many are)\b/;

function normalizeQuestionText(question) {
  return String(question || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isExistentialQuestion(q) {
  return /\b(?:is there|are there|there is|there are)\b/.test(q);
}

function isAggregationQuestion(q) {
  if (/\b(?:how many|how much|number of|count of|give me the count)\b/.test(q)) return true;
  if (/\bwhat(?:'s| is) the (?:total|count|number)\b/.test(q)) return true;
  if (/\b(?:total|overall)\s+(?:number\s+of|count\s+of)?\b/.test(q)) return true;
  if (/\b(?:total|overall|count)\b/.test(q) && !/\b(?:status|verify|was|did)\b/.test(q)) return true;
  return false;
}

function isVerificationQuestion(q) {
  if (isExistentialQuestion(q) || isAggregationQuestion(q)) return false;
  if (/\b(?:was|did|verify)\b/.test(q)) return true;
  return /\bis\b/.test(q) && /\b(?:filed|file|done|complete|closed|open|verified|submitted|paid|sent|cancelled|canceled|lost|won)\b/.test(q);
}

function inferOperationFromQuestion(question) {
  const q = normalizeQuestionText(question);
  if (isAggregationQuestion(q)) return 'count';
  if (/\bwhere|kidhar|location|locate\b/.test(q)) return 'locate';
  if (/\bwhich|list|show|dikhao\b/.test(q)) return 'list';
  if (/\bstatus|what.*happening|chal raha\b/.test(q)) return 'status';
  if (/\bsummary|summarize\b/.test(q)) return 'summarize';
  if (isVerificationQuestion(q)) return 'verify';
  return 'count';
}

function reconcileOperation(question, proposedOperation) {
  const inferred = inferOperationFromQuestion(question);
  if (inferred === 'count' && ['verify', 'status'].includes(proposedOperation)) return 'count';
  return proposedOperation || inferred;
}

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

function isGenericCrmQuestion(question) {
  const q = String(question || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!crmTermRegex.test(q)) return false;
  const genericTokens = q.replace(/\b(?:deal|deals|lead|leads|opportunity|opportunities|prospect|prospects|pipeline|pipelines|organization|organizations|org|orgs|stage|stages|owner|owners|contact|contacts|account|accounts|client|clients|customer|customers|company|companies|business|businesses)\b/g, '')
    .replace(/\b(?:how many|how much|how many of|what is the|what are the|what are|total|overall|count|number of|show me|list|give me|all of|any of|where is|where are|status of|how many have|how many were|how many are)\b/g, '')
    .split(/\s+/).filter(Boolean);
  if (!genericTokens.length) return true;
  const allowedGeneric = new Set(['how','many','much','of','the','a','an','and','or','in','our','we','you','are','is','there','what','show','list','give','me','total','overall','count','all','for','have','has','to','on','by','with','status','where','are','how','many','were','have','been','current','open','closed','pending','completed','active']);
  return genericTokens.every((token) => allowedGeneric.has(token));
}

function broadlyScopedQuestion(question, plan) {
  const q = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (plan.scope === 'crm_deals') return broadBusinessQuery.test(q) && isGenericCrmQuestion(question);
  if (plan.scope === 'filings') return /\b(?:how many|how much|list|show|all|total|overall)\b.*\b(?:filings?|returns?|applications?)\b/.test(q)
    || /\b(?:all|total|overall)\s+(?:filings?|returns?|applications?)\b/.test(q);
  if (plan.scope === 'business_items') return broadBusinessQuery.test(q) && isGenericCrmQuestion(question)
    || /\b(?:all|total|overall)\b.*\b(?:work|matters?|cases?|business items?|records?|tasks?)\b/.test(q);
  return false;
}

function enoughBroadTenantSignal(question, plan) {
  const q = question.toLowerCase();
  const countWords = broadBusinessQuery.test(q);
  const orgWords = crmTermRegex.test(q);
  return countWords && orgWords && ['crm_deals','business_items'].includes(plan.scope) && isGenericCrmQuestion(question);
}

function topicMatchesQuestion(question, topic) {
  const qTokens = new Set(String(question || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean));
  const tTokens = String(topic || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!qTokens.size || !tTokens.length) return false;
  const normalizedQ = new Set([...qTokens].map((token) => token.replace(/s$/u, '')));
  return tTokens.some((token) => {
    const stem = token.replace(/s$/u, '');
    return qTokens.has(token) || qTokens.has(stem) || normalizedQ.has(stem) || normalizedQ.has(token);
  });
}

const genericTopicTerms = new Set([
  ...crmEntityTerms.map((term) => term.replace(/s$/u, '')),
  'transaction', 'filing', 'return', 'application', 'work', 'matter', 'task'
]);

function hasExplicitTopicSubject(question, topic) {
  const questionTerms = new Set(String(question || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean).map((term) => term.replace(/s$/u, '')));
  const topicSubjects = String(topic || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((term) => term.replace(/s$/u, ''))
    .filter((term) => !genericTopicTerms.has(term));
  return topicSubjects.some((term) => questionTerms.has(term));
}

function removeImplicitGenericCrmTopic(question, plan) {
  const asksAboutDeals = /\b(?:deal|deals|lead|leads|opportunity|opportunities|prospect|prospects|pipeline|pipelines)\b/i.test(question);
  if (plan.scope !== 'crm_deals' || !asksAboutDeals || !plan.topic || hasExplicitTopicSubject(question, plan.topic)) return plan;
  // "deals" describes the search scope, not a tenant-specific topic such as
  // transaction_deals. Keep every CRM deal eligible unless a subject is named.
  return { ...plan, topic: null, expandedTerms: [] };
}

function hasRankingKeyword(question) {
  return /\b(?:most|least|highest|top)\b/.test(normalizeQuestionText(question));
}

function unsupportedFeaturePlan(question, glossary, feature) {
  const fallback = fallbackPlan(question, glossary);
  const description = feature === 'negation' ? 'negation or exclusion' : 'ranking or superlative comparison';
  return Plan.parse({
    ...fallback,
    topic: null,
    person: null,
    client: null,
    state: null,
    expandedTerms: [],
    negated: false,
    negatedTopic: false,
    negatedPerson: false,
    negatedClient: false,
    negatedState: false,
    groupByClient: false,
    requireNoMatchingInGroup: false,
    unsupportedFeature: feature,
    requiresClarification: true,
    clarification: `Questions requiring ${description} are not supported yet. Please rephrase without that constraint.`
  });
}

export function guardPlanForTenant(question, inputPlan, glossary = {}) {
  const plan = removeImplicitGenericCrmTopic(question, Plan.parse(inputPlan));
  const topics = (glossary.topics || []).map(normalize);
  const people = Object.entries(glossary.people || {}).flatMap(([person, aliases]) => [person, ...(aliases || [])]).map(normalize);
  const clients = (glossary.clients || []).map(normalize);
  const mappedTopic = Boolean(plan.topic && topics.includes(normalize(plan.topic)))
    || Boolean(plan.topic && topics.some((topic) => topicMatchesQuestion(String(plan.topic), topic)))
    || Boolean(topics.some((topic) => topicMatchesQuestion(question, topic)));
  const mappedPerson = plan.person && people.some((person) => person === normalize(plan.person));
  const mappedClient = plan.client && clients.some((client) => client === normalize(plan.client));
  const suppliedUnknownEntity = (plan.topic && !mappedTopic) || (plan.person && !mappedPerson) || (plan.client && !mappedClient);
  const broadPipedriveQuestion = broadlyScopedQuestion(question, plan);
  const broadOrgSignal = enoughBroadTenantSignal(question, plan);
  const genericCrmQuery = (plan.scope === 'crm_deals' || plan.scope === 'business_items') && crmTermRegex.test(question.toLowerCase());
  const supported = plan.supportedByTenant !== false
    && !suppliedUnknownEntity
    && Boolean(mappedTopic || mappedPerson || mappedClient || broadPipedriveQuestion || broadOrgSignal || genericCrmQuery);
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
  const operation = inferOperationFromQuestion(question);
  const scope = /\b(?:deal|deals|lead|leads|opportunity|opportunities|prospect|prospects|pipeline|pipelines|organization|organizations|org|orgs|stage|stages|owner|owners|contact|contacts|account|accounts|client|clients|customer|customers|company|companies|business|businesses)\b/.test(q) ? 'crm_deals' : /\bfile|document|pdf\b/.test(q) && operation === 'locate' ? 'files' : /\b(?:fil|return|itr|gst|tds|cfa|application|student|students|enrollment|enrollments|course|courses|fee|fees|semester|member|case)\b/.test(q) ? 'filings' : 'business_items';
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
  const negationActive = /(?:^|\s)(?:not|without|excluding|except|never|nobody|none|besides|zero)\b|\bno\s|isn'?t|aren'?t|don'?t|doesn'?t|won'?t|wouldn'?t|shouldn'?t|couldn'?t|hasn'?t|haven'?t|hadn'?t|wasn'?t|weren'?t\b|\bother\s+than\b|\bapart\s+from\b/.test(q);
  const negateWhat = negationActive ? q.match(/\b(?:excluding|except|without|besides|not\s+by|everyone\w*\s+except|other\s+than|apart\s+from|ko\s+chhodkar|ke\s+alawa)\s+(\S+)/i)?.[1]?.toLowerCase() : null;
  const groupAbsencePattern = negationActive && /organi[sz]ation|org\b|client/.test(q) && /\b(?:no\s|without|none|not\s+have|not\s+has|don'?t\s+have|zero)\b/.test(q) && state;
  return Plan.parse({
    operation,
    scope,
    topic,
    person,
    client,
    state,
    timeRange: extractTimeRange(q),
    expandedTerms: topic ? [topic, topic.replaceAll('_', ' ')] : [],
    negated: !!negationActive,
    negatedTopic: false,
    negatedPerson: !!(negationActive && person && (negateWhat && normalize(negateWhat) === normalize(person.split(' ')[0]) || !negateWhat && !groupAbsencePattern)),
    negatedClient: false,
    negatedState: !!(negationActive && state && (groupAbsencePattern || !negateWhat)),
    groupByClient: !!groupAbsencePattern,
    requireNoMatchingInGroup: !!groupAbsencePattern,
    supportedByTenant: true,
    requiresClarification: false,
    clarification: null
  });
}

function finalizePlan(question, plan, glossary) {
  return guardPlanForTenant(question, { ...plan, operation: reconcileOperation(question, plan.operation) }, glossary);
}

export class LiveQueryPlannerService {
  async plan(question, semanticMap) {
    const glossary = semanticMap?.glossary || {};
    if (!process.env.GEMINI_API_KEY) {
      const ranking = hasRankingKeyword(question);
      return ranking
        ? { plan: unsupportedFeaturePlan(question, glossary, 'ranking'), aiCalls: 0, provider: 'safety-guard' }
        : { plan: finalizePlan(question, fallbackPlan(question, glossary), glossary), aiCalls: 0, provider: 'deterministic' };
    }
    try {
      const geminiPlan = await this.#gemini(question, semanticMap);
    const guardedGemini = finalizePlan(question, geminiPlan, glossary);
    const fallback = finalizePlan(question, fallbackPlan(question, glossary), glossary);
    if (guardedGemini.requiresClarification) return { plan: guardedGemini, aiCalls: 1, provider: 'gemini' };
    const genericCrm = crmTermRegex.test(question.toLowerCase()) && ['crm_deals','business_items'].includes(fallback.scope);
    const explicitListRequest = /\b(which|list|show|dikhao|where|where are|where is)\b/.test(question.toLowerCase());
    if (genericCrm && fallback.operation === 'count' && guardedGemini.operation !== 'count' && !explicitListRequest) {
      return { plan: fallback, aiCalls: 1, provider: 'gemini' };
    }
    if (!guardedGemini.supportedByTenant && fallback.supportedByTenant) {
      return { plan: fallback, aiCalls: 1, provider: 'gemini' };
    }
    return { plan: guardedGemini, aiCalls: 1, provider: 'gemini' };
    } catch {
      const ranking = hasRankingKeyword(question);
      return ranking
        ? { plan: unsupportedFeaturePlan(question, glossary, 'ranking'), aiCalls: 0, provider: 'safety-guard' }
        : { plan: finalizePlan(question, fallbackPlan(question, glossary), glossary), aiCalls: 0, provider: 'deterministic-fallback' };
    }
  }

  async #gemini(question, semanticMap) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
    const glossary = semanticMap?.glossary || {};
    const prompt = `Plan a deterministic query over a tenant-specific semantic business layer. Return JSON only and never answer the question.
Allowed operation: count,list,locate,status,verify,summarize.
Use operation=count for cardinality questions (how many, total, count of, number of, what is the total). Existential phrasing such as "is there" or "are there" is still count when asking for quantity, not verify.
Use operation=verify only for yes/no checks about a specific claim or state (was it filed, is deal X closed).
Allowed scope: crm_deals,filings,files,business_items.
Allowed state: completed,open,cancelled,unknown or null.
Allowed timeRange: all,last_month,this_month,this_year,last_year,YYYY,YYYY-MM.
Only set topic when the question explicitly names a subject/category, such as GST, contract, or income tax. Generic CRM nouns such as deal(s), lead(s), opportunity, or pipeline define scope only: use scope=crm_deals and topic=null for them. Use expandedTerms for synonyms and abbreviations. "Filed/filled/done/submitted" means completed. "Open/pending/chal raha" means open.
Understand negation and exclusion semantically in any language or phrasing; do not rely on individual words. For an excluded owner, set person to the excluded person, negated=true, and negatedPerson=true. Apply the same field-level convention for topic, client, and state using negatedTopic, negatedClient, and negatedState. For organization/client requests meaning "no member has this condition" (for example, organizations with zero open deals), set groupByClient=true and requireNoMatchingInGroup=true; retain the target state/person as a positive condition to test inside each group, rather than applying it as a record filter. Do not set requiresClarification merely because negation is present: encode the requested inversion. If meaning is genuinely unclear, set requiresClarification=true instead of guessing.
If a term is genuinely ambiguous (for example closed could include completed and cancelled), set requiresClarification and provide one short clarification. Do not invent a client or person.
Set supportedByTenant=false and requiresClarification=true when the question is unrelated to the connected business data or its subject cannot be mapped to the tenant glossary. Never map an unrelated general-knowledge question to business_items.
Tenant glossary: ${JSON.stringify({ topics: glossary.topics || [], people: glossary.people || {}, clients: glossary.clients || [] })}
Question: ${JSON.stringify(question)}
Return fields: operation,scope,topic,person,client,state,timeRange,expandedTerms,negated,negatedTopic,negatedPerson,negatedClient,negatedState,groupByClient,requireNoMatchingInGroup,supportedByTenant,requiresClarification,clarification.`;
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
