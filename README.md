# Outside-in web compliance evidence engine

Measures what a company's website actually transmits to third parties — from the public
internet, requiring nothing from the company.

The commercial premise: a company's consent platform reports what it *declared*, not what
the browser *did*. Those diverge constantly, the gap is invisible from the inside, and it is
trivially visible from the outside.

- **[BUSINESS_PLAN.md](BUSINESS_PLAN.md)** — the plan, the economics, and the open risks
- **[research/](research/)** — how the decision was made, including what was rejected
- **[scanner/](scanner/)** — the working engine

## Quick start

```bash
cd scanner
npm install
npm test                                  # 15 tests, ~13s

node cli.js consent example.com           # tracking + consent evidence → HTML report
node cli.js ai50 example.com              # EU AI Act Article 50 chatbot disclosure
```

`consent` writes a client-ready HTML evidence report per target plus `consent.json`.
See [`scanner/sample/example-evidence-report.html`](scanner/sample/example-evidence-report.html)
for what a report looks like.

## The method

Three page loads, each with a clean browser profile:

1. **Baseline** — load the page, touch nothing. Anything that fires here fired before the
   visitor made any choice.
2. **GPC** — load again advertising `Sec-GPC: 1` and `navigator.globalPrivacyControl = true`.
   California regulations effective 1 Jan 2026 require opt-out preference signals be honoured.
3. **Reject** — click the consent banner's own reject control, then record only what follows.

Pass 3 is the most commercially potent, because the company built that button itself.

## Design decisions worth knowing

**A false positive is far more expensive than a false negative.** An audit that accuses a
compliant company destroys the credibility the entire business depends on. The engine
resolves ambiguity to `NEEDS_REVIEW`, never to a violation claim, and the clean-fixture
test is asserted before any detection test.

**The report never states a legal conclusion.** It records observed network behaviour and
cites public enforcement as context. Asserting that someone is in violation is unauthorized
practice of law, and it converts a prospective client into an adversary.

**The crawler is the asset; the regulation is a report template.** The same capture drives
the consent module and the Article 50 module, and accessibility is the third. Deadlines get
postponed — six major ones moved between April and July 2026 — so the engine is built so the
statute it reports against can be swapped.

## Status

The detection logic is validated against controlled fixtures. It has **not** yet been run
against live websites — the sandbox it was built in blocks arbitrary egress. The first task
in an unrestricted environment is scanning ~100 real domains to measure the true failure
rate, which is the number the entire plan rests on.

## Layout

```
BUSINESS_PLAN.md          the plan and its open questions
research/
  00-decision-framework   the metric and the auto-reject filters
  01-independent-checks   scraping legality; the EU AI Act deadline correction
  02-article-50-deep-dive the one deadline that survived
  03-synthesis            what six parallel investigations converged on
  score.py                ranks candidates by profit per founder-hour
  candidates.json         the eight finalists and their assumptions
scanner/
  src/consent.js          three-pass tracking and consent capture
  src/trackers.js         tracker and consent-platform fingerprints
  src/report.js           HTML evidence report
  src/scan.js             Article 50 chatbot capture
  src/vendors.js          chat vendor fingerprints, AI-likelihood tagged
  src/disclosure.js       AI disclosure assessment
  test/                   fixtures and regression tests
```
