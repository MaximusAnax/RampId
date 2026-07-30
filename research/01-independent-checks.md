# Independent verification of two load-bearing assumptions

I checked these myself rather than delegating, because almost every candidate direction
rests on one or both of them, and if either is false a lot of options die at once.

## 1. Is a product built on scraped public data legally defensible in 2026?

**Yes, with well-defined boundaries.** Two rulings set the line:

- *hiQ Labs v. LinkedIn* (9th Cir., 2019–2022): the Computer Fraud and Abuse Act does not
  reach automated collection of publicly accessible data. hiQ's separate problem was
  hiring contractors to create fake accounts to reach logged-in data — that part crossed
  the line.
- *Meta v. Bright Data* (Jan 2024): Meta lost on summary judgment because it could not
  show Bright Data scraped behind a login wall.

The operative boundaries for anything I build:

1. **Never bypass authentication.** Public-without-login is defensible; behind-a-login is not.
2. **Personal data still triggers GDPR/CCPA** even when public. Prefer company-level data
   over person-level data.
3. **Extract facts, not creative expression.** Facts aren't copyrightable; prose is.
4. **Rate limit.** Causing server harm converts a civil-terms question into a tort.

Practical consequence: a business whose raw material is public, company-level, factual
data sits on solid ground. That keeps the "build the product before having a client"
strategy alive, which the decision framework says is the single most valuable property a
candidate can have.

Sources: [hiQ explained](https://www.lection.app/blogs/hiq-labs-vs-linkedin-case-explained),
[Meta v. Bright Data](https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm),
[2026 scraping rules](https://cloro.dev/blog/website-scraping-legal/)

## 2. Is the EU AI Act still a forcing function? — a correction that matters

I expected this to be the strongest deadline available. It is half true, and the half that
is false would have been an expensive mistake.

**The high-risk deadline is gone.** The Digital Omnibus simplification package received
final Council approval on 29 June 2026. Annex III stand-alone high-risk obligations moved
to **2 December 2027**; Annex I embedded-product obligations to **2 August 2028**. Anyone
still selling "get ready for August 2026 high-risk compliance" is selling a deadline that
no longer exists. That kills the most obvious version of the compliance play — the buyer
now has eighteen extra months to not care.

**But Article 50 was not delayed.** Transparency duties still take effect **2 August 2026**
— three days from today. They cover:

- chatbot disclosure (users must be told they are talking to an AI)
- AI-content marking (machine-readable marking of synthetic content)
- deepfake labeling

The Commission's GPAI enforcement powers also activate the same day.

Article 50 is narrower than the high-risk regime but it is live, imminent, and it applies
to a far larger population: essentially every company running a customer-facing chatbot or
publishing AI-generated content into the EU market. That is a much broader base of
affected companies than the high-risk list, and their compliance state is externally
observable — you can tell from the outside whether a public chatbot discloses itself.

That last property is the interesting one. Externally observable compliance means an
audit can be produced **without the target's cooperation**, which is exactly the
cold-start-plus-lead-generation property the framework prizes.

Sources: [Gibson Dunn on the Omnibus](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/),
[Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/eu-agrees-to-delay-key-ai-act-compliance-deadlines/),
[Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/04/us-companies-face-eu-ai-acts-possible-august-2026-compliance-deadline),
[What applies from August 2026](https://www.digitalapplied.com/blog/eu-ai-act-august-2026-transparency-obligations-agency-checklist)

## Carry-forward

Both checks point the same direction: the strongest candidates will be ones where
**public, externally observable data reveals a problem the target company has**, and where
something external forces them to care about it soon.
