const clean = value => String(value ?? '').trim().toLowerCase();
const words = value => new Set(clean(value).replaceAll('_', ' ').match(/[a-z0-9]+/g) || []);

const OWNER_HINTS = ['deal owner','lead owner','owner','assigned to','assignee','responsible','handled by','handler','relationship manager','case handler'];
const STATUS_HINTS = ['status','state','stage','workflow state','board column','folder'];
const DEAD = ['dead','lost','rejected','archive','cancelled','void'];
const OPEN = ['open','active','doing','follow up','qualified','proposal','discovery','negotiation','review'];

function similarity(a, b) {
  const A = words(a), B = words(b); const intersection = [...A].filter(x => B.has(x)).length;
  if (!A.size || !B.size) return 0;
  if (clean(a) === clean(b)) return 1;
  return intersection / new Set([...A, ...B]).size;
}

function hintScore(name, hints) {
  const normalized = clean(name);
  if (hints.some((hint) => normalized.includes(clean(hint)))) return 1;
  return Math.max(...hints.map((hint) => similarity(name, hint)), 0);
}

function profileFields(records) {
  const names = [...new Set(records.flatMap(r => Object.keys(r.fields)))];
  return names.map(name => {
    const values = records.map(r => r.fields[name]).filter(v => v !== '' && v != null);
    const flat = values.flat().map(clean).filter(Boolean);
    const unique = [...new Set(flat)];
    return {
      name, nonNullRatio: +(values.length / Math.max(records.length, 1)).toFixed(2),
      distinctRatio: +(unique.length / Math.max(flat.length, 1)).toFixed(2),
      samples: unique.slice(0, 6), valueCount: flat.length
    };
  });
}

function scoreField(profile, hints, lifecycle = false) {
  const nameHintScore = hintScore(profile.name, hints);
  let score = nameHintScore;
  if (lifecycle) {
    const hits = profile.samples.filter(v => [...DEAD, ...OPEN, 'done','closed','submitted','filed'].some(x => v.includes(x))).length;
    score += Math.min(.45, hits * .12);
  } else {
    if (profile.distinctRatio > .15 && profile.distinctRatio < .9 && profile.samples.every(v => v.length < 40)) score += .12;
    // Strong name hints should decisively favor owner if the field label clearly matches owner terminology.
    if (hintScore >= 0.3) score += 0.22;
  }
  // A generic textbook owner with one shared value is weaker than a populated
  // custom business field. A specific custom label wins an otherwise tied score.
  if (!lifecycle && profile.distinctRatio <= .2) score -= .35;
  score = Math.min(1, score);
  if (!lifecycle && clean(profile.name) === 'owner') score -= .03;
  return Math.max(0, +score.toFixed(2));
}

export function compileSemanticMap(tenantId, records) {
  const byEntity = Object.groupBy(records, r => r.entity);
  const entities = {};
  for (const [entity, rows] of Object.entries(byEntity)) {
    const profiles = profileFields(rows);
    const ownerCandidates = profiles.map(p => ({ field:p.name, confidence:scoreField(p, OWNER_HINTS) })).filter(x => x.confidence >= .45).sort((a,b) => b.confidence-a.confidence);
    const lifecycleCandidates = profiles.map(p => ({ field:p.name, confidence:scoreField(p, STATUS_HINTS, true) })).filter(x => x.confidence >= .4).sort((a,b) => b.confidence-a.confidence);
    // Detect textbook fields which carry no useful discrimination (shared-login smell).
    const warnings = profiles.filter(p => /official.*owner|owner/i.test(p.name) && p.distinctRatio <= .2).map(p => `${p.name} is non-discriminating (${p.samples.join(', ')}) and should not be trusted as the real owner.`);
    entities[entity] = { profiles, ownerCandidates, lifecycleCandidates, warnings };
  }
  return { tenantId, version:1, compiledAt:new Date().toISOString(), entities };
}

export const vocabulary = { DEAD, OPEN };
