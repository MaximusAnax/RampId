# Operator runbook

The point of this document is to make your involvement small and bounded. Everything
below is written as "what you personally do," with the machine doing everything else.

If a step here takes you more than the stated time, that step is a bug in the business and
should be automated before it is repeated.

---

## The weekly loop

| When | You do | Machine does | Your time |
|---|---|---|---|
| Monday | Approve a target list | Scan it, rank by exposure, draft outreach | 20 min |
| Monday | Read the top 20 drafts, send the ones you'd stand behind | Nothing | 40 min |
| Wednesday | Reply to responses, book calls | Nothing | 30 min |
| Thursday | Run 2–3 discovery calls | Nothing | 90 min |
| Friday | Skim the monitoring digest for existing clients | Scan every client, diff, triage | 15 min |

Roughly **three hours a week** at steady state. Delivery is not on this list because
delivery is the report, and the report generates itself.

---

## First-time setup

```bash
cd scanner
npm install
npm test          # everything should pass before you trust any output
```

Two things to verify once, because both have bitten already:

1. **Playwright's bundled browser must match the installed Playwright version.** If you see
   "Executable doesn't exist," either pin the version or point at your system Chromium.
2. **Do not route the browser through an intercepting proxy.** A proxy that re-signs TLS
   stops sub-resources loading, so pages render empty and *every tracker looks absent*.
   That is a silent false negative — the worst failure this system can have, because the
   output looks like good news. Proxy use is opt-in via `A50_PROXY` for exactly this reason.

---

## Prospecting: turning compute into a pipeline

```bash
node cli.js consent --out=runs/2026-08-retail $(cat targets.txt)
```

This writes a client-ready HTML report per target plus `consent.json`, and prints targets
ranked by exposure score.

**On volume and politeness.** Against local fixtures the engine sustains roughly 2,600
sites/hour at concurrency 4. Do not plan around that number. Real sites are heavier, farther
away, and deserve rate limiting; assume a small fraction of it and keep concurrency low.
Being a good neighbour is not only courtesy here — this business's entire legal posture
rests on behaving like an ordinary visitor, and a scanner that hammers origins undermines
that in a way no disclaimer repairs.

**What to do with the ranking.** Work the top of the list, but read before you send. The
one thing that must never happen is sending a finding that is wrong. Spend thirty seconds
per target confirming the finding is real and specific. If you cannot verify it quickly,
neither can their engineer, and it will be dismissed.

---

## Before any outreach at all: publish the index

This is a gate, not a phase. The aggregate sector index must exist, be public, and ideally
have been cited once by counsel or press **before** the first named email goes out.

The reason is blunt. An email that opens "we scanned your site and here is the tracker that
fired" has the same first sentence as the demand letters a handful of volume plaintiff firms
send to hundreds of brands weekly, using the same scanning technique. Recipients' counsel
have trained them to forward those and never reply. Publishing first converts your message
from a threat into research follow-up, and it is the difference between a reply rate and
nothing at all.

```bash
node cli.js campaign --sector="US retail" --out=runs/index-build $(cat sector-list.txt)
# then publish runs/index-build/sector-index.html
```

## Outreach: the rules that matter more than the copy

**Lead with the section 7025(c)(6) display requirement, not with the tracker.** Since
1 January 2026 a business that processes an opt-out preference signal must display that it
has done so. "The regulation requires your site to show this, here is what yours shows" is a
compliance observation. "Here is the pixel that fired" is, in form, a demand letter. Same
scan, opposite category. The generator already orders it this way — do not reorder it.

**Send to the operator, not to Legal.** Director of Marketing Ops, Web Analytics, or Privacy
Ops. They own the tag stack, they can verify your finding in five minutes, they are
personally embarrassed by it, and they are not conflict-checking you. Legal is the function
trained to forward this to litigation counsel. Privilege only matters once there is a
trigger, and by then counsel is introducing you anyway.

The first message contains a true, specific, checkable fact about the recipient's own site.
Not a pitch, not credentials, not a value proposition.

**Never state a legal conclusion.** "This request was sent to facebook.com/tr before any
consent interaction" is a fact. "You are violating CIPA" is a legal conclusion, which is
unauthorized practice of law and also reframes you as a demand-letter mill — the exact
category your buyers already resent and pay lawyers to fight. The generator enforces a
banned-phrase list in code rather than trusting discipline; leave that guard in place.

**Never sell "AI."** After MIT's finding that roughly 95% of enterprise generative-AI pilots
produced no measurable P&L impact, "AI-powered" reads as a negative signal to a 2026 buyer.
Sell the observed finding.

**Volume is capped by policy, not by ambition.** Since Microsoft's May 2025 and Google's
late-2025 bulk-sender enforcement, a spam complaint rate above 0.3% causes outright
rejection rather than spam-foldering. One list of 200 named accounts with real findings,
never 20,000. This constraint is a gift: it forces the targeting that makes the message work.

