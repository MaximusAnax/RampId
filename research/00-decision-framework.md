# Decision Framework

The single metric: **maximal projected profit per unit of founder time.**

Not revenue. Not TAM. Not "cool factor." Profit ÷ founder-hours.

## Why this changes everything

Most business advice optimizes for total revenue or enterprise value. Optimizing for
profit-per-founder-hour inverts several standard conclusions:

| Standard advice | What this metric says instead |
|---|---|
| Go enterprise, big ACVs | Only if the sales cycle doesn't eat 200 founder-hours per deal |
| Build a SaaS platform | Only if onboarding/support is near-zero touch |
| Hire to scale | Every hire adds management hours; prefer AI labor and no headcount |
| Raise capital | Fundraising is the single worst hours-to-dollars activity available |
| Custom work pays more | Custom work is linear in founder time; it caps the metric permanently |

## The formula

```
Score = (ACV × GrossMargin × Retention_years × Clients_reachable)
        ────────────────────────────────────────────────────────
        (Hours_to_build + Hours_to_sell×Clients + Hours_to_deliver×Clients)
```

The denominator is what kills businesses under this metric. Three terms, three rules:

1. **Hours_to_build** is a one-time cost — it can be large if the asset is reusable.
   AI labor makes this term cheap. This is the term to spend on.
2. **Hours_to_deliver × Clients** must approach zero, or the business is a job.
   Anything requiring per-client customization, integration, or human judgment fails here.
3. **Hours_to_sell × Clients** is the assassin. Every high-ticket B2B business dies here.
   This is the term that decides the winner.

## Hard filters (auto-reject)

A candidate is rejected outright, regardless of upside, if any of these are true:

- **Licensing blocker.** Legally requires a licensed attorney, CPA, accredited auditor,
  or state-registered agent that the founder does not hold.
- **Regulated data blocker.** Cannot start without PHI/BAA, bank credentials, or similar.
  Getting compliant burns months before the first dollar.
- **Integration tax.** Requires per-client integration into their EHR/ERP/CRM to deliver
  value. This makes Hours_to_deliver permanently non-zero.
- **Cold-start dependency.** Cannot produce anything valuable until a client gives us data.
  Kills the ability to build and prove the product before selling it.
- **Trust-gated purchase.** The buyer will not purchase from an unknown solo vendor at
  any price, because the purchase carries career risk (most CISO-budget purchases).
- **Well-funded, fast-moving incumbents** already owning the exact wedge with a
  meaningfully better distribution position.

## Scoring dimensions (1–10 each)

| Dimension | 10 looks like | 1 looks like |
|---|---|---|
| ACV | $100k+ | under $5k |
| Delivery hours/client | under 5 | 100+ |
| Sales hours/deal | inbound, self-serve, card payment | 6-month enterprise cycle |
| Urgency | hard deadline with fines | "nice to have someday" |
| Solo-buildable | weeks, no license, no partner | needs a team and credentials |
| Recurring | annual subscription, high retention | one-shot project |
| Cold-start | full product buildable from public data | needs client data to exist |
| Whitespace | no credible competitor | 10 funded startups |

## The two questions that actually decide it

Everything above is scaffolding. In practice, two questions separate a real answer from a
plausible-sounding one:

**1. Can we produce something specifically valuable about a named target company, from
public data, before they are a client?**

If yes, the cold-start problem and the sales problem collapse into a single solved
problem: the artifact that proves the product *is* the outreach. That is the only known
way to get Hours_to_sell down while keeping ACV up. If no, we are cold-calling strangers
with a pitch deck, and the metric craters.

**2. Is there a deadline?**

Urgency is what compresses a six-month enterprise sales cycle into three weeks. Without
an external forcing function, the buyer's default is always "not this quarter," and the
founder pays for that delay in hours. Regulation with fines is the strongest known
forcing function. Competitive fear is the second.

A candidate that answers both with a confident yes beats a candidate with twice the ACV.

## Pricing rule

Price under the buyer's discretionary-approval threshold wherever possible. A deal that
clears without procurement, legal, and security review closes in days instead of quarters,
and the hours saved are worth more than the incremental price. Expand later; land below
the line first.
