import { z } from 'zod';

const Intent = z.object({
  operation: z.enum(['count','sum','list','verify']), entity: z.enum(['deal','filing','task','file']),
  owner: z.string().nullable().default(null), client: z.string().nullable().default(null),
  lifecycle: z.string().nullable().default(null), timeRange: z.enum(['last_month','this_month','all']).default('all'),
  amountField: z.string().nullable().default(null)
});

const entityFrom = q => q.includes('deal') ? 'deal' : q.includes('task') || q.includes('jira') ? 'task' : q.includes('file') || q.includes('itr') || q.includes('income tax') ? 'filing' : 'deal';

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
    const prompt = `Extract business-question intent. Return JSON only. Allowed operations: count,sum,list,verify. Allowed entities: deal,filing,task,file. timeRange: last_month,this_month,all. Null for missing owner/client/lifecycle. Never answer or invent a number. Question: ${JSON.stringify(question)}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{responseMimeType:'application/json',temperature:0,maxOutputTokens:300} })
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const json = await response.json();
    return Intent.parse(JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
  }
}

export const intentService = new IntentService();
