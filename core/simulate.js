// Seeded simulator for a revenue org's contact data.
// Every contact has a true career timeline (employer, title, work email, location).
// Seven sources observe it the way real sources do: at different times, with
// different lags and error rates, and one provider resells another's data.
// Because the simulator knows the truth, the page can score every strategy.

export const DAY0 = '2026-11-10'; // "today" in the demo; ages are days before this date

export const FIELDS = ['title', 'company', 'email', 'location'];

export const FIELD_LABELS = { title: 'Title', company: 'Company', email: 'Email', location: 'Location' };

// Hidden simulation parameters. The resolver never sees these; the tests check
// that it recovers them from the observations alone.
//   cov: share of contacts the source has; acc: accuracy at the moment of capture
//   ageLo/ageHi: how long ago the source last observed the contact (days)
//   lag: mean delay between the world changing and the source's data reflecting it
export const SOURCES = [
  { id: 'crm', name: 'Salesforce', kind: 'CRM', cov: 0.94, lag: 0,
    acc: { title: 0.93, company: 0.99, email: 0.96, location: 0.92 } },
  { id: 'mail', name: 'Email activity', kind: 'Signatures', cov: 0.36, lag: 0,
    acc: { title: 0.96, company: 0.995, email: 0.995, location: 0.85 } },
  { id: 'pa', name: 'Provider A', kind: 'Enrichment', cov: 0.84, lag: 160,
    acc: { title: 0.84, company: 0.95, email: 0.86, location: 0.9 } },
  { id: 'pb', name: 'Provider B', kind: 'Enrichment', cov: 0.72, lag: 120, copyFrom: 'pa', copyRate: 0.75,
    acc: { title: 0.76, company: 0.9, email: 0.78, location: 0.85 } },
  { id: 'pc', name: 'Provider C', kind: 'Realtime enrichment', cov: 0.55, lag: 45,
    acc: { title: 0.74, company: 0.94, email: 0.8, location: 0.88 } },
  { id: 'web', name: 'Web research', kind: 'Rox research', cov: 0.62, lag: 25,
    acc: { title: 0.88, company: 0.96, location: 0.9 } },
  { id: 'csv', name: 'CSV import', kind: 'Event list', cov: 0.24, lag: 0,
    acc: { title: 0.82, company: 0.95, email: 0.72, location: 0.8 } },
];

