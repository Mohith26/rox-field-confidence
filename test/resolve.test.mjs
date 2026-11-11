import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SOURCES, FIELDS, TRUST_ORDER } from '../core/simulate.js';
import {
  resolve, analyze, itemTerms, itemPosterior, itemLogZ, groupItems, DEFAULTS,
  chooseByTrust, chooseMostRecent, chooseMajority, fitTemperature, calibration, selective,
} from '../core/resolve.js';

const IDS = SOURCES.map(s => s.id);
const cache = new Map();
const run = (seed, opts = {}) => {
  const k = seed + JSON.stringify(opts);
  if (!cache.has(k)) { const sim = simulate(seed); cache.set(k, { sim, a: analyze(sim, IDS, FIELDS, TRUST_ORDER, opts) }); }
  return cache.get(k);
};

test('simulator is deterministic and realistic in shape', () => {
  const a = simulate(7), b = simulate(7), c = simulate(8);
  assert.equal(a.observations.length, b.observations.length);
  assert.deepEqual(a.observations.slice(0, 50), b.observations.slice(0, 50));
  assert.notDeepEqual(a.observations.slice(0, 50), c.observations.slice(0, 50));
  assert.equal(a.people.length, 2000);
  // the web source never asserts emails; every source asserts something
  assert.ok(!a.observations.some(o => o.src === 'web' && o.field === 'email'));
  for (const s of IDS) assert.ok(a.observations.some(o => o.src === s));
  // Provider B resells most of Provider A's records
  const copied = a.observations.filter(o => o.src === 'pb' && o.copied).length / a.observations.filter(o => o.src === 'pb').length;
  assert.ok(copied > 0.6 && copied < 0.9, String(copied));
});

// Independent brute-force enumeration of the change-point model for one item.
function bruteLogZ(item, obs, A, lag, lam, nF) {
  const vals = item.values, m = vals.length, N = Math.max(nF, m + 1);
  const os = item.obs.map(oi => ({ ...obs[oi], e: obs[oi].age + (lag[obs[oi].src] || 0) })).sort((x, y) => x.e - y.e);
  const n = os.length;
  const P = (o, c) => { const a = A[o.src][item.field]; return c >= 0 && o.value === vals[c] ? a : (1 - a) / (N - 1); };
  let total = 0;
  for (let k = 0; k <= n; k++) {
    const lo = k === 0 ? 0 : os[k - 1].e, hi = k < n ? os[k].e : Infinity;
    const pTau = Math.exp(-lam * lo) - (isFinite(hi) ? Math.exp(-lam * hi) : 0);
    const vs = k === 0 ? [-1] : [...vals.keys(), -1];
    for (const v of vs) {
      const pv = v === -1 ? (N - m) / N : 1 / N;
      let fresh = 1;
      for (let j = 0; j < k; j++) fresh *= P(os[j], v);
      if (k === n) { total += pTau * pv * fresh; continue; }
      for (const u of [...vals.keys(), -1]) {
        if (u === v && u !== -1) continue;
        const pu = u === -1 ? (N - m) / N : 1 / N;
        let stale = 1;
        for (let j = k; j < n; j++) stale *= P(os[j], u);
        total += pTau * pv * fresh * pu * stale;
      }
    }
  }
  return Math.log(total);
}

test('item likelihood matches brute-force enumeration and posteriors sum to 1', () => {
  const obs = [
    { pid: 0, field: 'title', src: 'crm', value: 'VP of Sales', age: 700 },
    { pid: 0, field: 'title', src: 'pa', value: 'VP of Sales', age: 40 },
    { pid: 0, field: 'title', src: 'pc', value: 'Chief Revenue Officer', age: 10 },
    { pid: 0, field: 'title', src: 'web', value: 'Chief Revenue Officer', age: 20 },
    { pid: 0, field: 'title', src: 'csv', value: 'Director of Sales', age: 520 },
  ];
  const [item] = groupItems(obs);
  const A = { crm: { title: 0.93 }, pa: { title: 0.84 }, pc: { title: 0.74 }, web: { title: 0.88 }, csv: { title: 0.8 } };
  const lag = { pa: 90, pc: 30 };
  const w = new Float64Array(obs.length).fill(1);
  for (const lam of [1 / 300, 1 / 1000, 1 / 5000]) {
    const T = itemTerms(item, obs, A, lag, w, DEFAULTS);
    assert.ok(Math.abs(itemLogZ(T, lam) - bruteLogZ(item, obs, A, lag, lam, DEFAULTS.nFalse.title)) < 1e-9);
    const P = itemPosterior(T, lam);
    const s = P.pv.reduce((a, b) => a + b, 0) + P.pUnseen + P.pOther;
    assert.ok(Math.abs(s - 1) < 1e-9);
  }
  // two fresh sources saying CRO beat a 700-day-old CRM entry and a lagged provider
  const P = itemPosterior(itemTerms(item, obs, A, lag, w, DEFAULTS), 1 / 1000);
  assert.equal(item.values[P.pv.indexOf(Math.max(...P.pv))], 'Chief Revenue Officer');
});

