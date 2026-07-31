# Outside-in evidence

Two businesses built on one idea: **measure something about a company from the public
internet that the company cannot see about itself, and that costs it money.**

Both require nothing from the target — no access, no credentials, no data, no integration.
That is the structural property that lets an unknown solo operator sell to a large
enterprise, because there is no vendor security review to fail when there is nothing to
review. It is also what makes the audit itself the outreach.

| | What it measures | The named stakes |
|---|---|---|
| **[consent-evidence/](consent-evidence/)** | What a website transmits to third parties before consent, under an opt-out signal, and after the visitor clicks reject | California regulators run the same test — Disney/ABC $2.75M, GM $12.75M |
| **[agent-audit/](agent-audit/)** | Whether a company's public AI agent contradicts the company's own published policies | *Moffatt v. Air Canada* — a company is liable for what its chatbot says |

## Layout

```
shared/            browser launch, scan history, target discovery, copy guard
consent-evidence/  tracking and consent behaviour     · BUSINESS_PLAN · RUNBOOK
agent-audit/       AI agent policy contradiction      · BUSINESS_PLAN
research/          how the decisions were made, including what was rejected
```

```bash
npm install     # installs all three workspaces
npm test        # runs all three suites
```

## The principles both products share

None of these is a technical preference. Each was learned the expensive way, and each is
enforced in code rather than left to discipline:

**A false positive costs far more than a false negative.** An audit that accuses a compliant
company destroys the credibility the whole business runs on. Ambiguity always resolves to
"needs review", never to an accusation.

**Never state a legal conclusion.** "This request was sent" and "your agent said 90 days,
your policy says 30" are observations. "You are in violation" is unauthorized practice of
law, and it converts a prospect into an adversary. A shared banned-phrase guard throws on any
generated copy that crosses the line.

**An empty result and a clean result mean opposite things.** A scan that could not load, an
agent that could not be opened, a page served behind a bot challenge — all render as
explicitly inconclusive, never as good news. Most of the serious bugs found in this codebase
were of exactly this shape: a failure whose output looked like success.

**The evidence must be checkable in about a minute.** Every finding quotes the raw request or
the transcript alongside the company's own published words, with the source. A reader who has
to take anything on trust will not act.

## What neither has yet

**Live validation.** Both engines are proven correct against fixtures that reproduce real
behaviour — real consent-manager markup for one, a stale-corpus agent for the other — but
neither has run against live sites, because the sandbox they were built in blocks arbitrary
egress.

Both business plans name the same first task and set decision rules in advance: scan real
targets, measure the true failure rate, and abandon the lead finding if the rate does not
support it. Everything else in both plans is downstream of that measurement.
