/**
 * Renders a scan into a standalone HTML evidence report.
 *
 * This document does three jobs at once, which is the whole economic argument for the
 * business: it is the cold outreach, the proof of competence, and the first deliverable.
 * Because of that, the writing rules are strict and non-negotiable:
 *
 *   1. State observed facts. "This request was sent." Never "you are in violation."
 *      Asserting a legal conclusion is unauthorized practice of law, and it is also the
 *      fastest way to be treated as a demand-letter mill rather than a vendor.
 *   2. Cite public enforcement as context, never as a threat aimed at the reader.
 *   3. Lead with remediation. The reader should finish the page knowing what to fix.
 *   4. Show the raw request URLs. The evidence must be checkable by their own engineer
 *      in under five minutes, or it will be dismissed rather than acted on.
 */

import { corpusStats } from './entities.js';

const ENFORCEMENT_CONTEXT = [
  { who: 'Disney / ABC', amount: '$2.75M', when: 'Feb 2026' },
  { who: 'PlayOn Sports', amount: '$1.1M', when: 'Q1 2026' },
  { who: 'Honda', amount: '$632,500', when: '2026 — asymmetric opt-out design' },
  { who: 'Ford', amount: '$375,703', when: 'Mar 2026' },
];

const SEVERITY_STYLE = {
  critical: { label: 'Critical', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  high: { label: 'High', color: '#c2410c', bg: '#fff7ed', border: '#fed7aa' },
  medium: { label: 'Medium', color: '#a16207', bg: '#fefce8', border: '#fde68a' },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

function passBlock(title, pass, explanation) {
  const rows = pass.trackers
    .map(
      (t) => `
      <tr>
        <td><strong>${esc(t.name)}</strong><div class="muted">${esc(t.category)}</div></td>
        <td>${esc(t.evidence)}</td>
        <td><code>${esc(t.sample ? host(t.sample) : '—')}</code></td>
      </tr>`
    )
    .join('');

  return `
  <section class="pass">
    <h3>${esc(title)}</h3>
    <p class="muted">${esc(explanation)}</p>
    ${
      pass.trackers.length
        ? `<div class="tablewrap"><table><thead><tr><th>Service</th><th>What it does</th><th>Endpoint</th></tr></thead>
           <tbody>${rows}</tbody></table></div>`
        : '<p class="ok">No third-party trackers observed in this pass.</p>'
    }
  </section>`;
}

export function renderReport(scan, { company = null } = {}) {
  const name = company || host(scan.url);
  const corpus = corpusStats();
  const findings = scan.findings || [];

  const findingCards = findings
    .map((f) => {
      const s = SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.medium;
      return `
      <article class="finding" style="background:${s.bg};border-color:${s.border}">
        <div class="sev" style="color:${s.color}">${s.label}</div>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.detail)}</p>
        ${
          f.trackers?.length
            ? `<p class="muted">Services observed: ${f.trackers.map(esc).join(', ')}</p>`
            : ''
        }
      </article>`;
    })
    .join('');

  const enforcement = ENFORCEMENT_CONTEXT.map(
    (e) => `<li><strong>${esc(e.who)}</strong> — ${esc(e.amount)} <span class="muted">(${esc(e.when)})</span></li>`
  ).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tracking &amp; Consent Evidence — ${esc(name)}</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#ffffff; --panel:#f8fafc; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --bg:#0b1120; --panel:#111827; }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:2.5rem 1.25rem 4rem; background:var(--bg); color:var(--ink);
    font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:52rem; margin:0 auto; }
  h1 { font-size:1.9rem; margin:0 0 .35rem; letter-spacing:-.02em; }
  h2 { font-size:1.2rem; margin:2.5rem 0 .75rem; letter-spacing:-.01em; }
  h3 { font-size:1rem; margin:0 0 .4rem; }
  .muted { color:var(--muted); font-size:.9rem; }
  .lede { font-size:1.05rem; color:var(--muted); margin:0 0 2rem; }
  .score { display:flex; align-items:baseline; gap:.6rem; padding:1.1rem 1.25rem;
    background:var(--panel); border:1px solid var(--line); border-radius:.6rem; margin-bottom:1.5rem; }
  .score b { font-size:2rem; letter-spacing:-.03em; }
  .finding { border:1px solid; border-radius:.6rem; padding:1rem 1.15rem; margin-bottom:.85rem; }
  .finding p { margin:.35rem 0 0; font-size:.94rem; color:#334155; }
  @media (prefers-color-scheme: dark) { .finding p { color:#cbd5e1; } }
  .sev { font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  .pass { margin-bottom:1.75rem; }
  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.88rem; margin-top:.6rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:.75rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  code { font:.82rem ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  .ok { color:#15803d; font-size:.9rem; }
  ul { padding-left:1.15rem; }
  li { margin:.25rem 0; font-size:.92rem; }
  .note { background:var(--panel); border:1px solid var(--line); border-radius:.6rem;
    padding:1rem 1.15rem; font-size:.88rem; color:var(--muted); margin-top:2.5rem; }
  ol.fix li { margin:.5rem 0; }
</style></head>
<body><div class="wrap">

<h1>Tracking &amp; consent evidence</h1>
<p class="lede">${esc(name)} · observed ${esc(new Date(scan.scannedAt).toUTCString())}</p>

<div class="score">
  <b>${scan.riskScore}</b>
  <span class="muted">exposure score out of 100 &middot; ${findings.length} finding(s)
  &middot; consent mechanism: ${
    scan.cmp?.length
      ? esc(scan.cmp.join(', '))
      : scan.bannerVisible
        ? 'banner present, platform not identified'
        : 'none detected'
  }</span>
</div>

<p>This report records what a browser actually transmitted when it loaded
<code>${esc(scan.url)}</code>. It was produced entirely from the public site. No access to
your systems, accounts, or data was used or required.</p>

${findings.length ? `<h2>What we observed</h2>${findingCards}` : '<h2>What we observed</h2><p class="ok">No pre-consent tracking, opt-out failures, or post-rejection transmission were observed.</p>'}

<h2>Method</h2>
<p class="muted">Three independent page loads, each with a clean browser profile.</p>
${passBlock(
  'Pass 1 — Baseline, no interaction',
  scan.passes.baseline,
  'The page was loaded and nothing was clicked. Anything listed here transmitted before the visitor made any choice at all.'
)}
${passBlock(
  'Pass 2 — Global Privacy Control enabled',
  scan.passes.gpc,
  'The browser advertised Sec-GPC: 1 and navigator.globalPrivacyControl = true. California regulations effective 1 January 2026 require opt-out preference signals to be honoured.'
)}
${passBlock(
  'Pass 3 — After clicking the reject control',
  scan.passes.afterReject,
  scan.passes.afterReject.rejectClicked
    ? 'The consent banner’s reject control was clicked. Only requests sent after that click are listed.'
    : 'No reject control could be found on the consent banner, so this pass could not be completed.'
)}

<h2>Suggested remediation</h2>
<ol class="fix">
  <li>Move every tag listed in Pass 1 behind a consent gate so it cannot fire on page load.
      In most tag managers this is a trigger condition change, not a code change.</li>
  <li>Wire the Global Privacy Control signal to your consent state on the server side, so it
      applies before the first response is rendered rather than after the page is interactive.</li>
  <li>Verify that the reject control actually revokes the tags it claims to, rather than only
      hiding the banner. Pass 3 above is the specific check.</li>
  <li>Re-test after every marketing tag change. This configuration drifts continuously — most
      of the gaps in this report were almost certainly introduced by a routine tag addition.</li>
</ol>

<h2>Why this is being measured</h2>
<p class="muted">Recent public enforcement by the California Privacy Protection Agency involving
tracking and opt-out handling:</p>
<ul>${enforcement}</ul>

<h2>What this method cannot see</h2>
<p class="muted">Stated plainly, because a report that overclaims is easy to dismiss in full.</p>
<ul>
  <li><strong>Server-side tagging.</strong> Tags routed through your own domain, or through a
      server-side container, are indistinguishable from ordinary first-party traffic when
      observed from outside. Data can be forwarded to third parties without appearing here.</li>
  <li><strong>First-party proxied and CNAME-cloaked trackers.</strong> Same limitation: a
      tracker served from a subdomain of your own site will not be counted as third-party.</li>
  <li><strong>One page, one moment.</strong> Only the URL named above was tested, on the date
      shown. Behaviour commonly differs on checkout, account and search pages.</li>
  <li><strong>Geography and segmentation.</strong> The page was loaded from a single location
      with a single profile. Sites frequently vary tag behaviour by region or audience.</li>
  <li><strong>Consent signalling.</strong> A tag firing is not by itself evidence that personal
      data was shared. Some tags fire while transmitting a signal that consent was denied. Where
      that signal was detectable it is noted; where it was not, the observation is reported as
      what it is — a request that was sent.</li>
</ul>

<div class="note">
  <strong>Scope.</strong> This is a technical observation of network behaviour produced by
  automated testing from outside your systems, using ${esc(String(corpus.curatedTrackers))}
  curated service fingerprints supplemented by a public dataset of ${esc(String(corpus.broadEntities))}
  categorized third-party entities. It is not legal advice and states no conclusion about your
  legal position or compliance status. Whether any observation here carries legal significance
  depends on facts not visible from outside — your data-sharing agreements, the categories of
  data involved, and your users' jurisdictions. Those questions are for qualified counsel.
</div>

</div></body></html>`;
}
