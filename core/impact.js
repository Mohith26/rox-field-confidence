// Agent impact: contacts in active sequences whose employer, title or address
// would be wrong under the trust rules, and how many the learned values fix.
export function agentImpact(sim, a) {
  const seq = new Set(sim.inSequence);
  let n = 0, wrongRule = 0, fixed = 0, emailWrongRule = 0, emailFixed = 0;
  for (const p of sim.people) {
    if (!seq.has(p.id)) continue;
    n++;
    const it = f => a.itemsByKey[p.id + ':' + f];
    const fs = ['company', 'title'].map(it).filter(Boolean);
    const bad = fs.some(i => i.trust.value !== sim.truth[i.key]);
    const good = fs.every(i => i.top === sim.truth[i.key]);
    if (bad) { wrongRule++; if (good) fixed++; }
    const e = it('email');
    if (e && e.trust.value !== sim.truth[e.key]) { emailWrongRule++; if (e.top === sim.truth[e.key]) emailFixed++; }
  }
  return { n, wrongRule, fixed, emailWrongRule, emailFixed };
}