// The trust hierarchy an admin would plausibly configure (highest first).
export const TRUST_ORDER = ['crm', 'mail', 'pa', 'pc', 'web', 'pb', 'csv'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Maya','Daniel','Priya','Jordan','Elena','Marcus','Aisha','Tom','Sofia','Kevin','Hannah','Luis','Grace','Omar','Chloe','Ryan','Nina','Ethan','Leah','Arjun','Rachel','Victor','Julia','Sam','Tara','Ben','Mei','Carlos','Ava','Noah','Zoe','Andre','Lily','Raj','Emma','Diego','Olivia','Isaac','Naomi','Felix','Ivy','Hugo','Clara','Ken','Ruth','Paul','Anika','Leo','Iris','Mateo','Sara','Owen','Jade','Kofi','Lena','Theo','Nora','Ali','Eva','Jonah'];
const LAST = ['Patel','Nguyen','Kim','Garcia','Shah','Cohen','Brooks','Rivera','Chen','Okafor','Larsen','Murphy','Singh','Alvarez','Fischer','Wright','Tanaka','Romero','Bauer','Hughes','Kaur','Silva','Novak','Price','Reyes','Moreno','Ward','Iyer','Lopez','Park','Bennett','Costa','Dubois','Ellis','Foster','Gupta','Haddad','Ito','Jensen','Khan','Lindqvist','Mehta','Nolan','Ortiz','Quinn','Rossi','Sato','Turner','Ueda','Vargas','Weiss','Young','Zhou','Abbott','Byrne','Diaz','Rahman','Mendes','Kowalski','Hale'];
const CO_A = ['Vantage','Helio','Pinnacle','Harbor','Meridian','Northwind','Cobalt','Summit','Lumen','Granite','Redwood','Atlas','Beacon','Crescent','Evergreen','Ironclad','Juniper','Keystone','Larkspur','Monarch','Nimbus','Orchard','Prairie','Quarry','Ridgeline','Sable','Tidewater','Upland','Vireo','Willow','Alder','Bluebird','Cascade','Driftwood','Ember'];
const CO_B = [['Payroll','payroll'],['Grid','grid'],['Robotics','robotics'],['Insurance','insure'],['Foods','foods'],['Logistics','logistics'],['Analytics','analytics'],['Health','health'],['Systems','systems'],['Security','security'],['Labs','labs'],['Capital','capital'],['Networks','networks'],['Cloud','cloud'],['Bio','bio']];
const CITIES = ['San Francisco, CA','New York, NY','Austin, TX','Seattle, WA','Boston, MA','Chicago, IL','Denver, CO','Atlanta, GA','Los Angeles, CA','Raleigh, NC','Dallas, TX','Miami, FL','Toronto, ON','London, UK','Salt Lake City, UT','Phoenix, AZ','Minneapolis, MN','Portland, OR','San Diego, CA','Washington, DC','Nashville, TN','Pittsburgh, PA','Columbus, OH','Philadelphia, PA'];
const FUNCS = [
  ['Engineering', ['Software Engineer','Senior Software Engineer','Engineering Manager','Director of Engineering','VP of Engineering','CTO']],
  ['Sales', ['Account Executive','Senior Account Executive','Sales Manager','Director of Sales','VP of Sales','Chief Revenue Officer']],
  ['RevOps', ['Revenue Operations Analyst','Senior RevOps Analyst','RevOps Manager','Director of Revenue Operations','VP of Revenue Operations','Chief Operating Officer']],
  ['Marketing', ['Marketing Manager','Senior Marketing Manager','Head of Demand Gen','Director of Marketing','VP of Marketing','CMO']],
  ['Product', ['Product Manager','Senior Product Manager','Group Product Manager','Director of Product','VP of Product','Chief Product Officer']],
  ['IT', ['IT Analyst','Senior Systems Engineer','IT Manager','Director of IT','VP of IT','CIO']],
  ['Finance', ['Financial Analyst','Senior Financial Analyst','Finance Manager','Director of Finance','VP of Finance','CFO']],
  ['Security', ['Security Engineer','Senior Security Engineer','Security Manager','Director of Security','VP of Security','CISO']],
];
const EMAIL_PATTERNS = ['first.last', 'first', 'flast', 'firstl', 'first_last'];

function emailFor(first, last, pattern, domain) {
  const f = first.toLowerCase(), l = last.toLowerCase();
  const local = { 'first.last': `${f}.${l}`, first: f, flast: f[0] + l, firstl: f + l[0], first_last: `${f}_${l}` }[pattern];
  return `${local}@${domain}`;
}

function expo(rng, mean) { return -Math.log(1 - rng()) * mean; }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

export function titleOf(fn, lvl) { return FUNCS[fn][1][lvl]; }

export function simulate(seed = 20261110, opts = {}) {
  const rng = mulberry32(seed);
  const nPeople = opts.people ?? 2000;
  const nCompanies = opts.companies ?? 160;
  const HIST = 1095;

  // Companies (fictional)
  const companies = [];
  const used = new Set();
  while (companies.length < nCompanies) {
    const a = pick(rng, CO_A), b = pick(rng, CO_B);
    const name = `${a} ${b[0]}`;
    if (used.has(name)) continue;
    used.add(name);
    companies.push({ name, domain: `${a.toLowerCase()}${b[1]}.com`, pattern: pick(rng, EMAIL_PATTERNS), hq: pick(rng, CITIES) });
  }

  // People with true timelines. timeline[k] = {t, company, fn, lvl, city}; t in days relative to today (negative = past)
  const people = [];
  const usedNames = new Set();
  for (let i = 0; i < nPeople; i++) {
    let first, last;
    do { first = pick(rng, FIRST); last = pick(rng, LAST); } while (usedNames.has(first + last) && usedNames.size < FIRST.length * LAST.length - 5);
    usedNames.add(first + last);
    let co = Math.floor(rng() * nCompanies);
    let fn = Math.floor(rng() * FUNCS.length);
    let lvl = Math.min(5, Math.floor(rng() * rng() * 6));
    let city = rng() < 0.6 ? companies[co].hq : pick(rng, CITIES);
    const timeline = [{ t: -HIST - 400, co, fn, lvl, city }];
    let t = -HIST - 400;
    while (true) {
      const wj = expo(rng, 900), wp = expo(rng, 1100), wr = expo(rng, 2600);
      const w = Math.min(wj, wp, wr);
      t += w;
      if (t >= 0) break;
      if (w === wj) {
        let nco; do { nco = Math.floor(rng() * nCompanies); } while (nco === co);
        co = nco;
        if (rng() < 0.15) fn = Math.floor(rng() * FUNCS.length);
        if (rng() < 0.4 && lvl < 5) lvl++;
        if (rng() < 0.35) city = companies[co].hq;
      } else if (w === wp) {
        if (lvl < 5) lvl++; else continue;
      } else {
        let nc; do { nc = pick(rng, CITIES); } while (nc === city);
        city = nc;
      }
      timeline.push({ t, co, fn, lvl, city });
    }
    people.push({ id: i, first, last, timeline });
  }

  const truthState = (p, t) => {
    let s = p.timeline[0];
    for (const e of p.timeline) { if (e.t <= t) s = e; else break; }
    return s;
  };
  const valueOf = (p, st, field) => {
    const c = companies[st.co];
    if (field === 'title') return titleOf(st.fn, st.lvl);
    if (field === 'company') return c.name;
    if (field === 'email') return emailFor(p.first, p.last, c.pattern, c.domain);
    return st.city;
  };
  const truthAt = (p, field, t) => valueOf(p, truthState(p, t), field);

  // Plausible wrong value for a field (capture error), given the state the source saw
  const noise = (p, st, field) => {
    if (field === 'title') {
      const r = rng();
      if (r < 0.55) { const dl = st.lvl === 0 ? 1 : st.lvl === 5 ? -1 : (rng() < 0.5 ? -1 : 1); return titleOf(st.fn, st.lvl + dl); }
      let f2; do { f2 = Math.floor(rng() * FUNCS.length); } while (f2 === st.fn);
      return titleOf(f2, st.lvl);
    }
    if (field === 'company') {
      // older employer if there is one (vendor merged an old record), else an unrelated company
      const idx = p.timeline.findIndex(e => e === st);
      const prev = p.timeline.slice(0, idx).reverse().find(e => e.co !== st.co);
      if (prev && rng() < 0.7) return companies[prev.co].name;
      let c2; do { c2 = Math.floor(rng() * nCompanies); } while (c2 === st.co);
      return companies[c2].name;
    }
    if (field === 'email') {
      // the classic enrichment error: right domain, guessed local-part pattern
      const c = companies[st.co];
      let pat; do { pat = pick(rng, EMAIL_PATTERNS); } while (pat === c.pattern);
      return emailFor(p.first, p.last, pat, c.domain);
    }
    let c2; do { c2 = rng() < 0.5 ? companies[st.co].hq : pick(rng, CITIES); } while (c2 === st.city);
    return c2;
  };

  // Observation timing per source: when it last looked (age, days before today)
  const obsAge = (src) => {
    switch (src.id) {
      case 'crm': return 30 + rng() * (HIST - 30) * (rng() < 0.7 ? 1 : 0.4); // rep-entered, rarely updated
      case 'mail': return expo(rng, 140);                                  // last email thread
      case 'pa': return rng() * 120;                                       // quarterly refresh
      case 'pb': return rng() * 150;
      case 'pc': return rng() * 30;                                        // realtime
      case 'web': return rng() * 75;
      case 'csv': return 520 + rng() * 25;                                  // one-time event import
      default: return 0;
    }
  };

  const observations = []; // {pid, field, src, value, age}
  const byPersonSrc = new Map();
  for (const p of people) {
    for (const src of SOURCES) {
      if (rng() >= src.cov) continue;
      let rec;
      const base = src.copyFrom && byPersonSrc.get(p.id + ':' + src.copyFrom);
      if (base && rng() < src.copyRate) {
        // resold record: same values (including the original's errors), refreshed later
        const age = Math.max(0, base.age - (20 + rng() * 70)) ;
        rec = { age: Math.max(age, 0), values: { ...base.values }, copied: true };
        if (!('email' in base.values)) delete rec.values.email;
      } else {
        const age = Math.min(obsAge(src), HIST + 300);
        const asof = -age - (src.lag ? expo(rng, src.lag) : 0);
        const st = truthState(p, asof);
        const values = {};
        for (const f of FIELDS) {
          if (!(f in src.acc)) continue;
          if (src.id === 'mail' && f === 'location' && rng() < 0.3) continue; // signatures often omit it
          values[f] = rng() < src.acc[f] ? valueOf(p, st, f) : noise(p, st, f);
        }
        rec = { age, values, copied: false };
      }
      byPersonSrc.set(p.id + ':' + src.id, rec);
      for (const f of FIELDS) {
        if (rec.values[f] === undefined) continue;
        observations.push({ pid: p.id, field: f, src: src.id, value: rec.values[f], age: Math.round(rec.age), copied: rec.copied });
      }
    }
  }

  // Truth today, and a small set of verified labels (rep corrections, delivered/bounced email)
  const truth = {};
  for (const p of people) for (const f of FIELDS) truth[p.id + ':' + f] = truthAt(p, f, 0);
  const labeled = new Set();
  for (const p of people) for (const f of FIELDS) if (rng() < 0.08) labeled.add(p.id + ':' + f);

  // Contacts currently enrolled in a sequence (for the agent-impact view)
  const inSequence = new Set();
  for (const p of people) if (rng() < 0.3) inSequence.add(p.id);

  return {
    seed, companies, observations, truth, labeled: [...labeled], inSequence: [...inSequence],
    people: people.map(p => ({ id: p.id, first: p.first, last: p.last, jobs: new Set(p.timeline.map(e => e.co)).size, lastChange: Math.round(-p.timeline[p.timeline.length - 1].t) })),
  };
}
