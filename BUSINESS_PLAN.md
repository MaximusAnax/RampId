# Business plan

**The product:** continuous, outside-in evidence of what a company's website actually does
to its visitors — measured from the public internet, requiring nothing from the company.

**The metric this is optimised for:** maximum profit per hour of your time. Not revenue,
not valuation, not headcount.

---

## 1. The problem, stated precisely

Marketing teams add tracking tags through tag managers without privacy review. Consent
platforms are configured once and then drift. The result is that a company's website
transmits data to Meta, TikTok, Google and session-replay vendors *before* the visitor
consents, *after* they click reject, and while their browser is sending a legally
recognised opt-out signal.

The company cannot see this. Their consent platform reports what they **declared**, not
what the browser **did**. There is no internal telemetry for "what actually left the page."
That gap is invisible from the inside and trivially visible from the outside — which is
the entire commercial opening.

**Evidence this is widespread, not hypothetical:**
- The Markup's webXray survey of 7,000+ sites found opt-out non-compliance at
  "industrial scale."
- Privado found **48% of top websites** misconfigure Google Consent Mode, sending data to
  Google Ads after opt-out.

I am not betting that prospects will fail the audit. Independent surveys already establish
that roughly half of them will.

**Evidence the pain is expensive:**
- ~3,968 active CIPA cases in California as of end of July 2026, plus 811 in Florida.
- $5,000 statutory damages per violation, class-certifiable.
- Hundreds of demand letters weekly; the LA Times settled a class action for $3.85M in
  June 2026.
- Session replay is implicated in ~65% of cases.
- Regulator fines in Q1 2026 alone exceeded $4M: Disney/ABC $2.75M, PlayOn Sports $1.1M,
  Honda $632,500 for asymmetric opt-out design, Ford $375,703.

**Critically: this urgency cannot be legislated away.** Between April and July 2026, six
major compliance deadlines were postponed — EU AI Act high-risk to Dec 2027, HIPAA Security
to Jul 2027, ADA Title II to 2027/2028, Colorado's AI Act repealed and replaced. Any
business whose pitch depends on a calendar date is one omnibus bill from having no pitch.
Private plaintiffs and an active regulator are not on a legislative schedule.

## 2. Why this specific shape wins on profit-per-hour

Three structural properties, each of which independently kills most alternatives.

**The diagnosis requires zero client data.** A browser, three page loads, a network
capture. No credentials, no integration, no BAA, no data processing agreement. This is the
single most valuable property available, and it is widely misunderstood: **data access, not
price, is what triggers enterprise security review.** A $9k tool that ingests customer PII
draws a full vendor security assessment; a $40k engagement that touches nothing often draws
none. Engineering the data model to be zero-access buys more sales-cycle compression than
any pricing tactic.

**The lead magnet, the proof of competence, and the first deliverable are one document.**
Normally these are three separate expensive things. Here the artifact that proves the
product works *is* the outreach *is* what they pay for. That collapses customer acquisition
cost toward the cost of compute. For an unknown solo vendor, a true and specific finding
about the recipient's own business is the only known substitute for a brand.

**It is a drift problem, not a project.** Every new marketing tag re-breaks the
configuration. A one-time audit is worthless by month three — which is exactly why it
converts into a monthly monitoring retainer rather than a one-shot fee. This is the
property that Article 50 compliance lacks and why Article 50 is a wedge rather than the
business.

Scored against seven alternatives (`research/score.py`), this returns **~$457/hour
risk-adjusted** versus $97–$247 for the rest. The finding worth sitting with: the two
*highest-revenue* candidates examined — personal injury demand packages and No Surprises
Act arbitration, each projecting $600k of year-one revenue — finished **last**, because
delivery hours scale linearly with clients. Optimising for revenue picks those. Optimising
for profit-per-hour rejects both.

## 3. What is already built

A working engine, in this repository, with 15 passing tests.

| Component | What it does |
|---|---|
| `scanner/src/consent.js` | Three-pass capture: baseline, GPC-enabled, post-reject |
| `scanner/src/trackers.js` | 25 tracker fingerprints + 10 consent platforms, severity-ranked by litigation reality |
| `scanner/src/report.js` | Standalone HTML evidence report — the deliverable |
| `scanner/src/scan.js` + `vendors.js` + `disclosure.js` | Article 50 chatbot disclosure module (second regulation, same crawler) |
| `scanner/test/` | Fixtures and regression tests, including the clean-site false-positive guard |

The three-pass method is the core intellectual property:

1. **Baseline** — load, touch nothing. Anything firing here fired before consent existed.
2. **GPC** — load sending `Sec-GPC: 1` and `navigator.globalPrivacyControl = true`.
   California regulations effective 1 Jan 2026 require this signal be honoured.
3. **Reject** — click the banner's own reject control, then record only what follows.

Pass 3 produces the most commercially potent finding, because the company built that button
itself and cannot argue the standard was unfair.

## 4. The crawler is the asset; the regulation is swappable

The most important architectural decision. The same three-pass browser capture supports:

- **Pre-consent tracking / opt-out failure** (CIPA, CCPA) — the revenue engine
- **EU AI Act Article 50** chatbot disclosure — live 2 August 2026, already built
- **Accessibility** (EAA, ADA) — 3,117 US federal suits in 2025, litigation-driven

