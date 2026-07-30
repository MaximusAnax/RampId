# Deep dive: EU AI Act Article 50 (live 2 August 2026)

Written 30 July 2026 — three days before the obligation takes effect.

## What the obligation actually says

Article 50 of Regulation (EU) 2024/1689 imposes transparency duties on providers and
deployers of four categories of AI system, **independent of whether the system is
"high-risk."** This is the part most companies got wrong: they read that high-risk was
delayed to December 2027 and concluded the AI Act stopped applying to them. Article 50
was not delayed.

| Provision | Obligation | In force |
|---|---|---|
| 50(1) | Systems interacting directly with people (chatbots, voice assistants) must make it clear to a reasonably informed user that they are talking to an AI, at the latest at first interaction | **2 Aug 2026** |
| 50(2) | Generative systems must mark outputs in a **machine-readable** format, detectable as artificially generated | 2 Aug 2026; systems already on market get until **2 Dec 2026** |
| 50(3) | Emotion recognition / biometric categorisation must inform exposed persons | 2 Aug 2026 |
| 50(4) | Deepfakes must be disclosed as artificially generated; AI-generated text published to inform the public on matters of public interest must be disclosed | **2 Aug 2026 — no grace period** |

Narrow carve-outs: where AI use is already obvious from context, and for legally
authorised law-enforcement uses.

## Who is on the hook

Far more companies than realise it. The rule is extraterritorial in the same way GDPR is:
**providers established outside the EU are in scope where they place systems on the EU
market or where the system's output is used in the EU.** Deployers outside the EU are in
scope where the output is used in the EU.

In practice: any company with a customer-facing chatbot, an AI content generator, or
AI-written published copy that EU users can reach. A US SaaS company with a support bot on
its marketing site and EU customers is in scope and mostly does not know it.

Deployers who substantially configure a system carry duties too — so buying a chatbot
from a vendor does not transfer the obligation away.

## The penalty

Up to **€15,000,000 or 3% of total worldwide annual turnover for the preceding financial
year, whichever is higher.** EU institutions face a separate €750,000 cap.

"Whichever is higher" is the phrase that makes this sellable. For a company with €500M
revenue the exposure is €15M; for one at €2B it is €60M. Against that, a five-figure
remediation fee is a rounding error, and that asymmetry is the entire commercial argument.

## Enforcement reality — the honest caveat

Enforcement sits with **national market surveillance authorities** designated by each
member state, not with a single central regulator. The AI Office's role is limited to
systems built on general-purpose models where the same entity provides both, or systems
integrated into a VLOP/VLOSE under the DSA.

Two things follow, and I should not oversell past them:

1. Member states have been uneven in designating and resourcing these authorities. Day-one
   mass enforcement is unlikely.
2. The realistic near-term risk to a company is not a €15M fine on 3 August. It is
   complaint-driven investigation, procurement questionnaires from EU customers, and
   competitor/press attention.

That does not defeat the opportunity, but it changes the pitch. Selling "you will be fined
next week" is false and would burn credibility. Selling "you are visibly non-compliant
with a regulation that is now in force, this is externally checkable by anyone including
your customers and your competitors, and here is your exposure" is true and is stronger,
because it survives the buyer's lawyer reading it.

## Why this shape is unusually favourable

The property that matters most, from the decision framework: **compliance with 50(1) and
50(4) is externally observable.** Anyone can visit a company's public site, open its
chatbot, and see whether it discloses itself. No client relationship, no data-sharing
agreement, no NDA, no integration is required to determine that a specific named company
is non-compliant.

This collapses two of the three hard problems at once:

- **Cold start** — the product can be built and validated end to end against real
  companies before a single customer exists.
- **Sales** — the audit output *is* the outreach. A message that says "your assistant at
  this URL does not disclose itself, here is the screenshot and the article it engages"
  is a specific factual claim about the recipient, not a pitch.

The third problem — delivery hours — is also favourable, because the scan is automated and
the remediation for 50(1) is genuinely small engineering work.

## Open questions to resolve before committing

1. How many companies are actually non-compliant? If it is 5%, the market is too thin. I
   need to measure this empirically rather than assume it.
2. Who already sells this? The compliance-tooling space is crowded and well-funded.
3. Is the buyer's willingness to pay real, or does an engineer fix 50(1) in an afternoon
   once told? **This is the biggest commercial risk: the remediation may be too easy.**
   If so, the business is in the detection, evidence, and ongoing monitoring — not the fix.

Sources:
[Article 50 text](https://artificialintelligenceact.eu/article/50/),
[Commission FAQ](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act),
[Article 99 penalties](https://artificialintelligenceact.eu/article/99/),
[Stibbe on scope and timeline](https://www.stibbe.com/publications-and-insights/the-ai-acts-transparency-obligations-rules-scope-and-timeline),
[enforcement and fines](https://www.aiactblog.nl/en/posts/article-50-enforcement-fines-ai-act-2026),
[what comes due 2 Aug](https://compliancehub.wiki/eu-ai-act-article-50-transparency-digital-omnibus-2026/)
