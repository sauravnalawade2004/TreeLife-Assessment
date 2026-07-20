import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUp, BrainCircuit, CheckCircle2, ChevronDown, Database, FileSearch, GitBranch, MessageSquareText, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import './live-ui.css';

const API = 'http://localhost:4000/api';
const samples = [
  'How many income tax filings have we completed?',
  'How many income tax matters are open?',
  'Where is the latest inventory file?',
  'How many CFA matters are open?',
  'Is Cedar Works income tax return filed?',
  'How many GST filings did Garima complete?'
];
const statusMeta = {
  ANSWERED: ['Verified answer', 'good', CheckCircle2],
  VERIFIED_ZERO: ['Verified zero', 'good', ShieldCheck],
  UNKNOWN: ['Not enough evidence', 'warn', TriangleAlert],
  NEEDS_CLARIFICATION: ['Clarification needed', 'warn', MessageSquareText],
  CONFLICT: ['Conflicting evidence', 'bad', TriangleAlert]
};

async function api(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body.data;
}

function App() {
  const [tenants, setTenants] = useState([]);
  const [tenant, setTenant] = useState('acme-law');
  const [question, setQuestion] = useState(samples[0]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('ask');
  const [map, setMap] = useState(null);
  const refreshTenants = useCallback(async () => { try { setTenants(await api('/tenants')); } catch { /* handled by answer state */ } }, []);
  const refreshMap = useCallback(async () => { try { setMap(await api(`/semantic-map/${tenant}`)); } catch { setMap(null); } }, [tenant]);
  useEffect(() => { refreshTenants(); }, [refreshTenants]);
  useEffect(() => { refreshMap(); }, [refreshMap]);

  async function ask(q = question) {
    if (!q.trim() || loading) return;
    const askedQuestion = q.trim();
    setLoading(true);
    setResult(null);
    setQuestion('');
    try {
      setResult(await api('/questions/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: tenant, question: askedQuestion }) }));
    } catch (error) {
      setResult({ question: askedQuestion, status: 'UNKNOWN', clarification: error.message === 'Failed to fetch' ? 'The API is not reachable. Start the server on port 4000.' : error.message, confidence: 0, reasoning: ['The request stopped safely instead of inventing an answer.'], evidence: { sourceCoverage: [] } });
    } finally { setLoading(false); }
  }

  const selected = tenants.find((item) => item.id === tenant);
  return <div className="shell">
    <aside>
      <div className="brand"><div className="logo"><GitBranch /></div><div><b>SemanticLens</b><span>Business truth engine</span></div></div>
      <nav>
        <button className={tab === 'ask' ? 'active' : ''} onClick={() => setTab('ask')}><MessageSquareText />Ask</button>
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><BrainCircuit />Semantic map</button>
        <button className={tab === 'sources' ? 'active' : ''} onClick={() => setTab('sources')}><Database />Sources</button>
      </nav>
      <div className="tenant"><span>Workspace</span><select value={tenant} onChange={(event) => setTenant(event.target.value)}>{tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="system"><i></i><div><b>Live semantic layer</b><span>Multi-source evidence indexed</span></div></div>
    </aside>
    <main>
      {tab === 'ask' && <AskView {...{ question, setQuestion, ask, loading, result }} />}
      {tab === 'map' && <MapView map={map} />}
      {tab === 'sources' && <Sources tenant={selected} tenantId={tenant} onRefresh={async () => { await Promise.all([refreshTenants(), refreshMap()]); }} />}
    </main>
  </div>;
}

function AskView({ question, setQuestion, ask, loading, result }) {
  return <div className="page ask-page">
    <header><div><p className="eyebrow">ADAPTIVE SEMANTIC LAYER</p><h1>Ask your business data.</h1><p>Answers grounded in how your team actually works—not textbook fields.</p></div><div className="pill"><Sparkles /> Live Gemini planner · deterministic answers</div></header>
    <section className="chatbox">
      <div className="composer"><textarea aria-label="Business question" placeholder="Ask a question about your business…" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} /><button aria-label="Ask question" onClick={() => ask()} disabled={loading}><ArrowUp /></button><div className="under"><span>Enter to ask</span><span>Numbers come only from verified record evidence</span></div></div>
      {loading && <div className="loading"><BrainCircuit /><span>Understanding the question, retrieving evidence, and verifying the answer…</span></div>}
      {result && <Result result={result} />}
    </section>
    <div className="samples">{samples.map((sample) => <button key={sample} onClick={() => { setQuestion(sample); ask(sample); }}>{sample}</button>)}</div>
  </div>;
}

function Result({ result }) {
  const [label, tone, Icon] = statusMeta[result.status] || statusMeta.UNKNOWN;
  const answerText = result.answer?.text || result.clarification || result.reasoning?.[0] || 'No supported answer is available.';
  const records = result.evidence?.records || [];
  return <section className="result">
    <div className="chat-message user-message"><span>You</span><p>{result.question}</p></div>
    <div className="chat-message assistant-message">
      <div className="message-author">SemanticLens</div>
      <div className="result-top"><div className={`status ${tone}`}><Icon />{label}</div><div className="confidence">{Math.round((result.confidence || 0) * 100)}% confidence</div></div>
      <h2>{answerText}</h2>
      {result.answer?.url && <a className="drive-link" href={result.answer.url} target="_blank" rel="noreferrer">Open verified file in Google Drive</a>}
    </div>
    <details className="reviewer-details">
      <summary><span><FileSearch /> Reviewer details · evidence and calculation</span><ChevronDown /></summary>
      <div className="reviewer-body">
        <div className="trace"><h3><Activity /> How this was calculated</h3>{result.reasoning?.map((step, index) => <div className="step" key={`${index}-${step}`}><b>{index + 1}</b><span>{step}</span></div>)}</div>
        <div className="grid">
          <div className="panel"><h3><Database /> Source coverage</h3>{result.evidence?.sourceCoverage?.map((coverage) => <div className="source" key={`${coverage.source}-${coverage.status}`}><span className={`dot ${coverage.status}`}></span><b>{coverage.source.toUpperCase()}</b><em>{coverage.status.replaceAll('_', ' ')}</em></div>)}</div>
          <div className="panel"><h3><ShieldCheck /> Trust checks</h3><div className="metric"><span>Deduplicated matches</span><b>{result.evidence?.matchedRecordIds?.length || 0}</b></div><div className="metric"><span>Unresolved items excluded</span><b>{result.evidence?.unresolvedExcluded?.length || 0}</b></div><div className="metric"><span>AI planning calls</span><b>{result.ai?.aiCalls ?? 0}</b></div><small>AI plans the query; backend evidence calculates the answer.</small></div>
        </div>
        {records.length > 0 && <div className="evidence-list"><h3><ShieldCheck /> Matched business truths</h3>{records.map((record) => <div className="evidence-row" key={record.truthId}><div><b>{record.client || record.topic}</b><span>{String(record.topic || '').replaceAll('_', ' ')} · {record.state}</span></div><div><span>{record.sources?.map((source) => source === 'google_drive' ? 'Google Drive' : source).join(' + ')}</span>{record.reference && <code>{record.reference}</code>}{record.bestUrl ? <a href={record.bestUrl} target="_blank" rel="noreferrer"><code>{record.bestPath}</code></a> : record.bestPath && <code>{record.bestPath}</code>}</div></div>)}</div>}
        <details className="intent-details"><summary>View interpreted intent <ChevronDown /></summary><pre>{JSON.stringify(result.interpretation, null, 2)}</pre></details>
      </div>
    </details>
  </section>;
}

function MapView({ map }) {
  const hypotheses = Array.isArray(map?.fieldHypotheses) ? map.fieldHypotheses : [];
  if (!map) return <div className="page"><div className="loading"><BrainCircuit /><span>Semantic map is not available yet. Sync sources and compile it first.</span></div></div>;
  return <div className="page">
    <header><div><p className="eyebrow">LEARNED, NOT HARDCODED</p><h1>Tenant semantic map</h1><p>Field meaning discovered from this client’s real values and cross-source evidence.</p></div><div className="pill"><BrainCircuit /> Version {map.version || 1}</div></header>
    {map.stats && <div className="stat-grid">{Object.entries(map.stats).map(([name, value]) => <div key={name}><b>{value}</b><span>{name}</span></div>)}</div>}
    {hypotheses.length > 0 ? <div className="map-grid">{hypotheses.map((field) => <section className="map-card" key={field.field}><div className="map-title"><div><FileSearch /><b>{field.field}</b></div><span>{Math.round((field.coverage || 0) * 100)}% coverage</span></div><h4>Learned business role</h4><div className="role"><b>{String(field.proposedRole || 'unknown').replaceAll('_', ' ')}</b><span>{Math.round((field.validatedConfidence || 0) * 100)}% validated</span></div><h4>Observed values</h4><div className="sample-values">{field.samples?.slice(0, 5).map((sample) => <code key={sample}>{sample}</code>)}</div></section>)}</div> : <LegacyMap map={map} />}
    {map.warnings?.length > 0 && <section className="map-warnings"><h3>Client-specific warnings learned</h3>{map.warnings.map((warning) => <div className="warning" key={warning}><TriangleAlert />{warning}</div>)}</section>}
  </div>;
}

function LegacyMap({ map }) {
  return <div className="map-grid">{Object.entries(map?.entities || {}).map(([name, entity]) => <section className="map-card" key={name}><div className="map-title"><div><FileSearch /><b>{name}</b></div><span>{entity.profiles?.length || 0} fields</span></div>{[...(entity.ownerCandidates || []), ...(entity.lifecycleCandidates || [])].slice(0, 6).map((candidate) => <div className="candidate" key={candidate.field}><code>{candidate.field}</code><span>{Math.round(candidate.confidence * 100)}%</span></div>)}</section>)}</div>;
}

function Sources({ tenant, tenantId, onRefresh }) {
  const [syncing, setSyncing] = useState('');
  const [notice, setNotice] = useState('');
  const liveConnectors = useMemo(() => {
    const connectors = tenant?.connectors || [];
    let live = connectors.filter((connector) => ['pipedrive-acme', 'documents-acme', 'google-drive-acme', 'notion-acme'].includes(connector.id));
    if (live.some((connector) => connector.id === 'google-drive-acme')) live = live.filter((connector) => connector.id !== 'documents-acme');
    else live.push({ id: 'google-drive-acme', type: 'google_drive', name: 'Google Drive Evidence', status: 'not configured', recordCount: 0, lastSync: null });
    if (!live.some((connector) => connector.id === 'notion-acme')) live.push({ id: 'notion-acme', type: 'work_tracker', name: 'Notion Work Tracker', status: 'not configured', recordCount: 0, lastSync: null });
    return live.length ? live : connectors;
  }, [tenant]);
  async function sync(connector) {
    setSyncing(connector.id);
    setNotice('');
    try {
      const endpoints = { 'pipedrive-acme': '/connectors/pipedrive/sync', 'documents-acme': '/connectors/documents/sync', 'google-drive-acme': '/connectors/google-drive/sync', 'notion-acme': '/connectors/notion/sync' };
      const endpoint = endpoints[connector.id];
      if (!endpoint) throw new Error(`No sync route exists for ${connector.name}`);
      await api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId }) });
      await api('/semantic/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId }) });
      await onRefresh();
      setNotice(`${connector.name} synced and semantic map rebuilt successfully.`);
    } catch (error) { setNotice(`Sync stopped safely: ${error.message}`); }
    finally { setSyncing(''); }
  }
  return <div className="page">
    <header><div><p className="eyebrow">LIVE CONNECTOR HEALTH</p><h1>Connected sources</h1><p>CRM, work-tracker, and document platforms feed one normalized evidence layer.</p></div></header>
    {notice && <div className="sync-notice">{notice}</div>}
    <div className="source-cards">{liveConnectors.map((connector) => <section key={connector.id}><div className="source-icon"><Database /></div><div><h3>{connector.name}</h3><p>{connector.type.toUpperCase()} · {connector.recordCount} indexed records</p><span className="health"><i></i>{connector.status} · last synced {connector.lastSync ? new Date(connector.lastSync).toLocaleString() : 'not yet'}</span></div><button disabled={Boolean(syncing)} onClick={() => sync(connector)}><RefreshCw className={syncing === connector.id ? 'spin' : ''} />{syncing === connector.id ? 'Rebuilding…' : 'Sync & rebuild'}</button></section>)}</div>
    <p className="source-note"><b>Connector design:</b> Pipedrive supplies CRM claims, Google Drive supplies independent PDF evidence, and Notion adds messy work-tracker claims. The local folder remains an offline fallback and is excluded when Drive is live. Scanned PDFs are flagged for OCR before extraction.</p>
  </div>;
}

export default App;
