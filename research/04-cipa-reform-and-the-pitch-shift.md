# The CIPA reform question, and why it shifts the pitch rather than killing it

Verified independently on 30 July 2026, because this was the largest identified extinction
risk to the business and the answer determines what the product leads with.

## What is actually happening to CIPA

**SB 690 is advancing but is not law.** On 1 July 2026 a California legislative committee
advanced amendments that would eliminate private suits asserting website-based *pen
register* claims under Penal Code § 638.51, leaving enforcement of that section exclusively
to the Attorney General. The bill passed the Senate 35–0 back in June 2025, then stalled in
the Assembly.

It still requires Assembly passage, Senate concurrence in any Assembly amendments, and the
Governor's signature. If enacted this session it becomes operative **1 January 2027**,
absent an urgency clause. Duane Morris' summary is blunt: CIPA liability remains at least
through 2026.

Two things follow that matter more than the headline:

1. **The scope is narrower than "CIPA reform" suggests.** SB 690 as amended targets the
   § 638.51 pen-register theory. That theory has been a major driver of the recent filing
   wave, so removing it matters — but it is not the whole statute, and § 631 wiretapping
   claims are a separate question.
2. **It does nothing to regulator enforcement.** Stripping a private right of action moves
   enforcement to the Attorney General. It does not reduce the obligation; it changes who
   polices it.

## The finding that actually reframes the business

From the coverage of the 2026 enforcement wave, describing how the California Privacy
Protection Agency is working:

> The CPPA is testing opt-out mechanisms in real browsers, on real devices, across real
> advertising and analytics vendor stacks, and when the mechanism fails the technical test,
> the fine follows.

**The regulator is running the same test this product runs.** That is the single most
useful sentence found in all of this research. It means the product is not asserting a
novel theory of risk that a buyer has to be talked into — it is reproducing, in advance,
the exact examination the regulator will perform.

Look at what the 2026 actions were actually about:

| Action | Amount | What went wrong |
|---|---|---|
| Disney / ABC (AG, 11 Feb 2026) | $2.75M | Websites and apps **continued sharing data with advertising partners after consumers opted out** |
| PlayOn Sports (CPPA) | $1.1M | No clear way to opt out of sale/sharing |
| Honda (CPPA) | $632,500 | Connected-vehicle privacy, opt-out flow |
| Ford (CPPA, 5 Mar 2026) | $375,703 | Required email verification before processing an opt-out — friction in the mechanism |

The Disney matter is precisely the scanner's third pass: transmission continuing after the
user opted out. Ford is asymmetric-friction in the opt-out flow, which the scanner detects
as a missing or unreachable reject control.

## What this changes

**Lead with the regulator, not the plaintiffs' bar.** The original plan leaned on ~3,968
active CIPA cases and $5,000 statutory damages per violation. That framing has two problems:
it depends on a private right of action that California is actively moving to curtail, and
it puts the seller uncomfortably close to the demand-letter mills buyers already resent.

Regulator framing is better on every axis:

- It survives SB 690 entirely. If anything, SB 690 concentrates enforcement in the AG's
  office, making the regulator's technical test *more* determinative rather than less.
- It is a stronger sale. "The agency tests this in a real browser and fines what fails, and
  here is what your site does in that test" is more compelling and more defensible than
  "you might get sued."
- It keeps the seller on the right side of the demand-letter comparison. You are helping a
  company pass an examination, not threatening them with one.

**Keep private litigation as context, not as the thesis.** It is still real through 2026
and § 631 exposure is unresolved. But it should be a supporting fact in the report's
enforcement-context section, not the reason the buyer is being contacted.

## The residual risk, stated honestly

If SB 690 passes and private pen-register suits end on 1 January 2027, some urgency does
leave the market — companies fear lawsuits more viscerally than agency examinations, and
the demand-letter volume that makes this problem salient inside a company would fall.

The mitigation is the one already built: the crawler is the asset and the rule it reports
against is swappable. Regulator enforcement is now module one's framing; EU AI Act Article
50 is already implemented as a second module; accessibility is the obvious third. If
California narrows, the same capture pipeline reports against a different obligation for a
different buyer.

That is the whole reason the architecture was built that way, and this finding is the first
real test of that decision.

Sources:
[Duane Morris — SB 690 stalls in Assembly](https://www.duanemorris.com/alerts/california_sb690_stalls_assembly_cipa_liability_remains_least_through_2026_0725.html),
[Covington — Legislature advances bill targeting pen register suits](https://www.insideprivacy.com/state-privacy/california-legislature-advances-bill-targeting-wave-of-cipa-pen-register-lawsuits/),
[Troutman — SB 690 amended](https://www.troutman.com/insights/sb-690-amended-california-moves-to-strip-private-right-of-action-for-pen-register-claims/),
[Alston & Bird — reform advances as claims persist](https://www.alston.com/en/insights/publications/2026/07/california-sb-690-reform-cipa-claims),
[PrivacyLawMap — 2026 enforcement wave](https://privacylawmap.com/blog/ccpa-enforcement-wave-2026),
[Koley Jessen — lessons from 2026's first enforcement actions](https://www.koleyjessen.com/insights/publications/lessons-for-businesses-from-2026s-first-california-privacy-enforcement-actions),
[Ford opt-out friction fine](https://www.uniconsent.com/blog/ford-ccpa-fine-opt-out-friction)
