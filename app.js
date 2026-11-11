import { simulate, SOURCES, FIELDS, FIELD_LABELS, TRUST_ORDER } from './core/simulate.js';
import { analyze, selective } from './core/resolve.js';
import { agentImpact } from './core/impact.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 20261110);
const SRC = Object.fromEntries(SOURCES.map(s => [s.id, s]));
const SRC_COLOR = { crm: '#139cd8', mail: '#8d857c', pa: '#774ed3', pb: '#b393ee', pc: '#e3893d', web: '#2fa866', csv: '#b4afa8' };
const CO_COLORS = ['#3787e8', '#2fa866', '#e3893d', '#774ed3', '#d73b3b', '#0f9fa8', '#b7790a', '#46423e', '#c2418f', '#5b6ee1'];
const FIELD_ORDER = ['company', 'title', 'email', 'location'];
const PAGE = 50;

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n.toLocaleString('en-US');
const pct = (x, d = 0) => (100 * x).toFixed(d) + '%';
const pr = x => x < 0.005 ? '<1%' : x > 0.995 ? '>99%' : Math.round(100 * x) + '%';
const ago = d => d < 1 ? 'today' : d < 45 ? `${Math.round(d)}d ago` : d < 365 ? `${Math.round(d / 30.4)}mo ago` : `${(d / 365).toFixed(1)}y ago`;
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const confClass = p => p >= 0.85 ? 'hi' : p >= 0.6 ? 'mid' : 'lo';
const confChip = p => `<span class="conf ${confClass(p)}"><span class="bar"><i style="width:${Math.round(100 * p)}%"></i></span>${pr(p)}</span>`;
const icons = () => window.lucide && window.lucide.createIcons();

let sim, A, people, state = { tab: params.get('tab') || 'contacts', filter: params.get('filter') || 'differs', page: 0, sel: null, q: '' };