---

## Delivery: the part that should cost you almost nothing

The report is the deliverable. Your involvement is reading it once before it goes out.

Check three things, in this order:

1. **Is any finding wrong?** One false accusation costs more than ten missed prospects.
2. **Does the "what this method cannot see" section survive their scrutiny?** It should.
   It exists so a technical reader trusts the rest, and it is a sales asset rather than a
   disclaimer.
3. **Did the scan actually capture?** A failed scan renders as explicitly inconclusive
   rather than clean, but confirm it, because an empty result and a clean result mean
   opposite things.

---

## Monitoring: where the money actually is

```bash
node cli.js monitor --data=clients --out=runs/weekly $(cat clients.txt)
```

This scans every client, compares against their last scan, and prints only what moved:
regressions first, then improvements, then anything that could not be compared.

**Read only the regressions.** That is the entire point of triage. If you find yourself
reading a wall of unchanged targets, the digest is broken.

**Two failure modes to know about**, both of which have already been fixed and both of
which would have been invisible:

- A stored scan is a *record wrapping* the scan. Comparing the record instead of the scan
  yields "not comparable" every cycle, which looks exactly like a working monitor on a
  client whose site never changes. If alerts go quiet across every client at once, suspect
  this shape of bug rather than a quiet month.
- A scan that fails to load records no trackers, which is indistinguishable from a client
  having fixed everything. The system refuses to report drift from a failed capture. Never
  remove that guard to make a digest look better.

**Why clients renew.** Every new marketing tag re-breaks the configuration. You are not
selling vigilance, you are selling the fact that their own release process keeps
reintroducing the problem, and that nobody internally is watching for it.

**Price it at $1,250–1,500 per domain per month, two-domain floor.** The original $3–6k was
2–3x too high against real comparables: Privado's Web Auditor is $600/site/month and Osano
Enterprise runs roughly $2–3k/month for an entire consent platform.

**The archive is a liability as well as an asset.** A standing weekly scan is ordinary-course
activity, so it is unprivilegeable under any structure, and its history is a dated record of
when the client knew and had not yet fixed. Two things make that survivable, and both belong
in the contract: 90-day rolling retention on raw captures, and a remediation-status field on
every finding so the archive documents fixing rather than knowing.

**Never sell one account both a counsel-routed assessment and monitoring covering the same
scope.** The subscription contract is the exhibit that destroys privilege over the
assessment.

---

## The channel, which is worth more than any outreach improvement

Selling one company at a time means solving trust-transfer once per customer. Selling
through privacy counsel means solving it once per firm.

Counsel are the natural partner because they are asked about this constantly and **cannot
produce the technical evidence themselves** — they bill $600–900/hour to read someone
else's scan. You make their work cheaper and better.

Two things to get right before you approach a firm, both of which are still open questions
flagged in the business plan and should be confirmed with a lawyer:

1. **Fee sharing is barred, so do not plan around it.** Model Rule 5.4(a) prohibits sharing
   legal fees with non-lawyers, and you paying the firm for referrals creates a Rule
   1.7(a)(2) conflict most privacy firms will not paper for a small vendor. The workable
   arrangement is a nonexclusive, disclosed, *unpaid* mutual referral understanding. Your
   money comes from the engagement itself.
2. **Privilege does not come free from involving a GC.** A GC-commissioned scan of your own
   site is a textbook dual-purpose engagement, and the Ninth Circuit — where CIPA litigation
   lives — applies the strict primary-purpose test. For accounts with a live trigger (demand
   letter, CPPA or AG inquiry, M&A diligence), run the engagement through outside counsel,
   invoiced to the firm and passed through as a disbursement **at actual cost** — ABA Formal
   Op. 93-379 bars surcharging. For untriggered accounts, do not claim privilege at all; sell
   openly as ordinary-course compliance work.

Confirm both with a lawyer before approaching a firm. They determine how you contract, not
whether you have a business.

---

## Things that will tempt you, and why not to

**Lowering the evidence bar to increase volume.** The system is deliberately biased toward
"needs review" over accusation. Every relaxation buys prospects and spends credibility, and
credibility is the only asset here that cannot be rebuilt with compute.

**Reporting every tracker.** Fonts and CDNs firing pre-consent are not the finding anyone
buys, and including them buries the ones that matter under noise a reader will dismiss —
taking the credible findings down with them.

**Flagging tags that signal consent denied.** Google Consent Mode and Meta's Limited Data
Use are designed so a tag can fire while transmitting that consent was denied. Reporting
those is the fastest way to be dismissed by the engineer checking your work.

**Hiring.** Every hire adds management hours to a business whose entire premise is that the
denominator stays small. If you need capacity, spend it on the crawler.