test('stale agreement is not treated as independent evidence', () => {
  // three old sources agree on an old employer; one fresh, accurate source disagrees
  const obs = [
    { pid: 0, field: 'company', src: 'crm', value: 'Old Co', age: 800 },
    { pid: 0, field: 'company', src: 'csv', value: 'Old Co', age: 520 },
    { pid: 0, field: 'company', src: 'pa', value: 'Old Co', age: 400 },
    { pid: 0, field: 'company', src: 'mail', value: 'New Co', age: 12 },
  ];
  const [item] = groupItems(obs);
  const A = { crm: { company: 0.99 }, csv: { company: 0.95 }, pa: { company: 0.95 }, mail: { company: 0.995 } };
  const w = new Float64Array(obs.length).fill(1);
  const P = itemPosterior(itemTerms(item, obs, A, {}, w, DEFAULTS), 1 / 1000);
  assert.equal(item.values[P.pv.indexOf(Math.max(...P.pv))], 'New Co');
  // majority vote and the trust hierarchy both keep the old employer
  assert.equal(chooseMajority(item, obs, TRUST_ORDER).value, 'Old Co');
  assert.equal(chooseByTrust(item, obs, TRUST_ORDER).value, 'Old Co');
  assert.equal(chooseMostRecent(item, obs, TRUST_ORDER).value, 'New Co');
});

test('baselines follow their definitions', () => {
  const obs = [
    { pid: 1, field: 'title', src: 'pa', value: 'X', age: 5 },
    { pid: 1, field: 'title', src: 'crm', value: 'Y', age: 300 },
    { pid: 1, field: 'title', src: 'pb', value: 'X', age: 2 },
  ];
  const [item] = groupItems(obs);
  assert.equal(chooseByTrust(item, obs, TRUST_ORDER).value, 'Y');
  assert.equal(chooseMostRecent(item, obs, TRUST_ORDER).value, 'X');
  assert.equal(chooseMajority(item, obs, TRUST_ORDER).value, 'X');
});

test('EM finds the reseller (and only it) and learns plausible source behavior', () => {
  const { a } = run(20261110);
  assert.equal(a.res.copies.length, 1);
  assert.equal(a.res.copies[0].from, 'pa');
  assert.equal(a.res.copies[0].to, 'pb');
  assert.ok(a.res.copies[0].rate > 0.55 && a.res.copies[0].rate < 0.9);
  // capture accuracy: CRM and email signatures beat the realtime provider on titles
  assert.ok(a.res.A.crm.title > a.res.A.pc.title + 0.08);
  assert.ok(a.res.A.mail.email > a.res.A.pc.email + 0.1);
  // the quarterly provider runs behind reality; the CRM and mailbox do not
  assert.ok(a.res.lag.pa >= 60 && a.res.lag.pb >= a.res.lag.pa);
  assert.equal(a.res.lag.crm, 0);
  assert.equal(a.res.A.web.email, null);
  // learned change rates are in a plausible range (1.5 to 6 years)
  for (const f of FIELDS) { const d = 1 / a.res.lambda[f]; assert.ok(d > 500 && d < 2200, f + ' ' + d); }
});

test('learned resolution beats every rule on three seeds', () => {
  for (const seed of [20261110, 3, 11]) {
    const { a } = run(seed);
    assert.ok(a.acc.learned > a.acc.trust + 0.15, seed + ' vs trust');
    assert.ok(a.acc.learned > a.acc.recent + 0.04, seed + ' vs recent');
    assert.ok(a.acc.learned > a.acc.majority + 0.04, seed + ' vs majority');
    assert.ok(a.errorReduction > 0.45, seed + ' reduction ' + a.errorReduction);
  }
});

test('both copy discounting and lag learning contribute', () => {
  const full = run(20261110).a.acc.learned;
  const noCopy = run(20261110, { copy: false }).a.acc.learned;
  const noLag = run(20261110, { lagGrid: [0] }).a.acc.learned;
  assert.ok(full > noCopy + 0.01, `${full} ${noCopy}`);
  assert.ok(full > noLag + 0.005, `${full} ${noLag}`);
});

test('confidence is calibrated out of sample and the fit uses only labeled items', () => {
  for (const seed of [20261110, 3]) {
    const { sim, a } = run(seed);
    assert.ok(a.calCal.ece < 0.04, seed + ' ece ' + a.calCal.ece);
    const sel = selective(a.items, sim.truth, 0.9);
    assert.ok(sel.acc >= 0.9 && sel.coverage > 0.25, JSON.stringify(sel));
  }
  // T depends only on labeled pairs
  const pairs = [{ p: 0.9, y: true }, { p: 0.8, y: false }, { p: 0.95, y: true }, { p: 0.6, y: true }];
  assert.equal(fitTemperature(pairs), fitTemperature(pairs.slice()));
  const cal = calibration([{ p: 0.95, y: true }, { p: 0.95, y: false }]);
  assert.ok(Math.abs(cal.ece - 0.45) < 1e-9);
});

test('resolve() is deterministic', () => {
  const sim = simulate(5, { people: 300 });
  const r1 = resolve(sim.observations, IDS, FIELDS), r2 = resolve(sim.observations, IDS, FIELDS);
  assert.deepEqual(r1.items.map(i => i.top), r2.items.map(i => i.top));
  assert.deepEqual(r1.lag, r2.lag);
});

test('agent impact counts are consistent with the item-level results', async () => {
  const { agentImpact } = await import('../core/impact.js');
  const { sim, a } = run(20261110);
  const imp = agentImpact(sim, a);
  assert.equal(imp.n, sim.inSequence.length);
  assert.ok(imp.fixed <= imp.wrongRule && imp.emailFixed <= imp.emailWrongRule);
  assert.ok(imp.fixed / imp.wrongRule > 0.5, JSON.stringify(imp));
});
