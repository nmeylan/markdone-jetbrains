// CDP helper for the L5 tests: connects Playwright to the JCEF remote debugging
// port of the sandbox IDE. One command per process; the result is one JSON line on stdout.
//   node cdp.mjs <port> pages                 -> ["<url of each markdone page>", ...]
//   node cdp.mjs <port> eval <url> <expr>     -> value of <expr> in the page with that URL (if several:
//                                                the first visible one)
//   node cdp.mjs <port> watch                 -> prints "WATCHING", records the requests of the open
//                                                markdone pages and of pages created after that until
//                                                stdin closes, then prints them with response headers
// `watch` uses raw CDP (browser-level auto-attach with waitForDebuggerOnStart, and an attach to
// each open markdone page): each new JCEF browser comes in a new browser context, which
// Playwright's per-context events do not cover.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../web/package.json', import.meta.url)));
const { chromium } = require('@playwright/test');

const [port, command, ...args] = process.argv.slice(2);
const PAGE_PREFIX = 'https://markdone.local/app/';

function markdonePages(browser) {
  return browser.contexts().flatMap((c) => c.pages()).filter((p) => p.url().startsWith(PAGE_PREFIX));
}

if (command === 'watch') {
  await watch();
  process.exit(0);
}

async function watch() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const replies = new Map();
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve) => replies.set(id, resolve));
  };
  const requests = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const p = msg.params;
    if (msg.id !== undefined) {
      replies.get(msg.id)?.(msg.result);
      replies.delete(msg.id);
    } else if (msg.method === 'Target.attachedToTarget') {
      // A new JCEF browser attaches as type "other" and becomes "page" later.
      send('Network.enable', {}, p.sessionId);
      send('Runtime.runIfWaitingForDebugger', {}, p.sessionId);
    } else if (msg.method === 'Network.requestWillBeSent') {
      requests.set(p.requestId, { url: p.request.url, method: p.request.method, status: null, headers: {}, failure: null });
    } else if (msg.method === 'Network.responseReceived') {
      const entry = requests.get(p.requestId);
      if (entry) {
        entry.status = p.response.status;
        entry.headers = Object.fromEntries(Object.entries(p.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
      }
    } else if (msg.method === 'Network.loadingFailed') {
      const entry = requests.get(p.requestId);
      if (entry) entry.failure = p.errorText;
    }
  };
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { targetInfos } = await send('Target.getTargets');
  for (const t of targetInfos) {
    if (t.type === 'page' && t.url.startsWith(PAGE_PREFIX)) {
      await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  console.log('WATCHING');
  await new Promise((resolve) => {
    process.stdin.on('data', () => {});
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
  });
  console.log(JSON.stringify([...requests.values()]));
  ws.close();
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
try {
  if (command === 'pages') {
    console.log(JSON.stringify(markdonePages(browser).map((p) => p.url())));
  } else if (command === 'eval') {
    const [url, expr] = args;
    // With more than one browser for the page URL: the one whose document is visible.
    const pages = markdonePages(browser).filter((p) => p.url() === url);
    if (pages.length === 0) throw new Error(`no page ${url}`);
    let page = pages[0];
    if (pages.length > 1) {
      for (const p of pages) if ((await p.evaluate('document.visibilityState')) === 'visible') { page = p; break; }
    }
    console.log(JSON.stringify(await page.evaluate(expr) ?? null));
  } else {
    throw new Error(`unknown command ${command}`);
  }
} finally {
  // connectOverCDP: close() only disconnects; the IDE's pages stay open.
  await browser.close();
}
