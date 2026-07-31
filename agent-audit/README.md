# Agent audit

Detects whether a company's public AI agent contradicts the company's own published policies.
Measured from outside, requiring nothing from them.

The claim it makes is deliberately narrow: not "your chatbot is inaccurate" — which needs the
company's internal ground truth and invites argument — but "your agent said 90 days, your
returns page says 30." Both sides are public, and the reader settles it in under a minute.

That is the failure that made Air Canada liable for its chatbot's invented bereavement policy
in [Moffatt v. Air Canada](https://www.mccarthy.ca/en/insights/blogs/techlex/moffatt-v-air-canada-misrepresentation-ai-chatbot).

See [BUSINESS_PLAN.md](BUSINESS_PLAN.md) for the economics and what is still unproven.

## Quick start

```bash
npm install                    # from the repo root, installs all workspaces
npm test -w agent-audit        # 24 tests

# one target
node cli.js audit example.com

# batch: audits, ranked queue, reports and drafted first messages
node cli.js campaign --sender="Your Name" --out=runs/august acme.com globex.com
```

## How it works

1. **Read the published policy.** Fetch the conventional policy paths and extract claims with
   a numeric value — durations, amounts, percentages. Numbers attributed to no policy area are
   dropped rather than guessed at.
2. **Ask the agent.** One ordinary customer question per policy area, in several independent
   sessions with a fresh browser each time. No conversation history carries over, because a
   reused context makes reproduction meaningless.
3. **Compare.** Report a contradiction only when the agent asserted a value of the same kind
   and it differs, and only when that recurs across sessions.

## What it refuses to do

Each of these exists because the alternative produces findings a reader can argue with, and an
arguable finding is worse than none:

- **Numbers only.** Semantic disagreement between two pieces of prose is never reported.
- **Reproduction required.** One divergent answer from a language model proves almost nothing.
- **Hedges are not assertions.** "Typically around 30 days, but please check" cannot contradict
  a policy. Judged per sentence, so a qualifier on an unrelated aside does not mask an
  asserted contradiction elsewhere.
- **No prompt injection or jailbreak probing.** Questions are what a customer would ask. The
  moment this becomes adversarial testing of a system nobody hired us to test, it stops being
  an audit.
- **No legal conclusions.** Enforced in code. The outreach generator additionally blocks
  characterising intent ("lied", "misled"), the word "hallucination", and any invocation of the
  Air Canada precedent as leverage — their counsel already knows it, and raising it turns a
  helpful note into a threat.

## Restraint is a design requirement

Every probe spends the target's money on model inference. That makes this more intrusive than
loading a page, and the defaults reflect it: one question per policy area, sessions run
sequentially, pauses between everything, low concurrency. `--reply-wait` and `--between-runs`
exist for testing against local fixtures, not for speeding up real campaigns.

## Layout

```
src/
  policy.js         extract checkable claims from published policy pages
  agentprobe.js     drive the chat widget, capture replies across sessions
  contradiction.js  compare replies to claims; decide what is reportable
  agentaudit.js     the two halves joined, end to end
  agentreport.js    client-facing HTML report
  outreach.js       first-contact drafts, with the agent-specific copy guard
  campaign.js       batch runner producing a ranked queue
```

Shared with the consent product via `@evidence/shared`: browser launch, scan history, target
discovery, and the banned-phrase guard.

## Status

Validated against a fixture that reproduces a stale-corpus agent — the failure mode is one I
chose, so the engine is proven correct but the *prevalence* is not. It has not been run against
live agents; this sandbox blocks arbitrary egress.

First task in an unrestricted environment: 20 retailers with a visible chat widget and a
published returns page.
