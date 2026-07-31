/**
 * Drives a company's public AI agent the way a customer would, and records what it says.
 *
 * RESTRAINT IS A DESIGN REQUIREMENT HERE, NOT A COURTESY
 *
 * Unlike loading a page, every probe spends the target's money on model inference. That
 * changes what responsible behaviour means, and it changes the legal posture of the whole
 * exercise. So:
 *
 *   - One question per policy area, never a battery.
 *   - Questions are phrased as ordinary customer enquiries. A leading question produces an
 *     answer the company can fairly disown.
 *   - No prompt injection, no jailbreak probing, no attempts to make the agent misbehave.
 *     The moment this becomes adversarial testing of a system nobody hired us to test, it
 *     stops being an audit and starts being something else entirely. The product asks only
 *     what a customer would ask.
 *   - Sessions are deliberately separated, because reproduction across independent sessions
 *     is what makes a finding survive contact with a non-deterministic model.
 */

import { chromium } from 'playwright';

/** Selectors that open a chat widget, shared with the Article 50 module. */
const LAUNCHER_SELECTORS = [
  '#launcher',
  '.intercom-launcher',
  '[class*="intercom-launcher"]',
  '#drift-widget',
  '[id*="drift-frame-controller"]',
  '#hubspot-messages-iframe-container',
  '.embeddedServiceHelpButton',
  '#fc_frame',
  '#tidio-chat',
  '.crisp-client',
  '#tawkchat-minified-container',
  '[data-testid*="launcher"]',
  '[aria-label*="chat" i]',
  '[aria-label*="help" i]',
];

const LAUNCHER_NAME_RE = /chat|help|support|message|assistant|ask|talk to us|live/i;

/** Where a customer would type. */
const INPUT_SELECTORS = [
  'textarea[placeholder*="message" i]',
  'input[placeholder*="message" i]',
  'textarea[placeholder*="question" i]',
  'textarea[placeholder*="type" i]',
  'input[placeholder*="type" i]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '.chat-input textarea',
  'textarea',
];

function stripProxyEnv(env) {
  const cleaned = { ...env };
  for (const key of Object.keys(cleaned)) {
    if (/^(https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete cleaned[key];
  }
  return cleaned;
}

/**
 * Run one independent session: open the agent, ask each question once, record replies.
 *
 * A fresh browser context per session is the point — a reused context carries conversation
 * history, and an agent that has already answered a question answers the next one
 * differently. That would make reproduction meaningless.
 */
export async function probeSession(url, questions, opts = {}) {
  const {
    timeoutMs = 45000,
    replyWaitMs = 9000,
    headless = true,
    userAgent = 'Mozilla/5.0 (compatible; AgentAudit/0.1; +policy consistency research)',
  } = opts;

  const proxyServer = process.env.A50_PROXY || null;
  const browser = await chromium.launch({
    headless,
    ...(proxyServer ? { proxy: { server: proxyServer, bypass: '127.0.0.1,localhost' } } : {}),
    env: proxyServer ? process.env : stripProxyEnv(process.env),
    args: ['--no-sandbox', '--disable-dev-shm-usage', ...(proxyServer ? [] : ['--no-proxy-server'])],
  });

  const context = await browser.newContext({
    userAgent,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const session = { url, startedAt: new Date().toISOString(), opened: false, exchanges: [], error: null };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Widgets are injected late, well after the document settles.
    await page.waitForTimeout(4000);

    session.opened = await openWidget(page);
    if (!session.opened) {
      session.error = 'No chat widget could be opened.';
      return session;
    }

    await page.waitForTimeout(2500);

    for (const q of questions) {
      const before = await captureConversation(page);
      const sent = await askQuestion(page, q.question);
      if (!sent) {
        session.exchanges.push({ area: q.area, question: q.question, reply: null, error: 'Could not send.' });
        continue;
      }
      await page.waitForTimeout(replyWaitMs);
      const after = await captureConversation(page);
      session.exchanges.push({
        area: q.area,
        question: q.question,
        reply: newContent(before, after, q.question),
        askedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    session.error = String(err.message || err).slice(0, 300);
  } finally {
    await browser.close().catch(() => {});
  }

  return session;
}

/**
 * Run several independent sessions.
 *
 * Sequential, with a pause between them. Concurrent sessions against one agent look like a
 * load test and cost the target more than a customer ever would.
 */
export async function probe(url, questions, { runs = 3, betweenRunsMs = 3000, ...opts } = {}) {
  const sessions = [];
  for (let i = 0; i < runs; i += 1) {
    sessions.push(await probeSession(url, questions, opts));
    if (i < runs - 1) await new Promise((r) => setTimeout(r, betweenRunsMs));
  }
  return sessions;
}

/** Group replies by policy area across sessions, ready for the contradiction assessment. */
export function repliesByArea(sessions) {
  const byArea = new Map();
  for (const session of sessions) {
    for (const exchange of session.exchanges) {
      if (!exchange.reply) continue;
      if (!byArea.has(exchange.area)) byArea.set(exchange.area, []);
      byArea.get(exchange.area).push(exchange.reply);
    }
  }
  return byArea;
}

async function openWidget(page) {
  for (const sel of LAUNCHER_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 700 })) {
        await el.click({ timeout: 3000, force: true });
        return true;
      }
    } catch {
      // Not present on this site.
    }
  }
  try {
    const byName = page.getByRole('button', { name: LAUNCHER_NAME_RE }).last();
    if (await byName.isVisible({ timeout: 1500 })) {
      await byName.click({ timeout: 3000, force: true });
      return true;
    }
  } catch {
    // No accessible launcher.
  }
  return false;
}

async function askQuestion(page, question) {
  for (const frame of page.frames()) {
    for (const sel of INPUT_SELECTORS) {
      try {
        const input = frame.locator(sel).first();
        if (!(await input.isVisible({ timeout: 600 }))) continue;
        await input.click({ timeout: 2000 });
        await input.fill(question).catch(async () => {
          await input.type(question, { delay: 12 });
        });
        await input.press('Enter');
        return true;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return false;
}

/** All conversation text currently on screen, across frames. */
async function captureConversation(page) {
  const parts = [];
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => {
        const roots = document.querySelectorAll(
          '[role="log"], [role="feed"], [class*="message"], [class*="conversation"], [class*="chat"]'
        );
        const seen = new Set();
        const out = [];
        for (const el of roots) {
          const t = (el.innerText || '').trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            out.push(t);
          }
        }
        return out.join('\n');
      });
      if (text) parts.push(text);
    } catch {
      // Frame not readable.
    }
  }
  return parts.join('\n');
}

/**
 * Isolate what the agent said in response, rather than the whole transcript.
 *
 * The question itself is stripped out, because it appears in the conversation as the
 * customer's own turn and would otherwise be scanned for values as though the agent had
 * said it — which would make the audit compare the question against the policy.
 */
function newContent(before, after, question) {
  let added = after.startsWith(before) ? after.slice(before.length) : after;
  const normalizedQuestion = question.trim();
  added = added.split(normalizedQuestion).join(' ');
  return added.replace(/\s+/g, ' ').trim();
}
