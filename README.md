# Outside-in web compliance evidence engine

Measures what a company's website actually transmits to third parties — from the public
internet, requiring nothing from the company.

The commercial premise: a company's consent platform reports what it *declared*, not what
the browser *did*. Those diverge constantly, the gap is invisible from the inside, and it is
trivially visible from the outside.

California's regulators run essentially this same test. The 2026 enforcement actions turned
on it — the Disney/ABC matter on data continuing to flow to advertising partners after
consumers opted out, the Ford matter on friction in the opt-out mechanism. This tool
reproduces that examination in advance.

- **[BUSINESS_PLAN.md](BUSINESS_PLAN.md)** — the plan, the economics, the open risks
- **[RUNBOOK.md](RUNBOOK.md)** — what the operator personally does, with time budgets
- **[research/](research/)** — how the decision was made, including what was rejected
- **[scanner/](scanner/)** — the engine

## Quick start

```bash
cd scanner
npm install
npm test                      # 216 tests

# one command: target list → ranked queue, reports, and drafted first messages
node cli.js campaign --sector="US retail" --sender="Your Name" \
  --out=runs/august acme.com globex.com initech.com

# individual modes
node cli.js consent example.com      # tracking + consent evidence → HTML report
node cli.js ai50 example.com         # EU AI Act Article 50 chatbot disclosure
node cli.js monitor --data=clients $(cat clients.txt)   # drift since last check
```

Samples: [evidence report](scanner/sample/example-evidence-report.html) ·
[sector index](scanner/sample/example-sector-index.html)

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
compliant company destroys the credibility the entire business depends on. Ambiguity
resolves to "needs review", never to an accusation, and the clean-fixture tests are asserted
first.

**A tag that signals consent denied is not a finding.** Google Consent Mode and Meta's
Limited Data Use let a tag fire while transmitting that consent was denied — that is the
designed behaviour. Findings are built only from services whose requests carried no
restriction signal. The rest appear in the report as context, so the scan does not look like
it missed requests the client's own engineer can see.

**The report never states a legal conclusion.** It records observed network behaviour and
cites public enforcement as context. Asserting that someone is in violation is unauthorized
practice of law, and it converts a prospective client into an adversary. The outreach
generator enforces this in code with a banned-phrase guard rather than trusting discipline.

**An empty result and a clean result mean opposite things.** A scan that could not load the
page renders as explicitly inconclusive, never as a clean bill of health.

**The crawler is the asset; the regulation is a report template.** `assess.js` runs several
regulation modules against one target. Six major compliance deadlines moved between April
and July 2026, so a business welded to one statute is one omnibus bill from having no
product.

## Bugs worth knowing about, because they were all invisible

Every one of these produced output that looked like good news:

- **Chromium inherits proxy configuration from its environment.** Behind an intercepting
  proxy, sub-resources fail to load, every tracker looks absent, and the scanner reports
  clean sites across the board. Proxy variables are now stripped from the browser's
  environment unless one is explicitly requested.
- **Consent platforms were detected only by network signature**, so any self-hosted manager
  (Klaro, vanilla-cookieconsent, Osano) produced a "no consent mechanism detected" claim
  about a site with a banner plainly on screen. Detection now runs from the DOM too.
- **The stored scan is a record wrapping the scan.** Comparing the record instead yielded
  "not comparable" every monitoring cycle — indistinguishable from a client whose site never
  changes.
- **A site that correctly halts all tracking after reject records zero requests**, which the
  capture-health check read as a failed load. The best possible client outcome was being
  classified as a broken scan.

## Data and licensing

Classification is hybrid: a curated corpus carries litigation-relevant severity and
plain-English descriptions, backed by [third-party-web](https://github.com/patrickhulce/third-party-web)
(MIT, 2,142 categorized entities) for long-tail coverage.

The richer alternative, Ghostery's TrackerDB, is **CC-BY-NC-SA-4.0 — NonCommercial** and
cannot ship in a paid product. That term is easy to miss and the consequence lands after you
already have customers.

## Status

Detection is validated against fixtures reproducing real consent-manager markup, with class
names extracted from the shipped CSS of the actual libraries. It has **not** been run against
live public websites — the sandbox it was built in blocks arbitrary egress. The first task in
an unrestricted environment is scanning ~100 real domains to measure the true failure rate,
which is the number the whole plan rests on.

## Layout

```
BUSINESS_PLAN.md   the plan and its open questions
RUNBOOK.md         the operator's weekly loop
research/          decision framework, independent checks, synthesis, CIPA reform analysis
scanner/src/
  campaign.js      target list → ranked queue with reports and drafts
  consent.js       three-pass tracking and consent capture
  consentmode.js   decodes Consent Mode / LDU / TCF / GPP signals
  entities.js      hybrid curated + broad classification
  cmp.js           consent-platform detection and reject interaction
  trackers.js      curated fingerprints with litigation-relevant severity
  diff.js          drift detection between scans
  monitor.js       scan, persist, diff, alert — the retainer product
  store.js         scan history
  discover.js      target normalisation, prioritisation, polite scan planning
  outreach.js      first-contact drafts, with the banned-phrase guard
  report.js        client-facing HTML evidence report
  indexreport.js   anonymised aggregate sector index
  assess.js        multi-regulation assessment over one crawl
  scan.js          EU AI Act Article 50 chatbot capture
```
