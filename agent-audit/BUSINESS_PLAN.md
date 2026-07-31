# Agent audit — business plan

**The product:** evidence that a company's public AI agent contradicts the company's own
published policies. Measured from outside, requiring nothing from them.

**Target:** $1M/year, on fewer and larger relationships than the consent product needs.

---

## 1. The problem

Companies deployed customer-facing AI agents faster than they built any way to check what
those agents say. The agent answers from a retrieval corpus that goes stale exactly the way
tag configurations drift: someone updates the returns policy page, nobody re-indexes, and
the agent keeps quoting a superseded number to every customer who asks.

Nobody inside catches it, for the same structural reason the tracking problem persists. The
team that owns the agent tests it against its own assumptions. Nobody is systematically
asking it the questions a customer asks and checking the answers against the company's own
published pages.

## 2. Why it costs them money

[Moffatt v. Air Canada (2024 BCCRT 149)](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot)
settled the question. Air Canada's chatbot invented a bereavement fare policy; the tribunal
held the airline to it, ruling that "the applicable standard of care requires a company to
take reasonable care to ensure their representations are accurate and not misleading." A
company cannot disclaim what its agent says. [By 2026 the framing is settled enough to be a
headline](https://www.pymnts.com/news/artificial-intelligence/chatbot-tracker/2026/courts-tell-companies-they-own-what-their-chatbot-says):
courts tell companies they own what their chatbot says.

Two things followed that matter commercially:

- **FINRA's 2026 oversight report** named hallucinations as a compliance concern for
  broker-dealers, with an instruction to build procedures for agents acting beyond intended
  scope.
- **An insurance market now exists.** [Armilla is a Lloyd's coverholder writing standalone AI
  liability cover](https://www.quotesweep.com/insurtech/armilla) — first policy April 2025,
  limits above $25M by January 2026, backed by Chaucer, Axis, Convex, Swiss Re and Greenlight
  Re. Critically, **every policy includes independent AI system certification**.

That last point is the forcing function the consent product lacks. An insurance market that
*requires* independent technical assessment creates a buyer who has to buy.

## 3. The framing, which is the whole product

**Do not sell "is your chatbot accurate."** That needs the company's internal ground truth,
invites argument about whose standard applies, and puts you in a fight you cannot win from
outside.

**Sell "does your public agent contradict your own published policies?"**

Both sides of that comparison are public. The finding becomes:

> Your agent told a customer returns are accepted within 90 days. Your published returns page
> says 30 days. Reproduced in 3 of 3 independent sessions, transcripts attached.

Not an opinion. The same evidential quality as "this HTTP request was sent," and the reader
settles it in under a minute by opening their own chat widget.

## 4. Scope discipline, and why it is non-negotiable

The engine reports far less than it could see, and every restriction below exists because the
alternative produces arguable findings:

| Rule | Why |
|---|---|
| **Numbers only** — durations, amounts, percentages | A contradiction between two pieces of prose is arguable. A contradiction between 30 and 90 is not. |
| **Reproduction required** across independent sessions | Models are non-deterministic. One divergent answer proves almost nothing, and accusing a company on one sample is indefensible. |
| **Hedged answers never contradict** | "Typically around 30 days, but please check" is not a policy assertion. Holding a company to a qualified statement is the overreach that gets a report dismissed. |
| **Hedging judged per sentence** | Judging per reply is too blunt — a qualifier on an unrelated aside would suppress a firmly asserted contradiction elsewhere in the same answer. |
| **No prompt injection, no jailbreak probing** | The moment this becomes adversarial testing of a system nobody hired us to test, it stops being an audit and the legal posture changes entirely. |

Instability is reported separately: an agent that answers the same question three different
ways is unreliable even where no answer contradicts the policy, and that finding needs no
argument about which answer was right.

## 5. Economics

Enterprise [compliance program design runs $50–150k with monitoring retainers at
$3–8k/month](https://infosecurix.com/2026/07/05/compliance-consulting-fees-in-2026-a-strategic-guide-to-budgeting-for-security-standards/).
This category is newer than privacy and has no established price anchor, so it supports the
upper half of that range.

| Line | Structure | Revenue |
|---|---|---|
| Assessment | 10 × $35k | $350k |
| Monitoring | 10 × $7k/month | $840k |
| **Total** | | **~$1.19M** |

Roughly 8–10 accounts, which is far fewer relationships than $1M through the consent product
would require.

**Why monitoring is a stronger sale here than for tracking.** Tracking configurations drift
when marketing ships. Agent behaviour changes when the *model provider* ships — a version
update, a prompt change, a re-indexed corpus — none of which the client controls or
necessarily notices. Every model update invalidates all prior testing. That is a more honest
reason to re-test monthly than tag drift, and clients already believe it.

## 6. Competition, honestly

The space is not empty. [Dojo Labs sells chatbot accuracy
audits](https://dojolabs.co/blog/chatbot-accuracy-audit-what-it-covers/) — 200–500 prompts,
risk-ranked report, 5–10 business days. Synack and Warden AI do adjacent assessment work.
Scaled Cognition raised $100M in June 2026 for enterprise hallucination controls.

Two things distinguish this:

1. **They are commissioned; this is not.** Every one of those requires the company to hire
   them first. This audit runs uninvited from public surfaces, which means the audit itself
   is the outreach — the same structural advantage the consent product has.
2. **Their delivery is manual.** "5–10 business days" for 200–500 prompts is people doing
   work. That is the pricing umbrella, and an automated version that runs continuously is a
   different product at a different cost base.

## 7. What is unproven

**Whether real agents fail this way often enough.** The fixture in this repository is a mock
whose failure mode I chose. My expectation is that retrieval corpora go stale exactly the way
tag configurations drift — but that is the same unmeasured assumption the consent product
rests on, and it deserves the same skepticism.

**The test:** 20 retailers with a visible chat widget and a published returns page. Measure
what share contradict themselves, and what share answer inconsistently across sessions.

**Decision rules, set now:**
- If under 15% show a reproduced contradiction, the conflict finding is not the lead and
  answer-instability becomes the product.
- If false positives exceed 2% against hand-verified agents, send nothing until fixed.

## 8. One thing to get right operationally

**Every probe spends the target's money.** Unlike loading a page, each question costs them
model inference. The engine already reflects this — one question per policy area, sequential
sessions, pauses between everything, low concurrency — and those defaults should not be
relaxed to speed up a campaign. Restraint here is not politeness theatre; it is what keeps
this an audit rather than something a recipient could reasonably characterise differently.