Whichever regulation has the most enforcement heat becomes the thing you lead with. This is
the hedge against the single biggest risk: California reforming CIPA and mooting module one.
Build the crawler as the durable asset and treat the statute as a report template.

## 5. Go to market

**Pricing.** Land at **$7,500** for a one-time forensic assessment. This is deliberately
below the $25,000 figure in startup folklore, which is a university procurement artifact —
real corporate no-friction ceilings cluster at $5k–$10k (card caps, manager discretion).
Expand to **$3,000–$6,000/month** monitoring at renewal, when procurement usually does not
re-review. Annualised, a retained client is $43k–$79k.

**Sequence.**

*Weeks 1–2 — build the evidence base.* Scan 300 named companies in two verticals where
California traffic is heavy and buying is fast: direct-to-consumer retail and digital
health. Rank by exposure score. This costs compute, not hours, and produces both the market
map and the pipeline simultaneously.

*Weeks 2–4 — publish.* Release an aggregate index ("Pre-Consent Tracking in US Retail,
2026") naming no individual company. This is press-attractive, it establishes authority
before any sales conversation, and it makes the subsequent individual outreach read as
research follow-up rather than a cold pitch.

*Weeks 3–8 — outreach on findings, never offers.* One list of 200 named accounts with a
real finding, never 20,000. This is not frugality; since Microsoft's May 2025 and Google's
late-2025 bulk-sender enforcement, a spam complaint rate above 0.3% causes outright
rejection rather than spam-foldering. Volume is capped by policy. The first message
contains a true, specific, checkable fact about the recipient's own site.

*Month 3 onward — the channel, which is where the metric actually improves.* Privacy
counsel are the ideal partner: they have the client relationships, they are asked about this
constantly, and they **cannot produce the technical evidence themselves** — they bill
$600–900/hr to read someone else's scan. Selling through ten firms means solving
trust-transfer ten times instead of three hundred. Partner-sourced deals close roughly 38%
faster with a materially higher win rate. Expect to concede 30–50% of economics; take it,
because you are buying distribution you cannot otherwise afford.

**Year-one target:** 8 clients, ~$480k revenue, ~508 founder-hours.

## 6. Positioning rules, which are not optional

These are the difference between a vendor and a nuisance.

1. **Never state a legal conclusion.** "This request was sent to facebook.com/tr before any
   consent interaction" — never "you are violating CIPA." Stating legal exposure is
   unauthorized practice of law, and it is also what makes recipients hire lawyers to fight
   you rather than hire you to fix it.
2. **Lead with remediation, not accusation.** The reader should finish the report knowing
   what to change on Monday.
3. **Make the evidence checkable in five minutes.** Raw request URLs, named endpoints. An
   engineer who can verify it will act on it; one who cannot will dismiss it.
4. **Never sell "AI."** After MIT's finding that ~95% of enterprise GenAI pilots produced no
   measurable P&L impact, "AI-powered" is a negative credibility signal to a 2026 buyer.
   Sell the observed finding.
5. **Refer the legal question out.** Always to counsel. This is both correct and the thing
   that makes counsel want to partner with you.

## 7. Risks, honestly

| Risk | Severity | Response |
|---|---|---|
| **Reading as a demand-letter mill.** Unsolicited "we found violations" mail at scale puts you in the mental category of serial plaintiffs your buyers resent. | **Highest** | Factual framing only; remediation-first; publish research before outreach so you arrive as a researcher, not a hunter. |
| **Unauthorized practice of law.** | High | Never conclude on liability; counsel partnerships from month one; explicit scope limitation in every report (already in the template). |
| **CIPA reform.** Bills to curb website-tracking claims have circulated since 2025. | High | The crawler is regulation-agnostic by design. Article 50 and accessibility modules are the hedge, and one is already built. |
| **False positives.** One audit accusing a compliant company destroys the credibility the whole motion runs on. | High | Engine resolves ambiguity to "needs review," never "violation." The clean-fixture test is the guard, and it is asserted first. |
| **Commoditization.** Scanning is not hard; someone will ship a free tool. | Medium | The moat is not detection, it is the maintained tracker corpus, the evidence framing that survives a lawyer reading it, and the counsel relationships. Move to retainers fast. |
| **Buyer fixes it themselves after one report.** | Medium | Real, and the reason the business is monitoring rather than audits. Price the first assessment as customer acquisition, not as the product. |

## 8. What has not been validated yet

Stating this plainly, because a plan that hides its unknowns is a pitch, not a plan.

**The engine has been validated against controlled fixtures, not live websites.** This
sandbox's egress policy blocks arbitrary hosts, so the detection logic is proven — correct
findings on the leaky fixture, zero false positives on the clean one — but the real-world
hit rate is inferred from the webXray and Privado surveys rather than measured directly.

**The first thing to do outside this environment**, before writing a line of outreach, is to
run `node cli.js consent` against 100 real domains. That single run answers the only
question that matters: what fraction of real companies actually fail, and how noisy is the
detector against real consent platforms. If the failure rate is near the ~48% the published
surveys imply, the plan holds. If it is 5%, the market is too thin and the Article 50 or
accessibility module should lead instead.

Everything else in this plan is downstream of that measurement.