function build() {
  sim = simulate(SEED);
  A = analyze(sim, SOURCES.map(s => s.id), FIELDS, TRUST_ORDER);
  const seq = new Set(sim.inSequence);
  people = sim.people.map(p => {
    const f = {};
    for (const field of FIELDS) f[field] = A.itemsByKey[p.id + ':' + field] || null;
    const items = Object.values(f).filter(Boolean);
    const minConf = Math.min(...items.map(i => i.confCal));
    const differs = items.filter(i => i.top !== i.trust.value).map(i => i.field);
    const lastSeen = Math.min(...items.flatMap(i => i.obs.map(oi => sim.observations[oi].age)));
    const pChanged = Math.max(...items.map(i => i.pUnseenCal));
    return { ...p, f, minConf, differs, lastSeen, pChanged, inSeq: seq.has(p.id), name: `${p.first} ${p.last}` };
  });
  people.sort((a, b) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

const FILTERS = [
  ['all', 'All', () => true],
  ['differs', 'Differs from rules', p => p.differs.length > 0],
  ['low', 'Low confidence', p => p.minConf < 0.6],
  ['changed', 'Likely changed', p => p.pChanged >= 0.3],
  ['seq', 'In a sequence', p => p.inSeq],
];

function visible() {
  const fn = FILTERS.find(f => f[0] === state.filter)[2];
  const q = state.q.trim().toLowerCase();
  return people.filter(p => fn(p) && (!q || p.name.toLowerCase().includes(q) || (p.f.company?.top || '').toLowerCase().includes(q)));
}

// A contact worth opening first: in a sequence, the trust rules show a wrong
// employer or title that the model fixes, with a resold record in the mix.
function showcase(list) {
  let best = null, bestS = -1;
  for (const p of list.slice(0, 9)) {
    let s = 0;
    for (const field of ['company', 'title']) {
      const it = p.f[field];
      if (!it) continue;
      const t = sim.truth[it.key];
      if (it.top === t && it.trust.value !== t) s += field === 'company' ? 6 : 4;
      if (it.obs.some(oi => A.res.weights[oi] < 1)) s += 1;
      s += Math.min(it.obs.length, 6) * 0.3;
    }
    if (p.inSeq) s += 2;
    if (p.minConf >= 0.6) s += 1;
    if (s > bestS) { bestS = s; best = p; }
  }
  return best;
}

function renderBanner() {
  const nDiff = A.items.filter(i => i.top !== i.trust.value).length;
  $('#banner').innerHTML = `<i data-lucide="sparkles"></i><span class="grow"><b>Field confidence is on.</b> ${fmt(A.N)} fields resolved from ${fmt(sim.observations.length)} assertions across ${SOURCES.length} sources. ${fmt(nDiff)} values differ from your trust hierarchy.</span><button class="link" id="to-src">View source reliability</button>`;
  $('#to-src').onclick = () => setTab('sources');
}

function renderPills() {
  $('#pills').innerHTML = FILTERS.map(([id, label, fn]) => `<button class="pill ${state.filter === id ? 'on' : ''}" data-f="${id}">${label}<span class="n">${fmt(people.filter(fn).length)}</span></button>`).join('');
  document.querySelectorAll('.pill').forEach(b => b.onclick = () => { state.filter = b.dataset.f; state.page = 0; renderPills(); renderRows(true); });
}

function coLogo(name) {
  const c = CO_COLORS[hash(name) % CO_COLORS.length];
  return `<span class="co-logo" style="background:${c}">${esc(name[0])}</span>`;
}

function renderRows(pickShowcase = false) {
  const list = visible();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const rows = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
  if (pickShowcase || state.sel === null || (state.sel >= 0 && !list.some(p => p.id === state.sel))) {
    const want = params.get('pid');
    const p = want !== null && pickShowcase && people.find(x => x.id === Number(want)) || showcase(rows) || rows[0];
    state.sel = p ? p.id : null;
  }
  $('#rows').innerHTML = rows.map((p, i) => {
    const t = p.f.title, c = p.f.company, e = p.f.email;
    const dot = it => it && it.top !== it.trust.value ? '<span class="changed" title="Differs from trust rules"></span>' : '';
    return `<tr data-id="${p.id}" class="${p.id === state.sel ? 'sel' : ''}">
      <td class="c-check"><span class="cb"></span></td>
      <td class="c-num">${state.page * PAGE + i + 1}</td>
      <td><div class="person"><span class="av">${esc(p.first[0])}</span><div class="pn"><div class="nm">${esc(p.name)}</div><div class="em">${esc(e ? e.top : '')}</div></div><span class="li">in</span><span class="ph"><i data-lucide="phone"></i></span></div></td>
      <td><div class="cell-v">${dot(t)}<span class="t">${esc(t ? t.top : '—')}</span></div></td>
      <td><div class="co">${c ? coLogo(c.top) : ''}${dot(c)}<span class="t">${esc(c ? c.top : '—')}</span></div></td>
      <td>${confChip(p.minConf)}</td>
      <td class="seen">${ago(p.lastSeen)}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#rows tr').forEach(tr => tr.onclick = () => { state.sel = Number(tr.dataset.id); renderRows(); });
  $('#pager').innerHTML = `<button id="pp"><i data-lucide="chevron-left"></i></button><span>${state.page + 1} / ${pages}</span><button id="pn"><i data-lucide="chevron-right"></i></button><span style="margin-left:8px">${fmt(list.length)} contacts</span>`;
  $('#pp').onclick = () => { if (state.page > 0) { state.page--; renderRows(); } };
  $('#pn').onclick = () => { if (state.page < pages - 1) { state.page++; renderRows(); } };
  renderDrawer();
  icons();
}

function srcChip(oi) {
  const o = sim.observations[oi];
  const w = A.res.weights[oi];
  const copy = w < 0.999;
  return `<span class="src ${copy ? 'copy' : ''}" title="${esc(SRC[o.src].name)} · observed ${ago(o.age)}${copy ? ' · counted as ' + w.toFixed(2) + ' of a vote (resold record)' : ''}"><span class="dot" style="background:${SRC_COLOR[o.src]}"></span>${esc(SRC[o.src].name)} <span class="age">${ago(o.age)}</span></span>`;
}

function fieldSection(it) {
  if (!it) return '';
  const label = FIELD_LABELS[it.field];
  const tr = it.trust;
  const ruleLine = it.top !== tr.value
    ? `<div class="f-rule"><i data-lucide="triangle-alert"></i><span>Trust rules show <b>${esc(tr.value)}</b> (${esc(SRC[sim.observations[tr.oi].src].name)}, ${ago(sim.observations[tr.oi].age)})</span></div>`
    : `<div class="f-ok">Matches your trust hierarchy</div>`;
  const cands = it.cands.slice(0, 3).map((c, k) => `<div class="cand ${k === 0 ? 'top' : ''}">
      <span class="cv" title="${esc(c.value)}">${esc(c.value)}</span><span class="cp">${pr(c.pCal)}</span>
      <span class="cb2"><i style="width:${Math.max(1, 100 * c.pCal).toFixed(1)}%"></i></span>
      <span class="srcs">${c.obs.sort((a, b) => sim.observations[a].age - sim.observations[b].age).map(srcChip).join('')}</span>
    </div>`).join('');
  const notes = [];
  const copied = it.obs.filter(oi => A.res.weights[oi] < 0.999);
  for (const oi of copied) {
    const o = sim.observations[oi];
    const cp = A.res.copies.find(c => c.to === o.src);
    if (cp) notes.push(`<div class="f-note"><i data-lucide="copy"></i><span>${esc(SRC[cp.to].name)} matches ${esc(SRC[cp.from].name)} here and resells about ${pct(cp.rate)} of its records, so it counts as ${A.res.weights[oi].toFixed(2)} of a vote.</span></div>`);
  }
  notes.push(`<div class="f-note"><i data-lucide="history"></i><span>Chance it changed after every source last looked: ${pr(it.pUnseenCal)}</span></div>`);
  return `<div class="fsec">
    <div class="f-row"><span class="f-label">${label}</span>${confChip(it.confCal)}</div>
    <div class="f-val">${esc(it.top)}</div>
    ${ruleLine}
    <div class="cands">${cands}</div>
    ${notes.join('')}
  </div>`;
}

function renderDrawer() {
  const p = people.find(x => x.id === state.sel);
  if (!p) { $('#drawer').innerHTML = '<div class="d-emptysel">Select a contact to see how each field was resolved.</div>'; return; }
  const nAssert = FIELDS.reduce((s, f) => s + (p.f[f] ? p.f[f].obs.length : 0), 0);
  $('#drawer').innerHTML = `
    <div class="d-head">
      <div class="d-top"><span class="d-av">${esc(p.first[0])}</span>
        <div><div class="d-name">${esc(p.name)}</div><div class="d-sub">${esc(p.f.title?.top || '')}${p.f.company ? ', ' + esc(p.f.company.top) : ''}</div></div>
        <div class="d-act"><span class="chip-link">Contact<i data-lucide="external-link"></i></span><button class="icon-btn ghost" title="Close" id="d-close"><i data-lucide="x"></i></button></div>
      </div>
    </div>
    <div class="d-tabs"><span class="on">Field confidence</span><span>Activity</span><span>Sequences${p.inSeq ? ' · 1' : ''}</span></div>
    <div class="d-body">${FIELD_ORDER.map(f => fieldSection(p.f[f])).join('')}</div>
    <div class="d-foot"><span class="grow">${nAssert} assertions from ${new Set(FIELDS.flatMap(f => p.f[f] ? p.f[f].obs.map(oi => sim.observations[oi].src) : [])).size} sources</span><button class="btn" id="d-src"><i data-lucide="gauge"></i>How sources are weighted</button></div>`;
  $('#d-src').onclick = () => setTab('sources');
  $('#d-close').onclick = () => { state.sel = -1; document.querySelectorAll('#rows tr.sel').forEach(r => r.classList.remove('sel')); $('#drawer').innerHTML = '<div class="d-emptysel">Select a contact to see how each field was resolved.</div>'; };
}

// ---------- Source reliability tab ----------

function reliabilitySVG(cal, raw) {
  const W = 300, H = 210, L = 34, B = 24, T = 8, R = 8;
  const x = v => L + v * (W - L - R), y = v => H - B - v * (H - B - T);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(g => `<line x1="${x(0)}" x2="${x(1)}" y1="${y(g)}" y2="${y(g)}" stroke="#edecea" stroke-dasharray="3 3"/><text x="${L - 6}" y="${y(g) + 3.5}" text-anchor="end" font-size="10" fill="#8d857c">${Math.round(g * 100)}%</text><text x="${x(g)}" y="${H - 7}" text-anchor="middle" font-size="10" fill="#8d857c">${Math.round(g * 100)}%</text>`).join('');
  const pts = c => c.bins.filter(b => b.n >= 15).map(b => [x(b.conf), y(b.acc), b.n]);
  const line = (ps, color, dash) => `<polyline points="${ps.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ''}/>` + ps.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${Math.min(5, 2 + Math.sqrt(p[2]) / 12)}" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">${grid}<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#c5c1bc" stroke-width="1"/>${line(pts(raw), '#c5c1bc', true)}${line(pts(cal), '#01a43e')}</svg>`;
}

function accCell(v) {
  if (v === null || v === undefined) return '<td class="num"><span class="muted">—</span></td>';
  const bg = v >= 0.93 ? '#28ab581f' : v >= 0.85 ? '#f3f2f1' : '#f9b80426';
  const col = v >= 0.93 ? '#18803f' : v >= 0.85 ? '#46423e' : '#94600a';
  return `<td class="num"><span class="acc" style="background:${bg};color:${col}">${pct(v)}</span></td>`;
}

function renderSources() {
  const n = A.N;
  const wrongTrust = n - Math.round(A.acc.trust * n), wrongLearned = n - Math.round(A.acc.learned * n);
  const sel90 = selective(A.items, sim.truth, 0.9);
  const counts = {};
  for (const o of sim.observations) counts[o.src] = (counts[o.src] || 0) + 1;
  const imp = agentImpact(sim, A);
  const seqWrongRule = imp.wrongRule, seqFixed = imp.fixed, emailWrongRule = imp.emailWrongRule, emailFixed = imp.emailFixed, nSeq = imp.n;
  const strategies = [
    ['Field confidence', A.acc.learned, true],
    ['Majority vote', A.acc.majority],
    ['Most recent wins', A.acc.recent],
    ['Trust hierarchy + recency', A.acc.trust],
  ];
  const copyOf = id => A.res.copies.find(c => c.to === id);
  const changeYears = f => (1 / A.res.lambda[f] / 365).toFixed(1);
  $('#view-sources').innerHTML = `<div class="src-view">
    <div class="kpis">
      <div class="kpi" style="--k:#01a43e"><div class="lbl">Wrong values vs trust rules</div><div class="v">−${pct(A.errorReduction)}</div><div class="s">${fmt(wrongLearned)} wrong instead of ${fmt(wrongTrust)}, out of ${fmt(n)} fields</div></div>
      <div class="kpi" style="--k:#3787e8"><div class="lbl">When it says 90%+</div><div class="v">${pct(sel90.acc, 1)} <small>right</small></div><div class="s">${pct(sel90.coverage)} of fields; calibration error ${(100 * A.calCal.ece).toFixed(1)} pts on held-out fields</div></div>
      <div class="kpi" style="--k:#f9b804"><div class="lbl">Sequenced contacts fixed</div><div class="v">${fmt(seqFixed)} <small>of ${fmt(seqWrongRule)}</small></div><div class="s">Of ${fmt(nSeq)} contacts in sequences, trust rules give ${fmt(seqWrongRule)} a wrong title or employer. Wrong addresses: ${fmt(emailFixed)} of ${fmt(emailWrongRule)} fixed.</div></div>
    </div>
    <div class="panel">
      <div class="ph"><span class="lbl">Sources, as learned from this workspace</span><span class="r">EM over all ${fmt(sim.observations.length)} assertions, no labels</span></div>
      <table class="stbl">
        <thead><tr><th>Source</th><th class="num">Assertions</th><th class="num">Title</th><th class="num">Company</th><th class="num">Email</th><th class="num">Location</th><th class="num">Lag</th><th>Notes</th></tr></thead>
        <tbody>${TRUST_ORDER.map((id, rank) => {
          const s = SRC[id], cp = copyOf(id);
          return `<tr><td><div class="sname"><span class="dot" style="background:${SRC_COLOR[id]}"></span><div><div>${esc(s.name)}</div><div class="k">${esc(s.kind)}</div></div></div></td>
            <td class="num">${fmt(counts[id] || 0)}</td>
            ${['title', 'company', 'email', 'location'].map(f => accCell(A.res.A[id][f])).join('')}
            <td class="num">${A.res.lag[id] ? '~' + A.res.lag[id] + ' days' : '<span class="muted">current</span>'}</td>
            <td>${cp ? `<span class="tag warn">Resells ${esc(SRC[cp.from].name)} · ${pct(cp.rate)}</span>` : `<span class="tag">Trust rank ${rank + 1}</span>`}</td></tr>`;
        }).join('')}</tbody>
      </table>
      <div class="hint" style="margin-top:8px">Accuracy is the chance a source's value was right when it captured it. Age is handled separately: titles change about every ${changeYears('title')} years and employers every ${changeYears('company')} in this workspace, so an old value is discounted by how long ago it was seen plus how far behind the source runs.</div>
    </div>
    <div class="row2">
      <div class="panel">
        <div class="ph"><span class="lbl">Right today, by strategy</span><span class="r">Simulator truth</span></div>
        <div class="bars">${strategies.map(([name, v, me]) => `<div class="b ${me ? 'me' : ''}"><span>${name}</span><span class="track"><i style="width:${(100 * v).toFixed(1)}%"></i></span><span class="p">${pct(v, 1)}</span></div>`).join('')}</div>
        <div class="hint">${pct(A.stale.unseen / n, 1)} of fields have a current value no source has reported yet, so 100% is not reachable. Field confidence also beats the best single rule (${A.bestRule === 'recent' ? 'most recent wins' : 'trust hierarchy'}) by ${pct(A.errorReductionVsBestRule)} fewer errors.</div>
      </div>
      <div class="panel">
        <div class="ph"><span class="lbl">Does 80% mean 80%?</span><span class="r">${fmt(A.nTest)} held-out fields</span></div>
        ${reliabilitySVG(A.calCal, A.calRaw)}
        <div class="legend"><span><i style="background:#01a43e"></i>Calibrated (${fmt(A.nTrain)} verified fields, T = ${A.T.toFixed(2)})</span><span><i style="background:#c5c1bc"></i>Raw posterior</span></div>
      </div>
    </div>
  </div>`;
  icons();
}

function setTab(t) {
  state.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#view-contacts').classList.toggle('hidden', t !== 'contacts');
  $('#view-sources').classList.toggle('hidden', t !== 'sources');
  $('#view-empty').classList.toggle('hidden', t === 'contacts' || t === 'sources');
  if (t === 'sources') renderSources();
}

function start() {
  build();
  renderBanner();
  renderPills();
  renderRows(true);
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('#q').oninput = e => { state.q = e.target.value; state.page = 0; renderRows(); };
  setTab(state.tab);
  $('#loading').classList.add('done');
  icons();
  window.__ready = true;
}

const t0 = performance.now();
start();
window.__ms = Math.round(performance.now() - t0);
