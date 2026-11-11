// Field confidence: learned conflict resolution for contact data.
//
// Input: every assertion a source has made about a contact field
//   {pid, field, src, value, age}   (age = days since the source observed it)
// Output: for each (contact, field) a posterior over the asserted values plus an
// "unseen" option (the value changed after every source last looked), the
// learned accuracy of every source on every field, how far behind reality each
// source runs, how often each field changes, and which sources copy each other.
//
// Model (a change-point model fit by EM; no labels needed):
//   tau ~ Exponential(lambda[f])     time since the field last changed
//   a source observed the contact e = age + lag[s] days "ago" in world time
//   if e < tau the observation is fresh: it shows today's value with
//       probability A[s][f], otherwise a capture error (1 of nFalse[f] values)
//   if e >= tau it is stale: it shows a previous value (one of the other
//       asserted values), so honest sources that all saw the old employer
//       agree with each other without that agreement counting as evidence
//   if tau is newer than every observation, today's value is "unseen"
// Copying: sources whose fresh records agree on likely-false values far beyond
// the background rate are flagged, and the copier's agreeing votes are
// discounted (tempered likelihood).

export const DEFAULTS = {
  iters: 12,
  nFalse: { title: 20, company: 40, email: 6, location: 20 },
  lagGrid: [0, 30, 60, 90, 120, 180, 240],
  lagEvery: 3,
  lagStart: 5,
  lagSampleRate: 0.35,
  copy: true,
  copyPrior: 0.05,
  copyStart: 4,
  copyMaxAge: 200,
  copyMinRate: 0.2,
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = p => Math.log(p / (1 - p));
const sigmoid = z => 1 / (1 + Math.exp(-z));

export function groupItems(observations) {
  const items = new Map();
  observations.forEach((o, i) => {
    const key = o.pid + ':' + o.field;
    let it = items.get(key);
    if (!it) { it = { key, pid: o.pid, field: o.field, obs: [], values: [] }; items.set(key, it); }
    it.obs.push(i);
    if (!it.values.includes(o.value)) it.values.push(o.value);
  });
  return [...items.values()];
}

function golden(f, lo, hi, iters = 40) {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

// Likelihood terms for one item that do not depend on lambda.
// Observations are sorted freshest first by effective age e = age + lag[src].
// Interval k (tau in [e_k, e_k+1), e_0 = 0): the k freshest observations were
// made after the last change and show today's value v; the rest are stale and
// show the previous value u. Values (v and u) have a uniform prior over a
// universe of N = nFalse[f] values; "other" stands for any value no source
// asserted. For k = 0 today's value is unseen.
// hyps: [{k, v, u, l}] with v/u = candidate index or -1 for "other".
export function itemTerms(item, obs, A, lag, w, opts) {
  const f = item.field, vals = item.values, m = vals.length, N = Math.max(opts.nFalse[f] ?? 20, m + 1);
  const order = item.obs.map(oi => ({ oi, e: obs[oi].age + (lag[obs[oi].src] || 0) })).sort((x, y) => x.e - y.e);
  const n = order.length;
  const ages = order.map(x => x.e);
  // ll[j][c]: log P(obs j | the value at its time is candidate c); c = m means "other"
  const ll = order.map(({ oi }) => {
    const o = obs[oi], a = clamp(A[o.src][f], 0.02, 0.999), wo = w[oi];
    const wrong = Math.log((1 - a) / (N - 1));
    const row = vals.map(v => wo * (o.value === v ? Math.log(a) : wrong));
    row.push(wo * wrong);
    return row;
  });
  const logPrior = -Math.log(N), logOther = Math.log((N - m) / N);
  const hyps = [];
  // prefix sums: pre[k][c] = sum of ll[j][c] for j < k
  const pre = [new Float64Array(m + 1)];
  for (let j = 0; j < n; j++) { const r = new Float64Array(m + 1); for (let c = 0; c <= m; c++) r[c] = pre[j][c] + ll[j][c]; pre.push(r); }
  for (let k = 0; k <= n; k++) {
    // fresh part (first k) per v, stale part (rest) per u
    const F = pre[k], S = new Float64Array(m + 1);
    for (let c = 0; c <= m; c++) S[c] = pre[n][c] - pre[k][c];
    const vList = k === 0 ? [m] : [...Array(m + 1).keys()];
    for (const v of vList) {
      const lv = (v === m ? logOther : logPrior) + F[v];
      if (k === n) { hyps.push({ k, v: v === m ? -1 : v, u: -2, l: lv }); continue; }
      for (let u = 0; u <= m; u++) {
        if (u === v && u !== m) continue; // the previous value differs from today's
        hyps.push({ k, v: v === m ? -1 : v, u: u === m ? -1 : u, l: lv + (u === m ? logOther : logPrior) + S[u] });
      }
    }
  }
  // per-interval log-sum-exp (lambda-free part), for fast lambda search
  const C = new Array(n + 1).fill(-Infinity);
  for (const h of hyps) if (h.l > C[h.k]) C[h.k] = h.l;
  const acc = new Array(n + 1).fill(0);
  for (const h of hyps) acc[h.k] += Math.exp(h.l - C[h.k]);
  for (let k = 0; k <= n; k++) C[k] += Math.log(acc[k]);
  return { ages, order, hyps, C, m, n };
}

function lse2(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const mx = Math.max(a, b);
  return mx + Math.log(Math.exp(a - mx) + Math.exp(b - mx));
}

// log P(tau in [x, y)) under Exponential(lambda)
function logIntervalProb(lam, x, y) {
  if (!isFinite(y)) return -lam * x;
  return -lam * x + Math.log(-Math.expm1(-lam * (y - x)) + 1e-300);
}

function intervalLogs(T, lam) {
  const { ages, n } = T;
  const out = [];
  for (let k = 0; k <= n; k++) out.push(logIntervalProb(lam, k === 0 ? 0 : ages[k - 1], k < n ? ages[k] : Infinity));
  return out;
}

export function itemLogZ(T, lam) {
  const P = intervalLogs(T, lam);
  let z = -Infinity;
  for (let k = 0; k <= T.n; k++) z = lse2(z, P[k] + T.C[k]);
  return z;
}

// Posterior summaries for one item.
export function itemPosterior(T, lam) {
  const P = intervalLogs(T, lam);
  let logZ = -Infinity;
  for (let k = 0; k <= T.n; k++) logZ = lse2(logZ, P[k] + T.C[k]);
  const pv = new Array(T.m).fill(0), pk = new Array(T.n + 1).fill(0);
  let pUnseen = 0, pOther = 0;
  const hp = new Float64Array(T.hyps.length);
  T.hyps.forEach((h, i) => {
    const p = Math.exp(P[h.k] + h.l - logZ);
    hp[i] = p;
    pk[h.k] += p;
    if (h.v >= 0) pv[h.v] += p; else if (h.k === 0) pUnseen += p; else pOther += p;
  });
  return { pv, pUnseen, pOther, pk, logZ, hp };
}

export function resolve(observations, sourceIds, fields, userOpts = {}) {
  const opts = { ...DEFAULTS, ...userOpts, nFalse: { ...DEFAULTS.nFalse, ...(userOpts.nFalse || {}) } };
  const items = groupItems(observations);
  const A = {}, lam = {}, lag = {};
  for (const s of sourceIds) { A[s] = {}; lag[s] = 0; for (const f of fields) A[s][f] = 0.8; }
  for (const f of fields) lam[f] = 1 / 1000;
  const w = new Float64Array(observations.length).fill(1);
  const z = new Float64Array(observations.length); // P(observation shows today's value)
  const q = new Float64Array(observations.length); // P(observation is fresh)
  const zc = new Float64Array(observations.length); // P(observation matches the value true when it was made)
  const lagRng = (() => { let x = 12345; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  const lagSample = items.map((_, j) => j).filter(() => lagRng() < opts.lagSampleRate);
  let terms = [], posts = [];
  let copies = [];
  const present = {};
  for (const o of observations) (present[o.src] ||= new Set()).add(o.field);

  const eStep = () => {
    terms = items.map(it => itemTerms(it, observations, A, lag, w, opts));
    posts = items.map((it, j) => itemPosterior(terms[j], lam[it.field]));
    items.forEach((it, j) => {
      const T = terms[j], P = posts[j];
      T.order.forEach(({ oi }, jj) => {
        const vi = it.values.indexOf(observations[oi].value);
        let fr = 0, cur = 0, cor = 0;
        T.hyps.forEach((h, hi) => {
          const p = P.hp[hi];
          if (h.k > jj) { fr += p; if (h.v === vi) { cur += p; cor += p; } }
          else if (h.u === vi) cor += p;
        });
        q[oi] = fr; z[oi] = cur; zc[oi] = cor;
      });
    });
  };

  const mStep = (iter) => {
    // accuracy: expected share of observations that match the value true at their time
    const num = {}, den = {};
    observations.forEach((o, i) => {
      const k = o.src + '|' + o.field;
      num[k] = (num[k] || 0) + zc[i]; den[k] = (den[k] || 0) + 1;
    });
    for (const k in num) {
      const [s, f] = k.split('|');
      A[s][f] = clamp((num[k] + 1) / (den[k] + 2), 0.02, 0.999);
    }
    terms = items.map(it => itemTerms(it, observations, A, lag, w, opts));
    // change rate per field: maximize the marginal likelihood
    for (const f of fields) {
      const idx = [];
      items.forEach((it, j) => { if (it.field === f) idx.push(j); });
      const ll = logl => { const l = Math.exp(logl); let t = 0; for (const j of idx) t += itemLogZ(terms[j], l); return t; };
      lam[f] = Math.exp(golden(ll, Math.log(1e-4), Math.log(2e-2), 30));
    }
    // source lag (days behind reality): coordinate search on a grid, on a fixed sample of items
    if (iter >= opts.lagStart && (iter - opts.lagStart) % opts.lagEvery === 0) {
      for (const s of sourceIds) {
        const idx = lagSample.filter(j => items[j].obs.some(oi => observations[oi].src === s));
        let best = lag[s], bestLL = -Infinity;
        for (const g of opts.lagGrid) {
          lag[s] = g;
          let t = 0;
          for (const j of idx) t += itemLogZ(itemTerms(items[j], observations, A, lag, w, opts), lam[items[j].field]);
          if (t > bestLL) { bestLL = t; best = g; }
        }
        lag[s] = best;
      }
    }
  };

  const detectCopies = () => {
    // For each ordered pair (s, t): among items where s's value is likely false,
    // how often does t report the exact same value? Compare with how often t
    // matches other sources' likely-false values (stale values are shared by
    // honest sources too, so the background rate is not zero).
    const byItem = items.map(it => {
      const m = {};
      for (const oi of it.obs) m[observations[oi].src] = oi;
      return m;
    });
    const agree = {}, total = {}, ageDiff = {};
    const key = (s, t) => s + '>' + t;
    for (const m of byItem) {
      // only fresh observations: a fresh wrong value is a capture error, and
      // independent sources rarely make the same capture error. (Old wrong
      // values are usually a previous true value, which honest sources share.)
      const srcs = Object.keys(m).filter(s => observations[m[s]].age <= opts.copyMaxAge);
      for (const s of srcs) {
        if (z[m[s]] >= 0.25) continue;
        for (const t of srcs) {
          if (t === s) continue;
          const k = key(s, t);
          total[k] = (total[k] || 0) + 1;
          if (observations[m[t]].value === observations[m[s]].value) {
            agree[k] = (agree[k] || 0) + 1;
            (ageDiff[k] ||= []).push(observations[m[t]].age - observations[m[s]].age);
          }
        }
      }
    }
    const found = [];
    for (const s of sourceIds) for (const t of sourceIds) {
      if (s === t) continue;
      const n = total[key(s, t)] || 0;
      if (n < 30) continue;
      const a = agree[key(s, t)] || 0;
      let bn = 0, ba = 0;
      for (const u of sourceIds) {
        if (u === s || u === t) continue;
        bn += total[key(u, t)] || 0; ba += agree[key(u, t)] || 0;
      }
      const b = clamp(bn ? ba / bn : 0.05, 0.01, 0.95);
      const r = a / n;
      const c = clamp((r - b) / (1 - b), 0, 0.99);
      if (c < opts.copyMinRate) continue;
      const logBF = a * Math.log((c + (1 - c) * b) / b) + (n - a) * Math.log(1 - c) - 0.5 * Math.log(n);
      const p = sigmoid(logBF + logit(opts.copyPrior));
      if (p < 0.5) continue;
      // direction: the copier's matching records were observed later (smaller age)
      const d = (ageDiff[key(s, t)] || []).slice().sort((x, y) => x - y);
      const med = d.length ? d[Math.floor(d.length / 2)] : 0;
      found.push({ from: med <= 0 ? s : t, to: med <= 0 ? t : s, rate: c, p, n, agree: a, base: b });
    }
    // keep one entry per unordered pair (the stronger)
    const best = {};
    for (const e of found) {
      const k = [e.from, e.to].sort().join('|');
      if (!best[k] || e.p * e.rate > best[k].p * best[k].rate) best[k] = e;
    }
    copies = Object.values(best);
    w.fill(1);
    for (let j = 0; j < items.length; j++) {
      const m = byItem[j];
      for (const e of copies) {
        if (m[e.from] === undefined || m[e.to] === undefined) continue;
        if (observations[m[e.to]].value === observations[m[e.from]].value) w[m[e.to]] = 1 - e.rate * e.p;
      }
    }
  };

  for (let it = 0; it < opts.iters; it++) {
    eStep();
    mStep(it);
    if (opts.copy && it >= opts.copyStart) detectCopies();
  }
  eStep();

  // Drop parameters for (source, field) pairs with no data
  for (const s of sourceIds) for (const f of fields) if (!present[s] || !present[s].has(f)) A[s][f] = null;

  const out = items.map((it, j) => {
    const P = posts[j];
    const cands = it.values.map((v, k) => ({ value: v, p: P.pv[k], obs: it.obs.filter(oi => observations[oi].value === v) }))
      .sort((a, b) => b.p - a.p);
    return { key: it.key, pid: it.pid, field: it.field, cands, pUnseen: P.pUnseen + P.pOther, top: cands[0].value, conf: cands[0].p, obs: it.obs };
  });
  return { items: out, A, lambda: lam, lag, copies, weights: w, z, q, zc };
}

// ---- Baselines -----------------------------------------------------------

// "Canonical value is chosen based on trust and recency": highest-trust source
// that has an assertion wins; recency breaks ties within a source.
export function chooseByTrust(item, observations, trustOrder) {
  let best = null;
  for (const oi of item.obs) {
    const o = observations[oi];
    const r = trustOrder.indexOf(o.src);
    if (!best || r < best.r || (r === best.r && o.age < best.age)) best = { r, age: o.age, value: o.value, oi };
  }
  return best;
}

export function chooseMostRecent(item, observations, trustOrder) {
  let best = null;
  for (const oi of item.obs) {
    const o = observations[oi];
    const r = trustOrder.indexOf(o.src);
    if (!best || o.age < best.age || (o.age === best.age && r < best.r)) best = { r, age: o.age, value: o.value, oi };
  }
  return best;
}

export function chooseMajority(item, observations, trustOrder) {
  const tally = new Map();
  for (const oi of item.obs) {
    const o = observations[oi];
    const r = trustOrder.indexOf(o.src);
    const t = tally.get(o.value) || { n: 0, r: 99 };
    tally.set(o.value, { n: t.n + 1, r: Math.min(t.r, r) });
  }
  let best = null;
  for (const [value, t] of tally) if (!best || t.n > best.n || (t.n === best.n && t.r < best.r)) best = { value, ...t };
  return best;
}

// ---- Calibration ---------------------------------------------------------

// Temperature scaling on the top value's log-odds, fit on a small labeled set
// (in Rox: rep corrections, delivered/bounced emails). Returns T.
export function fitTemperature(pairs) {
  const nll = logT => {
    const T = Math.exp(logT);
    let s = 0;
    for (const { p, y } of pairs) {
      const q = clamp(sigmoid(logit(clamp(p, 1e-6, 1 - 1e-6)) / T), 1e-6, 1 - 1e-6);
      s -= y ? Math.log(q) : Math.log(1 - q);
    }
    return -s;
  };
  return Math.exp(golden(nll, Math.log(0.3), Math.log(6)));
}

export function applyTemperature(p, T) {
  return sigmoid(logit(clamp(p, 1e-6, 1 - 1e-6)) / T);
}

// Multi-class temperature scaling of a whole posterior vector (candidates + unseen):
// q_i proportional to p_i^(1/T). Fit T by minimizing the negative log-probability
// of the verified value on the labeled items only.
export function temper(probs, T) {
  const lp = probs.map(p => Math.log(Math.max(p, 1e-12)) / T);
  const mx = Math.max(...lp);
  const e = lp.map(x => Math.exp(x - mx));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / z);
}

export function fitTemperatureMulti(rows) {
  // rows: [{probs: [...], y: index of the verified value}]
  const nll = logT => {
    const T = Math.exp(logT);
    let s = 0;
    for (const r of rows) s -= Math.log(Math.max(temper(r.probs, T)[r.y], 1e-12));
    return -s;
  };
  return Math.exp(golden(nll, Math.log(0.3), Math.log(8)));
}

// Expected calibration error over equal-width bins; also returns the bins.
export function calibration(pairs, nBins = 10) {
  const bins = Array.from({ length: nBins }, (_, i) => ({ lo: i / nBins, hi: (i + 1) / nBins, n: 0, conf: 0, acc: 0 }));
  for (const { p, y } of pairs) {
    const b = bins[Math.min(nBins - 1, Math.floor(p * nBins))];
    b.n++; b.conf += p; b.acc += y ? 1 : 0;
  }
  let ece = 0;
  const N = pairs.length || 1;
  for (const b of bins) if (b.n) { b.conf /= b.n; b.acc /= b.n; ece += (b.n / N) * Math.abs(b.acc - b.conf); }
  return { ece, bins };
}

// ---- Full pipeline used by the page, the report script and the tests ----

export function analyze(sim, sourceIds, fields, trustOrder, userOpts = {}) {
  const { observations, truth } = sim;
  const res = resolve(observations, sourceIds, fields, userOpts);
  const labeled = new Set(sim.labeled);
  // posterior vector per item: candidates in display order, then "unseen"
  const vec = it => [...it.cands.map(c => c.p), it.pUnseen];
  const yIndex = (it, t) => { const k = it.cands.findIndex(c => c.value === t); return k >= 0 ? k : it.cands.length; };
  const trainRows = [], testRaw = [], testCal = [];
  for (const it of res.items) if (labeled.has(it.key)) trainRows.push({ probs: vec(it), y: yIndex(it, truth[it.key]) });
  const T = fitTemperatureMulti(trainRows);
  for (const it of res.items) {
    const q = temper(vec(it), T);
    it.cands.forEach((c, k) => { c.pCal = q[k]; });
    it.pUnseenCal = q[q.length - 1];
    it.confCal = q[0];
    if (!labeled.has(it.key)) {
      const y = truth[it.key] === it.top;
      testRaw.push({ p: it.conf, y });
      testCal.push({ p: it.confCal, y });
    }
  }
  const trainPairs = trainRows;
  // score every strategy against simulator truth
  const strategies = { learned: 0, trust: 0, recent: 0, majority: 0 };
  const byField = {};
  const itemsByKey = {};
  const contested = { n: 0, learned: 0, trust: 0 };
  let unseen = 0, flagged = 0, flaggedRight = 0, unseenFlagged = 0;
  for (const it of res.items) {
    itemsByKey[it.key] = it;
    const t = truth[it.key];
    const grp = { obs: it.obs };
    it.trust = chooseByTrust(grp, observations, trustOrder);
    it.recent = chooseMostRecent(grp, observations, trustOrder);
    it.majority = chooseMajority(grp, observations, trustOrder);
    const bf = (byField[it.field] ||= { n: 0, learned: 0, trust: 0, recent: 0, majority: 0 });
    bf.n++;
    for (const [k, v] of [['learned', it.top], ['trust', it.trust.value], ['recent', it.recent.value], ['majority', it.majority.value]]) {
      if (v === t) { strategies[k]++; bf[k]++; }
    }
    if (it.cands.length > 1) { contested.n++; if (it.top === t) contested.learned++; if (it.trust.value === t) contested.trust++; }
    const isUnseen = !it.cands.some(c => c.value === t);
    if (isUnseen) unseen++;
    if (it.pUnseen >= 0.5) { flagged++; if (isUnseen) flaggedRight++; }
    if (isUnseen && it.pUnseen >= 0.5) unseenFlagged++;
  }
  const N = res.items.length;
  const acc = Object.fromEntries(Object.entries(strategies).map(([k, v]) => [k, v / N]));
  const errTrust = 1 - acc.trust, errLearned = 1 - acc.learned, errRecent = 1 - acc.recent;
  const bestRule = errTrust <= errRecent ? 'trust' : 'recent';
  const errBestRule = Math.min(errTrust, errRecent);
  return {
    res, T, items: res.items, itemsByKey, N, acc, byField, contested,
    errorReduction: 1 - errLearned / errTrust,
    errorReductionVsBestRule: 1 - errLearned / errBestRule, bestRule,
    calRaw: calibration(testRaw), calCal: calibration(testCal),
    nTrain: trainPairs.length, nTest: testCal.length,
    stale: { unseen, flagged, flaggedRight, unseenFlagged, precision: flagged ? flaggedRight / flagged : 0, recall: unseen ? unseenFlagged / unseen : 0 },
  };
}

// Selective accuracy: of the values at or above a confidence threshold, how many are right
export function selective(items, truth, thr) {
  let n = 0, right = 0;
  for (const it of items) if (it.confCal >= thr) { n++; if (truth[it.key] === it.top) right++; }
  return { n, right, acc: n ? right / n : 0, coverage: n / items.length };
}
