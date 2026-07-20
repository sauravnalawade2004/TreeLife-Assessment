import { repository } from '../../repositories/demoRepository.js';
import { compileSemanticMap, vocabulary } from '../semantic/profiler.service.js';
import { intentService } from '../ai/intent.service.js';

const norm = v => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g,'');
const display = v => String(v ?? '').trim();
const inMonth = (date, range) => {
  if (range === 'all') return true; if (!date) return false;
  const d = new Date(`${date}T00:00:00Z`), now = new Date('2026-07-15T00:00:00Z');
  const start = range === 'this_month' ? new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)) : new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  const end = range === 'this_month' ? new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)) : new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  return d >= start && d < end;
};
const money = v => Number(String(v ?? 0).replace(/[^0-9.-]/g,'')) || 0;

function resolveAlias(tenantId, type, input) {
  if (!input) return { value:null, confidence:1, ambiguous:false };
  for (const a of repository.findAliases(tenantId, type)) {
    if ([a.canonical,...a.variants].some(v => norm(v) === norm(input) || norm(v).includes(norm(input)) || norm(input).includes(norm(v)))) return { value:a.canonical, confidence:.98, ambiguous:false };
    if (a.uncertain.some(v => norm(v) === norm(input))) return { value:a.canonical, confidence:.58, ambiguous:true, stored:input };
  }
  return { value:input, confidence:.76, ambiguous:false };
}

function fieldValue(row, candidates) { for (const c of candidates) if (row.fields[c.field] != null) return row.fields[c.field]; return ''; }
const isTerminal = value => vocabulary.DEAD.some(x => display(value).toLowerCase().includes(x)) || /done|closed|completed|won/i.test(display(value));

