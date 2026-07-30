/**
 * Known conversational-AI and live-chat vendors, keyed by signatures that appear in
 * page network requests or inline markup.
 *
 * The `ai` field is the important one and the reason this file is not just a list of
 * chat widgets. Article 50(1) applies to *AI systems* that interact with people. A
 * widget that only ever routes to a human agent is out of scope, and calling it a
 * violation would be wrong. So each vendor is tagged:
 *
 *   'always'  - the product is an AI agent; if it is on the page, an AI is talking
 *   'usually' - AI-first product, human handoff available
 *   'hybrid'  - sold as both; cannot tell from the signature alone, must open it
 *   'human'   - classic live chat; only in scope if the operator bolted AI on
 *
 * Anything below 'always' requires opening the widget and reading what it says before
 * making a claim about it. That distinction is what keeps the audit defensible.
 */

export const VENDORS = [
  // Purpose-built AI support agents
  { id: 'sierra', name: 'Sierra', ai: 'always', sig: ['sierra.ai', 'chat.sierra.ai'] },
  { id: 'decagon', name: 'Decagon', ai: 'always', sig: ['decagon.ai', 'decagon.com'] },
  { id: 'ada', name: 'Ada', ai: 'always', sig: ['ada.support', 'static.ada.support'] },
  { id: 'forethought', name: 'Forethought', ai: 'always', sig: ['forethought.ai'] },
  { id: 'netomi', name: 'Netomi', ai: 'always', sig: ['netomi.com'] },
  { id: 'yellowai', name: 'Yellow.ai', ai: 'always', sig: ['yellow.ai', 'yellowmessenger'] },
  { id: 'koreai', name: 'Kore.ai', ai: 'always', sig: ['kore.ai'] },
  { id: 'cognigy', name: 'Cognigy', ai: 'always', sig: ['cognigy.ai', 'cognigy.com'] },
  { id: 'ultimate', name: 'Ultimate.ai', ai: 'always', sig: ['ultimate.ai'] },
  { id: 'chatbase', name: 'Chatbase', ai: 'always', sig: ['chatbase.co'] },
  { id: 'voiceflow', name: 'Voiceflow', ai: 'always', sig: ['voiceflow.com'] },
  { id: 'intercom_fin', name: 'Intercom Fin', ai: 'always', sig: ['fin.ai'] },

  // AI-first platforms with human handoff
  { id: 'intercom', name: 'Intercom', ai: 'usually', sig: ['intercom.io', 'intercomcdn.com', 'intercomassets.com'] },
  { id: 'drift', name: 'Drift', ai: 'usually', sig: ['drift.com', 'driftt.com'] },
  { id: 'qualified', name: 'Qualified', ai: 'usually', sig: ['qualified.com', 'qualified.io'] },
  { id: 'gorgias', name: 'Gorgias', ai: 'usually', sig: ['gorgias.chat', 'gorgias.com'] },
  { id: 'kustomer', name: 'Kustomer', ai: 'usually', sig: ['kustomerapp.com', 'kustomer.com'] },

  // Hybrid suites - AI is an add-on the operator may or may not have enabled
  { id: 'zendesk', name: 'Zendesk', ai: 'hybrid', sig: ['zdassets.com', 'zopim.com', 'zendesk.com'] },
  { id: 'hubspot', name: 'HubSpot', ai: 'hybrid', sig: ['hs-scripts.com', 'hubspot.com/conversations', 'hs-banner.com'] },
  { id: 'salesforce', name: 'Salesforce', ai: 'hybrid', sig: ['embeddedservice', 'salesforceliveagent', 'force.com/embeddedservice'] },
  { id: 'freshchat', name: 'Freshchat', ai: 'hybrid', sig: ['freshchat.com', 'wchat.freshchat.com', 'freshworks.com'] },
  { id: 'liveperson', name: 'LivePerson', ai: 'hybrid', sig: ['liveperson.net', 'lpsnmedia.net', 'liveperson.com'] },
  { id: 'zoho', name: 'Zoho SalesIQ', ai: 'hybrid', sig: ['salesiq.zoho.com', 'zohopublic.com'] },
  { id: 'glia', name: 'Glia', ai: 'hybrid', sig: ['glia.com', 'salemove.com'] },
  { id: 'verint', name: 'Verint', ai: 'hybrid', sig: ['verint.com'] },
  { id: 'tidio', name: 'Tidio', ai: 'hybrid', sig: ['tidio.co', 'tidiochat.com'] },
  { id: 'crisp', name: 'Crisp', ai: 'hybrid', sig: ['crisp.chat'] },
  { id: 'podium', name: 'Podium', ai: 'hybrid', sig: ['podium.com'] },
  { id: 'birdeye', name: 'Birdeye', ai: 'hybrid', sig: ['birdeye.com'] },

  // Predominantly human live chat
  { id: 'tawk', name: 'Tawk.to', ai: 'human', sig: ['tawk.to'] },
  { id: 'livechat', name: 'LiveChat', ai: 'human', sig: ['livechatinc.com'] },
  { id: 'olark', name: 'Olark', ai: 'human', sig: ['olark.com'] },
  { id: 'front', name: 'Front', ai: 'human', sig: ['frontapp.com'] },
];

/** Match a set of observed URLs/markup against the vendor table. */
export function identifyVendors(haystack) {
  const found = new Map();
  const lower = haystack.toLowerCase();
  for (const v of VENDORS) {
    if (v.sig.some((s) => lower.includes(s))) found.set(v.id, v);
  }
  return [...found.values()];
}

/**
 * Highest AI-likelihood among detected vendors. Drives how strong a claim the report
 * is allowed to make when the widget could not be opened.
 */
export function aiLikelihood(vendors) {
  const order = { human: 0, hybrid: 1, usually: 2, always: 3 };
  return vendors.reduce((max, v) => Math.max(max, order[v.ai] ?? 0), 0);
}
