# Synthesis: what six parallel investigations actually converged on

Six research tracks ran in parallel — regulated compliance, healthcare/insurance money leaks,
public-data intelligence products, AI-era enterprise pain, boring high-margin verticals, and
business-model structure. Roughly forty candidate businesses were examined with sourced
evidence. This is what survived.

## The three findings that decided it

### 1. The 2026 "deadline wall" collapsed

I went in assuming regulatory deadlines would be the forcing function. Between April and
July 2026 almost every one of them moved:

| Regulation | Was | Now |
|---|---|---|
| EU AI Act high-risk (Annex III) | 2 Aug 2026 | **2 Dec 2027** |
| EU AI Act high-risk (Annex I) | 2 Aug 2027 | 2 Aug 2028 |
| HIPAA Security Rule overhaul | May 2026 | Jul 2027 |
| DOJ ADA Title II web rule | Apr 2026 | Apr 2027/2028 |
| HHS Section 504 digital accessibility | May 2026 | May 2027/2028 |
| Colorado AI Act | Jun 2026 | repealed, replaced, Jan 2027 |

The lesson is structural, not incidental: **a legislature can postpone a deadline, and in
2026 it repeatedly did.** Any business whose entire urgency rests on a calendar date is one
omnibus bill away from having no pitch. Half the "sell against the deadline" plays I would
otherwise have picked were quietly invalidated.

What *cannot* be postponed is private litigation and an active regulator already issuing
fines. That reframing is what moved the winner.

### 2. The binding constraint is trust-transfer, not delivery capacity

AI removed the delivery constraint — and removed it for every competitor simultaneously,
which collapsed the price of everything it made cheap. What it did not touch is a buyer's
willingness to hand money and data to an unknown party.

The supporting numbers are unforgiving. Average cold email reply rate is **3.43%**, under
1% in software, with positive replies at 0.5–2%. And volume can no longer brute-force
through it: since Microsoft's May 2025 and Google's late-2025 bulk-sender enforcement, a
spam complaint rate above 0.3% produces outright rejection rather than spam-foldering.
Outbound became a targeting game, not a throughput game.

So the metric to optimise is not hours-per-deliverable. It is **how many times you must
solve trust-transfer**, and how cheaply each one resolves.

### 3. Data access, not price, is what triggers security review

This is the single most useful tactical finding, and it contradicts the popular advice.

The folklore says "price at $24,900 to stay under the procurement threshold." The evidence
says corporate no-friction ceilings actually cluster at **$5k–$10k** (card caps and manager
discretion); the $25k figure is a university/institutional artifact that leaked into startup
lore. But more importantly: a $9k tool that ingests customer PII draws a full vendor security
assessment, while a $40k engagement where the client emails an export — or where you needed
nothing from them at all — often draws none.

**Engineer the data model before you engineer the price.** A business that produces its
finding entirely from outside the client's perimeter skips the gate that kills solo vendors.

## Scoring

Every candidate was run through the same arithmetic (`research/score.py`), which divides
risk-adjusted profit by total founder hours over twelve months.

```
CANDIDATE                            REVENUE   HOURS     $/HR     p  ADJ $/HR
Pre-consent tracking evidence (CIPA)   $480k     508     $831  0.55      $457
EU AI Act Article 50 audit             $150k     246     $549  0.45      $247
Accessibility conformance (EAA/ADA)    $270k     554     $366  0.50      $183
White-label to compliance counsel      $180k     360     $450  0.40      $180
Agentic commerce readiness             $240k     414     $493  0.35      $172
PI demand packages for law firms       $600k    1064     $338  0.50      $169
TiC payer rate benchmarking            $210k     596     $299  0.50      $150
NSA IDR contingency filing             $600k    1305     $322  0.30       $97
```

The result worth noticing: **the two highest-revenue candidates finish last.** Personal
injury demand packages and No Surprises Act arbitration each project $600k of year-one
revenue — four times the Article 50 play — and both lose decisively, because delivery hours
scale linearly with clients and consume the founder. That is the metric doing its job.
Optimising for revenue would have picked either of them; optimising for profit per hour
rejects both.

## The strongest candidates that were rejected, and why