export class AnswerService {
  async answer(tenantId, question) {
    const tenant = repository.getTenant(tenantId); if (!tenant) throw Object.assign(new Error('Tenant not found'),{status:404});
    const parsed = await intentService.parse(question); const { intent } = parsed;
    const all = repository.findRecords(tenantId); const semanticMap = compileSemanticMap(tenantId, all);
    const sourcePlan = this.#route(intent); const relevant = all.filter(r => sourcePlan.primary.includes(r.source) && r.entity === intent.entity);
    const coverage = tenant.connectors.map(c => ({ source:c.type, status:sourcePlan.primary.includes(c.type)?'checked':sourcePlan.supporting.includes(c.type)?'supporting':'not_relevant', freshness:c.lastSync, health:c.status }));
    const rawTokens=question.toLowerCase().match(/[a-z0-9]+/g)||[];
    const ownershipMentioned=rawTokens.some(t=>t.startsWith('own')||t.startsWith('assign'))||/\bdoes\b.*\b(?:have|own)/i.test(question);
    if(['deal','task'].includes(intent.entity)&&ownershipMentioned&&!intent.owner){
      return this.#clarify(question,intent,coverage,parsed,'I detected an owner filter, but could not identify the person reliably. Please re-enter or confirm the owner name.');
    }
    if (intent.entity === 'filing' && intent.operation === 'verify') return this.#verifyFiling({tenantId,intent,all,coverage,semanticMap,parsed,question});
    const entityMap = semanticMap.entities[intent.entity];
    if (!entityMap || !relevant.length) return this.#unknown(question,intent,coverage,parsed,'No indexed records or credible semantic map exists for this entity.');
    const owner = resolveAlias(tenantId,'person',intent.owner); if (owner.ambiguous) return this.#clarify(question,intent,coverage,parsed,`Does “${intent.owner}” mean ${owner.value}?`);
    const ownerFields = entityMap.ownerCandidates; const lifecycleFields = entityMap.lifecycleCandidates;
    const included=[], excluded=[];
    for (const row of relevant) {
      const storedOwner = fieldValue(row, ownerFields); const storedResolution = resolveAlias(tenantId,'person',storedOwner);
      // Unconfirmed typo aliases never silently enter a numeric answer.
      const ownerMatch = !owner.value || norm(storedOwner) === norm(owner.value) || (!storedResolution.ambiguous && storedResolution.value === owner.value);
      const lifeValues = lifecycleFields.map(c => row.fields[c.field]).filter(v => v !== '' && v != null);
      const terminal = lifeValues.some(isTerminal); const dead = lifeValues.some(v => vocabulary.DEAD.some(x => display(v).toLowerCase().includes(x)));
      let lifecycleMatch = true;
      if (intent.lifecycle === 'open' || intent.lifecycle === 'active') lifecycleMatch = !terminal;
      if (intent.lifecycle === 'lost') lifecycleMatch = dead;
      if (intent.lifecycle === 'completed') lifecycleMatch = terminal;
      const date = row.fields.created_at || row.fields.updated;
      const dateMatch = inMonth(date,intent.timeRange);
      if (ownerMatch && lifecycleMatch && dateMatch) included.push(row); else excluded.push({id:row.id,reasons:[!ownerMatch&&'owner mismatch',!lifecycleMatch&&'lifecycle evidence',!dateMatch&&'outside time range'].filter(Boolean)});
    }
    const connectorHealthy = coverage.filter(c=>c.status==='checked').every(c=>c.health==='healthy'||c.health==='demo');
    if (!included.length && !connectorHealthy) return this.#unknown(question,intent,coverage,parsed,'A required connector is unhealthy, so zero cannot be verified.');
    const value = intent.operation === 'sum' ? included.reduce((s,r)=>s+money(r.fields.amount ?? r.fields.value),0) : included.length;
    const status = included.length ? 'ANSWERED' : 'VERIFIED_ZERO'; const confidence = included.length ? .92 : .88;
    return { status, question, answer:{value,unit:intent.operation==='sum'?'INR':`${intent.entity}s`,text:included.length?this.#answerText(intent,owner.value,value):`No verified matching ${intent.entity}s were found.`}, interpretation:intent,
      confidence, ai:parsed, evidence:{matchedRecordIds:included.map(r=>r.id),excludedRecords:excluded,sourceCoverage:coverage},
      reasoning:[`Selected ${sourcePlan.primary.join(', ')} from the question's entity.`, owner.value?`Resolved owner to ${owner.value} and used ${ownerFields[0]?.field || 'no owner field'}.`:'No owner filter was requested.', `Evaluated lifecycle across ${lifecycleFields.map(x=>x.field).join(', ') || 'available fields'}; terminal/negative evidence overrides stale active values.`, `The final ${intent.operation} was calculated by backend code over ${included.length} evidenced records; AI did not supply the number.`], semanticMap };
  }
  #route(intent) {
    if (intent.entity === 'deal') return {primary:['crm'],supporting:[]};
    if (intent.entity === 'task') return {primary:['jira'],supporting:[]};
    if (intent.entity === 'filing') return {primary:['crm'],supporting:['drive']};
    return {primary:['drive'],supporting:[]};
  }
  #verifyFiling({tenantId,intent,all,coverage,semanticMap,parsed,question}) {
    if (!intent.client) return this.#clarify(question,intent,coverage,parsed,'Which client’s income-tax filing should I verify?');
    const client = resolveAlias(tenantId,'client',intent.client); const filings = all.filter(r=>r.entity==='filing' && resolveAlias(tenantId,'client',r.fields.client).value===client.value && inMonth(r.fields.submission_date,intent.timeRange));
    const files = all.filter(r=>r.entity==='file' && (filings.some(f=>r.fields.linked_case===f.id) || resolveAlias(tenantId,'client',r.fields.client_hint).value===client.value));
    if (!filings.length) return { ...this.#unknown(question,intent,coverage,parsed,`No authoritative filing case was found for ${client.value}; Drive files alone cannot prove submission.`), evidence:{matchedRecordIds:files.map(f=>f.id),sourceCoverage:coverage} };
    const filing = filings[0], ackFiles = files.filter(f=>f.fields.document_kind==='acknowledgement'); const strong = Boolean(filing.fields.acknowledgement_no || ackFiles.length);
    const conflict = /filed|submitted/i.test(filing.fields.workflow_state) && !strong;
    return { status:conflict?'CONFLICT':'ANSWERED', question, answer:{value:strong,text:strong?`Yes. ${client.value}'s income-tax filing was verified for the requested period.`:`CRM says filed, but independent filing proof is missing.`}, interpretation:intent, confidence:strong?.97:.61, ai:parsed,
      evidence:{matchedRecordIds:[filing.id,...ackFiles.map(f=>f.id)],sourceCoverage:coverage,crmRecord:filing,driveEvidence:ackFiles},
      reasoning:[`Resolved client aliases to ${client.value}.`,`Used CRM workflow as the primary source and Drive as supporting evidence.`,strong?`Verified strong evidence: ${filing.fields.acknowledgement_no?'acknowledgement number':'acknowledgement document'}.`:'A final/draft file or modified folder is not sufficient proof of filing.','Merged CRM and Drive evidence into one filing case instead of double-counting it.'], semanticMap };
  }
  #answerText(intent,owner,value) { return intent.operation==='sum'?`${owner||'The selection'} has a total value of ₹${value.toLocaleString('en-IN')}.`:`${owner||'The selection'} has ${value} matching ${intent.entity}${value===1?'':'s'}.`; }
  #unknown(question,intent,coverage,ai,reason) { return {status:'UNKNOWN',question,answer:null,interpretation:intent,confidence:.35,ai,evidence:{matchedRecordIds:[],sourceCoverage:coverage},reasoning:[reason,'The system refused to convert missing or incomplete evidence into a misleading zero.']}; }
  #clarify(question,intent,coverage,ai,prompt) { return {status:'NEEDS_CLARIFICATION',question,answer:null,clarification:prompt,interpretation:intent,confidence:.5,ai,evidence:{matchedRecordIds:[],sourceCoverage:coverage},reasoning:['The question or entity resolution is ambiguous, so execution was paused before calculating a number.']}; }
}

export const answerService = new AnswerService();
