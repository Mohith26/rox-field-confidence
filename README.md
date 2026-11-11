# Field confidence for Rox's contact graph (concept)

**Live demo:** https://mohith26.github.io/rox-field-confidence/

An unofficial concept feature for [Rox](https://www.rox.com), built by Mohith Gajjela. Not affiliated with Rox. All data is synthetic.

![screenshot](docs/screenshot.png)

## What it is

Rox keeps every assertion every source makes about a contact (CRM, enrichment vendors, web research, email signatures, CSV uploads) and projects one canonical value per field. Rox's write-up on its contact system of record says the canonical value "is chosen based on trust and recency", and the platform page describes conflict resolution as "source precedence and recency; one value per field".

This demo replaces the fixed trust order with a model that **learns, from the assertions themselves and without labels**:

- how accurate each source is on each field when it captures it,
- how far behind reality each source runs (its lag),
- how often each field actually changes (job changes, promotions, moves),
- which sources resell another source's records (so a copy is not a second vote),

and then gives every field a **calibrated confidence**: when it says 90%, it is right about 90% of the time (in the demo, 94.6% at that threshold).

It ships where it would naturally live: **People > Contacts** gets a confidence column, a "Differs from rules" filter and a per-contact panel that shows each candidate value, which sources back it and how old they are; a **Source reliability** tab shows what was learned about each source.

## How it works (`core/resolve.js`)

A change-point model for each (contact, field), fit by EM over the whole workspace:

1. `tau ~ Exponential(lambda_f)` is the time since the field last changed.
2. A source that looked `age` days ago saw the world as of `e = age + lag_s`. If `e < tau` the observation is **fresh** and shows today's value with probability `A[s][f]` (otherwise a capture error). If `e >= tau` it is **stale** and shows the previous value.
3. Stale observations share the previous value, so three old sources agreeing on an old employer is explained as one old fact, not as three independent votes. If the change is newer than every observation, today's value is **unseen**.
4. Posteriors are exact sums over (change interval, current value, previous value); the per-item likelihood is checked against a brute-force enumeration in the tests.
5. M-step: accuracies in closed form from expected matches; `lambda_f` by golden-section search on the marginal likelihood; source lags by a coordinate grid search.
6. **Copy detection:** among fresh observations where source *s* is likely wrong, how often does *t* report the exact same value, compared with how often *t* matches other sources' wrong values? A Bayes factor on that excess (BIC-penalized) flags resellers; the later source's agreeing votes are tempered by `1 - rate * P(copy)`.
7. **Calibration:** one temperature on the full posterior vector, fit only on the ~8% of fields with a verified value (in Rox: rep corrections, delivered and bounced emails), evaluated on the other 92%.

Everything on the page is computed in the browser from the seeded simulator (`core/simulate.js`) on load (about 2 seconds).

## The synthetic workspace

`simulate(20261110)`: 2,000 contacts at 160 fictional companies with true career timelines over three years (job changes about every 2.5 years, promotions, relocations). Seven sources observe them: **Salesforce** (rep-entered, accurate but rarely updated), **Email activity** (signatures, very accurate, only for contacts you email), **Provider A** (quarterly, about 5 months behind), **Provider B** (resells 75% of Provider A's records, errors included), **Provider C** (realtime but noisy titles), **Web research** (fresh, no emails), and a one-time **CSV import** from an event. Errors are realistic: guessed email patterns at the right domain, adjacent seniority titles, old employers. Vendor names are deliberately generic: the accuracy numbers are invented and should not be read as claims about real providers.

The trust order used for the baseline is Salesforce > Email activity > Provider A > Provider C > Web research > Provider B > CSV.

## Results (seed 20261110, `node scripts/report.mjs`)

| Strategy | Fields right today |
|---|---|
| **Field confidence (learned)** | **83.7%** |
| Majority vote | 78.0% |
| Most recent wins | 77.3% |
| Trust hierarchy + recency | 61.8% |

- 7,996 fields from 32,704 assertions; 2,496 learned values differ from the trust hierarchy (1,208 contacts).
- Wrong values: **1,301 instead of 3,056** under trust + recency (**57% fewer**); 28% fewer than the best single rule (most recent wins).
- 8.3% of fields have a current value that no source has reported yet, so the ceiling is about 92%.
- Calibration on 7,385 held-out fields: error 2.2 points (5.9 before the temperature); values at 90%+ confidence are right 94.6% of the time and cover 44% of fields.
- Of 620 contacts in sequences, the trust rules give 330 a wrong title or employer; the learned values fix 201 of them. Wrong addresses: 124 of 231 fixed.
- Learned: Provider B resells Provider A (72% of records; the simulator uses 75%) and no other pair is flagged; Provider A runs about 60 days behind, Provider B about 120.

Ablations (same seed): no copy detection 81.1%, no lag learning 82.2%, neither 78.2% (no better than majority vote). Both pieces matter.

## Does it hold up? (`node scripts/validate.mjs 20`)

20 freshly simulated workspaces (seeds 1000-1019), median [min, max]:

| | |
|---|---|
| Learned accuracy | 84.2% [82.6%, 85.0%] |
| Trust + recency | 62.3% [60.6%, 63.8%] |
| Most recent wins | 77.4% [76.5%, 78.5%] |
| Majority vote | 78.0% [77.0%, 79.6%] |
| Error reduction vs trust + recency | 58.0% [54.8%, 60.2%] |
| Error reduction vs best rule | 29.1% [23.3%, 34.5%] |
| Calibration error (held out) | 0.023 [0.011, 0.033] |
| Accuracy at 90%+ confidence | 94.7% [94.0%, 95.5%] |
| Reseller found, and only it | 20/20 |

## Tests

```
node --test test/resolve.test.mjs
```

9 tests: simulator determinism and shape; the per-item likelihood against an independent brute-force enumeration (three change rates) and posteriors summing to 1; stale agreement not beating one fresh source (where majority vote and the trust order both fail); baseline definitions; EM finding the reseller and only it, with plausible accuracies, lags and change rates; beating every rule on three seeds; ablations (copy detection and lag learning both help); out-of-sample calibration with the temperature fit on labeled fields only; determinism of `resolve()`.

## Honest limitations

- Synthetic data. The simulator was written by the same person as the model, so the model's assumptions (one change per window, exponential change times, capture errors spread over plausible values) are closer to the simulator than reality will be. Real Rox data would be the actual test.
- Learned lags and change rates are approximate (for example, Provider C's true mean lag is 45 days; the model says about 0). The ranking of sources is right; the exact numbers are not.
- The "unseen" (likely changed) flag is weak: at a 30% threshold it flags 108 fields, 34% of which really changed after every source looked (4x the 8.3% base rate). Most changes are too recent for any source to show.
- Copy direction uses timing (the reseller's matching records are newer). A vendor that resells with no delay would need another signal.
- The confidence column shows the least confident field per contact, so many contacts that differ from the rules show low confidence; that is the point (they are the ones sources disagree on), but it can look alarming.
- Runs in the browser on 2,000 contacts in about 2 seconds; a production version would run incrementally per contact as assertions arrive.

## Novelty note

Checked Rox's docs (all 181 pages), release notes from Sep 2024 to Oct 28 2026, the "System of Record: For Contact Data" post (Nov 2025), the platform page and the knowledge-graph deep dive. Rox resolves conflicts with a trust hierarchy plus recency, uses LLM confidence for entity matching (merging records), validates CRM fields against public sources in Voice Mode, and lets users re-check insights. I found no learned per-source reliability, no source lag or copy detection, and no calibrated per-field confidence. Elsewhere, MDM tools use rule-based survivorship (source priority, most recent, most frequent), and enrichment vendors score their own records; truth discovery with copy detection is an academic idea (Dong, Berti-Equille and Srivastava, VLDB 2009) that I did not find in a sales product.