**Personal injury demand packages.** Genuinely excellent demand: 50,000+ US firms, the
managing partner is the entire buying committee, 7–21 day sales cycles. Rejected because
EvenUp ($2B valuation, ~10,000 cases/week) and Supio are compressing per-unit price, offshore
LPOs already draft demands from $95 per 100 pages, and every case needs the founder's eyes on
the output before an attorney signs it. Delivery hours never amortise.

**No Surprises Act IDR arbitration.** The biggest dollars found anywhere: ~$8B in prevailing
offers in two quarters of 2025, 85–88% provider win rates, and a June 2026 rule that cut the
filing fee from $115 to $15. Rejected on three grounds: it requires PHI and a BAA before the
first dollar, statutory deadlines make errors malpractice-adjacent, and the entire
intermediary model is under active political attack from AHIP and BCBS with litigation
already filed against the market leader.

**AI visibility / answer-engine optimisation.** The pain is real and the cold-start artifact
is the most visceral in B2B. Rejected because the category is closed: Profound at a $1B
valuation, Scrunch acquired by Sitecore, Peec at $4M ARR in ten months. A solo operator
arrives years late to a knife fight.

**Agentic commerce readiness.** Strong cold start, discretionary marketing budget. Rejected
because Google shipped an Agentic Browsing audit category into Lighthouse in May 2026. When
the diagnostic becomes a free tool every developer already runs, the diagnostic is worth zero.

## The winner

**Continuous outside-in evidence of what a company's website actually does to visitors,
sold first against pre-consent tracking and opt-out failures.**

It wins because it is the only candidate scoring well on every constraint that actually
binds a solo operator:

- **The urgency cannot be legislated away.** ~3,968 active CIPA cases in California as of
  end of July 2026, $5,000 statutory damages per violation, hundreds of demand letters
  weekly, and a regulator issuing real fines — Disney $2.75M, PlayOn Sports $1.1M, Honda
  $632,500, Ford $375,703, all in Q1 2026 alone.
- **The failure rate is independently documented, not assumed.** The Markup's webXray survey
  of 7,000+ sites found opt-out non-compliance at "industrial scale," and Privado found 48%
  of top websites misconfigure Google Consent Mode so data flows to Google Ads after opt-out.
  I did not have to guess whether prospects would fail the audit.
- **Zero client data is required to produce the finding.** A browser, three passes, a network
  capture. No credentials, no integration, no BAA — so no security review.
- **The diagnosis, the lead magnet, and the first deliverable are the same document.**
- **It is a drift problem, not a project.** Every new marketing tag re-breaks compliance,
  which converts a one-off audit into a monthly retainer. This is what Article 50 lacks.
- **No license is required** for technical testing (unlike SOC 2, ISO certification, PCI ROC,
  or property tax representation, all of which hard-blocked otherwise good candidates).

## Why the crawler is the asset, not the regulation

The most durable insight from the compliance research: build the crawler so the regulation
it reports against is **swappable**. The same three-pass browser capture supports:

- pre-consent tracking and opt-out failures (CIPA / CCPA) — the revenue engine
- EU AI Act Article 50 chatbot disclosure — live 2 August 2026, a press wedge with a short
  half-life
- accessibility conformance (EAA / ADA) — litigation-driven, 3,117 US federal suits in 2025

One engine, several regulations, and the regulation with the most enforcement heat at any
given moment becomes the thing you lead with. That is what protects against the single
biggest risk here — that California reforms CIPA and moots the first module.

## The honest risks

1. **Proximity to unauthorized practice of law.** The artifact's power comes from implying
   legal exposure, but *stating* that exposure is UPL. Everything must be phrased as observed
   technical fact plus cited public enforcement precedent, never "you are in violation."
2. **Reading as a demand-letter mill.** Unsolicited "we found violations on your site" email
   at scale puts you in the same mental category as the serial plaintiffs your buyers already
   resent. Lead with remediation, never accusation.
3. **CIPA reform.** Bills to curb website-tracking claims have circulated since 2025. This is
   precisely why the crawler must be regulation-agnostic from day one.
4. **False positives.** One audit that accuses a compliant company destroys the credibility
   the entire motion depends on. The engine is deliberately built to resolve ambiguity toward
   "needs review" rather than "violation."
