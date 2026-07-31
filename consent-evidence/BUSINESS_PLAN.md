# Business plan

**The product:** continuous, outside-in evidence of what a company's website actually does
to its visitors — measured from the public internet, requiring nothing from the company.

**The metric this is optimised for:** maximum profit per hour of your time.

This plan has been through an adversarial validation pass. Where that pass corrected the
original thesis, the correction is stated rather than quietly folded in, because the
corrections are the most useful part of the document.

---

## 1. The problem

Marketing teams add tracking tags through tag managers without privacy review. Consent
platforms are configured once and then drift. The result is that a company's website
transmits data to Meta, TikTok, Google and session-replay vendors before the visitor
consents, after they click reject, and while their browser is sending a legally recognised
opt-out signal.

The company cannot see this. Their consent platform reports what they **declared**, not
what the browser **did**. That gap is invisible from the inside and trivially visible from
the outside.

**Independent evidence it is widespread:** The Markup's webXray survey of 7,000+ sites found
opt-out non-compliance at "industrial scale," and Privado found 48% of top websites
misconfigure Google Consent Mode so data flows to Google Ads after opt-out. I am not betting
that prospects will fail the audit — published surveys already establish that roughly half
of them do.

## 2. What you lead with, and why it is not what I first thought

**Lead with CCPA regulations § 7025(c)(6).** Effective 1 January 2026 it changed from "may"
to "shall": a business that processes an opt-out preference signal **must display** that it
has done so.

This is the most commercially useful fact in the domain. It is dated and new, so contacting
someone about it is legitimate. It is a positive obligation — something the site must
*show* — so failure is externally observable rather than inferred. It is almost universally
unmet. And it maps one-to-one onto a pass the scanner already runs.

**The original plan led with tracking pixels and CIPA lawsuit counts. That was a mistake,
and it was the most dangerous mistake in the plan.** An email that opens "we scanned your
site and here is the tracker that fired after you clicked reject" has the same first
sentence as the demand letters a handful of volume plaintiff firms send to hundreds of
brands weekly, using an identical scanning technique. Recipients' counsel have trained them
to forward those and never reply. The reply rate would have been near zero and it would have
taken two months to distinguish that from bad copy.

Same scan, opposite category. That reframing is now built into the product: the outreach
generator leads with the display requirement, and the regulation citation sits in a sentence
the length budget cannot drop.

**The tailwind:** AB 566, signed 8 October 2025, operative 1 January 2027, requires browsers
to offer an opt-out preference signal. GPC traffic is about to rise sharply, which makes
mishandling it more expensive over time, not less.

## 3. What the validation pass corrected

| The plan said | What is actually true |
|---|---|
| "This urgency cannot be legislated away" | Half wrong. SB 690 would retroactively wipe pending § 638.51 claims filed on or after 1 Jan 2025. But it reaches only §§ 638.50/638.51 — § 631 and § 632.7 private rights survive, and it is operative 1 Jan 2027 at the earliest, not September 2026. |
| Plaintiffs are the engine | The **regulator** is the engine, and the regulator's obligations are getting *stronger* (may→shall, AB 566) while the litigation side thins. |
| Sell insurers a risk feed | The slot is taken. LOKKER/Bitsight partnered in March 2025; Coalition and Corvus built it in-house. Entry costs 9–18 months and SOC 2 to arrive second. |
| Law firms are a channel with revenue share | Law firms are **distribution, not a buyer**, and revenue share is barred. Model Rule 5.4(a) prohibits sharing legal fees with non-lawyers; you paying them creates a Rule 1.7(a)(2) conflict most firms won't paper for a small vendor. |
| Monitoring at $3,000–6,000/month | Roughly 2–3x too high. Privado's Web Auditor is $600/site/month; Osano Enterprise runs ~$2–3k/month for an entire CMP. |
| "The maintained tracker corpus is the moat" | It isn't. Consent Mode `gcs` decoding is free in several browser extensions. |
| Blacklight is the free-tool threat | It isn't. Source-verified: its collector contains no reference to GPC, `Sec-GPC`, `globalPrivacyControl`, `gcs`, or banner interaction. I defended against the wrong tool. |
| $480k year one | ~$204k at defensible pricing. The headline was about 2.4x optimistic. |

**Where the actual differentiation sits.** Not the corpus, and not "the crawler." It is
narrower and more concrete: LawsuitGuard runs no-action/reject/accept with **no GPC pass**;
Privisy runs GPC with **no reject click**. Nobody ships all three states. Nobody was found
adjudicating Meta Limited Data Use. That is a feature gap rather than a moat, and it should
be treated as a head start to convert into relationships, not as a defensible position.

