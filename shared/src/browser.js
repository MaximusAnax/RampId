/**
 * Browser launching, in one place because getting it wrong is silent.
 *
 * This existed as three near-identical copies before the monorepo split, which is how a
 * fix gets applied twice and missed once. The bug it guards against is the most dangerous
 * class this codebase has: Chromium reads proxy configuration from the environment it
 * inherits, so behind an intercepting proxy sub-resources fail to load, every third-party
 * request looks absent, and a scan reports a perfectly clean site.
 *
 * The output looks like good news, which is exactly why nobody would catch it.
 */

import { chromium } from 'playwright';

/** Environment variables Chromium reads for proxy configuration. */
const PROXY_VARS = /^(https?_proxy|all_proxy|no_proxy)$/i;

export function stripProxyEnv(env = process.env) {
  const cleaned = { ...env };
  for (const key of Object.keys(cleaned)) {
    if (PROXY_VARS.test(key)) delete cleaned[key];
  }
  return cleaned;
}

/**
 * Launch Chromium with a deliberate, explicit proxy posture.
 *
 * A proxy is opt-in via the A50_PROXY environment variable. When none is requested the
 * browser gets both a stripped environment and --no-proxy-server, because the flag alone is
 * not enough — Chromium still picks up the inherited variables.
 */
export async function launchBrowser({ headless = true, extraArgs = [] } = {}) {
  const proxyServer = process.env.A50_PROXY || null;

  return chromium.launch({
    headless,
    ...(proxyServer ? { proxy: { server: proxyServer, bypass: '127.0.0.1,localhost' } } : {}),
    env: proxyServer ? process.env : stripProxyEnv(process.env),
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(proxyServer ? [] : ['--no-proxy-server']),
      ...extraArgs,
    ],
  });
}

/** Whether a proxy was explicitly requested, for reports that need to disclose it. */
export const proxyRequested = () => Boolean(process.env.A50_PROXY);
