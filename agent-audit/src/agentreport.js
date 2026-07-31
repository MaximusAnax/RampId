/**
 * Renders an agent audit into a standalone HTML report.
 *
 * The document has one job above all others: let the reader verify the claim themselves in
 * about a minute. So every finding shows the agent's own words and the company's own
 * published words side by side, with the source URL. If the reader has to take anything on
 * trust, the report has failed.
 *
 * The writing rules are the same as the tracking report, and non-negotiable for the same
 * reason: state the comparison, never a legal conclusion. "Your agent said 90 days, your
 * policy says 30" is an observation. "Your agent misled customers" is an accusation the
 * reader's own counsel is better placed to make, and making it converts a prospect into an
 * adversary.
 */

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

export function renderAgentReport(audit, { company = null } = {}) {
  const name = company || host(audit.url);
  const findings = audit.findings ?? [];

  const findingCards = findings
    .map((f) => {
      const critical = f.id === 'AGENT_CONTRADICTS_POLICY';
      return `
      <article class="finding ${critical ? 'conflict' : 'variance'}">
        <div class="sev">${critical ? 'Conflict with published policy' : 'Inconsistent answers'}</div>
        <h3>${esc(f.title)}</h3>
        ${
          critical
            ? `<div class="compare">
                 <div class="side agent">
                   <span class="label">Your agent said</span>
                   <strong>${esc(f.agentSaid)}</strong>
                 </div>
                 <div class="side policy">
                   <span class="label">Your published policy says</span>
                   <strong>${esc(f.policySays)}</strong>
                 </div>
               </div>`
            : ''
        }
        <p>${esc(f.detail)}</p>
        ${
          f.transcript
            ? `<div class="quote"><span class="label">Agent transcript</span>
               <blockquote>${esc(f.transcript)}</blockquote></div>`
            : ''
        }
        ${
          f.policyExcerpt
            ? `<div class="quote"><span class="label">Published text${
                f.policySource ? ` — <a href="${esc(f.policySource)}">${esc(f.policySource)}</a>` : ''
              }</span>
               <blockquote>${esc(f.policyExcerpt)}</blockquote></div>`
            : ''
        }
        <p class="muted">Reproduced in ${esc(f.reproducedIn)}.</p>
      </article>`;
    })
    .join('');

  const areaRows = (audit.areas ?? [])
    .map(
      (a) => `<tr>
        <td>${esc(a.area)}</td>
        <td>${esc(a.question)}</td>
        <td>${esc(String(a.runs))}</td>
        <td>${a.contradictedIn > 0 ? `${esc(String(a.contradictedIn))} of ${esc(String(a.runs))}` : '—'}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Agent Policy Consistency — ${esc(name)}</title>
<style>
  :root { --ink:#101828; --muted:#667085; --line:#e4e7ec; --bg:#fff; --panel:#f9fafb;
          --agent:#b42318; --policy:#067647; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e4e7ec; --muted:#98a2b3; --line:#1d2939; --bg:#0c111d; --panel:#141b2d;
            --agent:#fda29b; --policy:#75e0a7; }
  }
  :root[data-theme="light"] { --ink:#101828; --muted:#667085; --line:#e4e7ec; --bg:#fff; --panel:#f9fafb; }
  :root[data-theme="dark"] { --ink:#e4e7ec; --muted:#98a2b3; --line:#1d2939; --bg:#0c111d; --panel:#141b2d; }
  * { box-sizing:border-box; }
  body { margin:0; padding:2.75rem 1.25rem 4rem; background:var(--bg); color:var(--ink);
    font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:52rem; margin:0 auto; }
  h1 { font-size:1.85rem; letter-spacing:-.025em; margin:0 0 .35rem; }
  h2 { font-size:1.12rem; margin:2.5rem 0 .8rem; padding-bottom:.4rem; border-bottom:1px solid var(--line); }
  h3 { font-size:1rem; margin:.2rem 0 .6rem; }
  .lede { color:var(--muted); margin:0 0 2rem; }
  .muted { color:var(--muted); font-size:.88rem; }
  .finding { border:1px solid var(--line); border-left:3px solid var(--agent);
    border-radius:.55rem; padding:1.1rem 1.25rem; margin-bottom:1rem; background:var(--panel); }
  .finding.variance { border-left-color:#a16207; }
  .sev { font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
    color:var(--muted); }
  .compare { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.7rem;
    margin:.9rem 0; }
  .side { border:1px solid var(--line); border-radius:.45rem; padding:.7rem .85rem; background:var(--bg); }
  .side .label { display:block; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em;
    color:var(--muted); margin-bottom:.25rem; }
  .side strong { font-size:1.2rem; letter-spacing:-.01em; }
  .side.agent strong { color:var(--agent); }
  .side.policy strong { color:var(--policy); }
  .quote { margin:.8rem 0; }
  .quote .label { display:block; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em;
    color:var(--muted); margin-bottom:.3rem; }
  blockquote { margin:0; padding:.6rem .8rem; border-left:2px solid var(--line);
    background:var(--bg); font-size:.9rem; }
  .tablewrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:.88rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .ok { color:var(--policy); }
  .note { background:var(--panel); border:1px solid var(--line); border-radius:.55rem;
    padding:1rem 1.15rem; font-size:.88rem; color:var(--muted); margin-top:2.5rem; }
  ul { padding-left:1.15rem; } li { margin:.3rem 0; font-size:.9rem; }
</style></head>
<body><div class="wrap">

<h1>AI agent policy consistency</h1>
<p class="lede">${esc(name)} · observed ${esc(new Date(audit.startedAt).toUTCString())}</p>

<p>This report compares what your public AI agent told a customer against what your own
published policy pages say. Both sides are public. No access to your systems, data or
accounts was used or required.</p>

${
  audit.inconclusive
    ? `<h2>This audit did not complete</h2>
       <article class="finding variance"><div class="sev">Inconclusive</div>
       <h3>${esc(audit.inconclusive)}</h3>
       <p>No finding, and no absence of findings, should be read from this report.</p></article>`
    : findings.length
      ? `<h2>What we observed</h2>${findingCards}`
      : `<h2>What we observed</h2>
         <p class="ok">In every policy area tested, the agent's answers were consistent with
         your published pages, and consistent with each other across repeated sessions.</p>`
}

${
  audit.areas?.length
    ? `<h2>Method</h2>
       <p class="muted">Each question was asked in ${esc(String(audit.areas[0]?.runs ?? 0))} independent
       sessions, each starting from a fresh browser with no conversation history. A difference
       is only reported when it recurred across sessions — a single divergent answer from a
       language model proves very little.</p>
       <div class="tablewrap"><table>
         <thead><tr><th>Policy area</th><th>Question asked</th><th>Sessions</th><th>Differed in</th></tr></thead>
         <tbody>${areaRows}</tbody>
       </table></div>`
    : ''
}

<h2>What this method cannot see</h2>
<ul>
  <li><strong>Only what a customer could ask.</strong> Questions were ordinary enquiries in
      the areas your published policies cover. No attempt was made to manipulate the agent or
      provoke unusual behaviour.</li>
  <li><strong>Only numeric claims.</strong> Durations, amounts and percentages are compared,
      because those are objectively checkable. Differences in tone, completeness or emphasis
      are not assessed.</li>
  <li><strong>Only the pages found.</strong> Claims were read from ${esc(String(audit.policyPages?.length ?? 0))}
      published page(s). A policy stated somewhere not reached is not represented here.</li>
  <li><strong>One moment in time.</strong> Model updates, prompt changes and retrieval corpus
      edits all change what an agent says, often without any deployment your team would
      notice.</li>
</ul>

<div class="note">
  <strong>Scope.</strong> This is a factual comparison between two public sources: your
  agent's responses and your published policy text. It is not legal advice and states no
  conclusion about your legal position. Whether any difference recorded here carries legal
  significance is a question for your own counsel.
</div>

</div></body></html>`;
}