Note also that LawsuitGuard already hash-seals its output and certifies under FRE 902(13)/(14),
so the evidence-packaging position is partly taken. Match it or stop claiming it.

## 4. Structure and economics

**Customer: the scanned company, contracted directly.** Not insurers, not law firms.

**Price:** $7,500 for the assessment. This holds because the comparable is a law firm's
$5k–$25k fixed-fee audit, not a $199 CMP tier — but only if the deliverable contains human
analysis and a named methodology. A machine-generated HTML file does not survive the fact
that a free real-browser GPC scan exists.

**Monitoring: $1,250–1,500 per domain per month, two-domain floor.** Sold as human-triaged
regression review plus a monthly attestation, not as a dashboard.

**Realistic year one:** 8 clients ≈ $204k gross on roughly 500 founder-hours, and less in
year one because monitoring starts mid-year. That is still an excellent return per hour. It
is not $480k.

**The law-firm relationship, structured correctly:** a nonexclusive, disclosed, *unpaid*
mutual referral understanding. When an account has a live trigger — demand letter, CPPA or
AG inquiry, M&A diligence — run that engagement through outside counsel, invoiced to the
firm and passed through as a disbursement **at actual cost** (ABA Formal Op. 93-379 bars
surcharging).

**Privilege, honestly:** a GC-commissioned scan of your own site is a textbook dual-purpose
engagement, and the Ninth Circuit — where CIPA litigation lives — applies the strict
primary-purpose test. Do not promise privilege on untriggered accounts; sell those openly as
ordinary-course compliance work.

**One rule that costs money to follow and is worth it:** never sell the same account both a
counsel-routed assessment and a monitoring subscription covering the same scope. The
subscription contract is the exhibit that destroys privilege over the assessment.

## 5. The monitoring archive is a liability as well as an asset

A standing weekly scan is the paradigm case of ordinary-course activity — unprivilegeable
under any structure — and its archive is a dated record of when the company knew and had not
yet fixed. Two mitigations, both of which should be contractual:

- 90-day rolling retention on raw captures.
- A remediation-status field on every finding, so the archive documents *fixing* rather than
  *knowing*.

## 6. The biggest remaining threat

**Not commoditization and not SB 690. It is that outreach converts at zero because it is
formally indistinguishable from a demand letter.** Delivery is nearly free here; distribution
*is* the business.

Three things de-risk it, in order:

1. **Publish the sector index first, as a hard gate.** It must exist and be public — ideally
   cited once by counsel or press — *before* any named outreach. That converts the email from
   a threat into research follow-up. This moves from "weeks 2–4" to a precondition.
2. **Route to the operator, not to Legal.** Send to whoever owns the tag stack: Director of
   Marketing Ops, Web Analytics, Privacy Ops. They can verify the finding in five minutes,
   they are personally embarrassed by it, and they are not conflict-checking you. Legal is the
   function trained to forward this to litigation counsel.
3. **Lead with § 7025(c)(6)**, per section 2.

## 7. Week one: five falsifying tests before any real time is spent

1. **Run the scanner against 300–500 live domains.** Everything downstream is conditional on
   numbers never measured. Measure four: share transmitting to a third party after a reject
   click; share ignoring GPC; share with no reject control; and false-positive rate against
   20 sites hand-verified as clean.
   **Decision rules, set now:** if post-reject failure is under 20%, the reject hook is not a
   business and the GPC pass leads instead. If false positives exceed 2%, send zero emails
   until it is fixed.
2. **Count how many display the § 7025(c)(6) confirmation.** The prediction is near zero. If
   that holds, it is the lead finding and it is dated, machine-checkable and universal.
3. **Diff against Privisy's free scan and LOKKER's Consent Validator** on five of your own
   targets. Know exactly what you show that free tools do not.
4. **Get one privacy lawyer to read the report** and tell you what they would strike.
5. **Confirm the referral structure with a lawyer** before approaching any firm.

## 8. What is already built

A working engine in this repository, 249 passing tests. Three-pass capture, hybrid
classification over a curated corpus plus 2,142 MIT-licensed entities, consent-signal
decoding, § 7025(c)(6) detection, drift monitoring, outreach drafting with a banned-phrase
guard enforced in code, an anonymised sector index, and a one-command campaign runner.

**Not yet validated against live websites** — the sandbox blocks arbitrary egress. That is
task one above, and the whole plan is downstream of it.

## 9. Where I would bet on the genuinely ambiguous question

Nobody verified whether regulator-driven demand converts at all. My bet: it converts
**slower but better** — a 2–3x longer sales cycle, a buyer with a standing budget line
rather than a one-time panic, and materially better retention, because a compliance
obligation recurs and a demand letter does not.

Plan cash for the longer cycle. That is the trade being made, and it is the right one.
