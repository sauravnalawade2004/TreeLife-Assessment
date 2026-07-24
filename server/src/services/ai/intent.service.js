import { z } from 'zod';

const Intent = z.object({
  operation: z.enum(['count','sum','list','verify']), entity: z.string().default('business_item'),
  owner: z.string().nullable().default(null), client: z.string().nullable().default(null),
  lifecycle: z.string().nullable().default(null), timeRange: z.enum(['last_month','this_month','all']).default('all'),
  amountField: z.string().nullable().default(null)
});

const entityFrom = (question) => {
  const q = String(question || '').toLowerCase();
  if (q.includes('deal') || q.includes('opportunity')) return 'deal';
  if (q.includes('task') || q.includes('jira')) return 'task';
  if (q.includes('file') || q.includes('document') || q.includes('invoice')) return 'file';
  if (q.includes('filing') || q.includes('return') || q.includes('itr') || q.includes('income tax') || q.includes('gst') || q.includes('tds')) return 'filing';
  if (q.includes('student') || q.includes('enrollment')) return 'student';
  if (q.includes('lead')) return 'lead';
  if (q.includes('client') || q.includes('customer') || q.includes('organization') || q.includes('company')) return 'organization';
  if (q.includes('record') || q.includes('entry') || q.includes('item') || q.includes('case') || q.includes('member') || q.includes('application')) return 'record';
  return 'business_item';
};

function fallbackIntent(question) {
  const q = question.toLowerCase();
  const ownerMatch = question.match(/(?:does|for|by|assigned to)\s+([a-z][a-z .'-]+?)(?:\s+(?:own|have)|\?|$)/i);
  const clientMatch = question.match(/(?:was|is|did)\s+(.+?)(?:'s|\s+ka\s+|\s+income|\s+itr)/i) || question.match(/for\s+(.+?)(?:\?|$)/i);
  return Intent.parse({
    operation: /\b(was|is|did|filed|verify)\b/.test(q) && /itr|income tax|fil/.test(q) ? 'verify' : /total|sum|value/.test(q) ? 'sum' : /which|list|show/.test(q) ? 'list' : 'count',
    entity: entityFrom(q), owner: ownerMatch?.[1]?.trim() || null, client: clientMatch?.[1]?.trim().replace(/['’]$/,'') || null,
    lifecycle: ['open','active','lost','blocked','completed','filed'].find(x => q.includes(x)) || (q.includes('income tax') || q.includes('itr') ? 'filed' : null),
    timeRange: q.includes('last month') ? 'last_month' : q.includes('this month') ? 'this_month' : 'all', amountField: /total|sum|value/.test(q) ? 'amount' : null
  });
}

export class IntentService {
  constructor() { this.cache = new Map(); }
  async parse(question) {
    const key = question.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    if (this.cache.has(key)) return { ...this.cache.get(key), aiCalls:0, cacheHit:true };
    let intent; let aiCalls = 0; let provider = 'deterministic';
    if (process.env.GEMINI_API_KEY) {
      try { intent = await this.#gemini(question); aiCalls = 1; provider = 'gemini'; } catch { intent = fallbackIntent(question); provider = 'deterministic-fallback'; }
    } else intent = fallbackIntent(question);
    const result = { intent, aiCalls, cacheHit:false, provider };
    this.cache.set(key, result); return result;
  }
  async #gemini(question) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = `Extract business-question intent. Return JSON only. Allowed operations: count,sum,list,verify. Return entity as a short free-text string that matches the user's wording, such as deal, lead, organization, customer, application, record, student, enrollment, or file. timeRange: last_month,this_month,all. Null for missing owner/client/lifecycle. Never answer or invent a number. Question: ${JSON.stringify(question)}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{responseMimeType:'application/json',temperature:0,maxOutputTokens:300} })
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const json = await response.json();
    return Intent.parse(JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
  }
}

export const intentService = new IntentService();
