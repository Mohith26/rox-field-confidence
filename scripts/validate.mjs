// Re-run the whole pipeline on freshly simulated orgs and report medians [min, max].
import { simulate, SOURCES, FIELDS, TRUST_ORDER } from '../core/simulate.js';
import { analyze, selective } from '../core/resolve.js';
const n = Number(process.argv[2] || 20);
const rows = [];
for (let i = 0; i < n; i++) {
  const seed = 1000 + i;
  const sim = simulate(seed);
  const a = analyze(sim, SOURCES.map(s => s.id), FIELDS, TRUST_ORDER);
  const sel = selective(a.items, sim.truth, 0.9);
  rows.push({
    learned: a.acc.learned, trust: a.acc.trust, recent: a.acc.recent, majority: a.acc.majority,
    redTrust: a.errorReduction, redBest: a.errorReductionVsBestRule, ece: a.calCal.ece, eceRaw: a.calRaw.ece,
    sel90: sel.acc, cov90: sel.coverage, copyOk: a.res.copies.length === 1 && a.res.copies[0].from === 'pa' && a.res.copies[0].to === 'pb' ? 1 : 0,
  });
}
const med = k => { const v = rows.map(r => r[k]).sort((x, y) => x - y); return [v[Math.floor(v.length / 2)], v[0], v[v.length - 1]]; };
const f = (k, pct = true) => { const [m, lo, hi] = med(k); const g = x => pct ? (100 * x).toFixed(1) + '%' : x.toFixed(3); return `${g(m)} [${g(lo)}, ${g(hi)}]`; };
console.log(`${n} simulated orgs (seeds 1000-${1000 + n - 1}), median [min, max]`);
for (const k of ['learned', 'trust', 'recent', 'majority']) console.log(`accuracy ${k.padEnd(9)} ${f(k)}`);
console.log(`error reduction vs trust+recency rules ${f('redTrust')}`);
console.log(`error reduction vs best rule           ${f('redBest')}`);
console.log(`ECE raw ${f('eceRaw', false)}  calibrated ${f('ece', false)}`);
console.log(`accuracy at confidence >= 90%: ${f('sel90')}, coverage ${f('cov90')}`);
console.log(`reseller found (and only it): ${rows.reduce((s, r) => s + r.copyOk, 0)}/${n}`);
