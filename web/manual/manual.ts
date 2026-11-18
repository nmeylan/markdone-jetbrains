/*
 * Manual harness: runs the real page (src/main.ts) in a normal browser tab, without the IDE. It
 * plays the host: `theme` and `settings` once, then `open` of the Markdown in index.html and
 * `activate` after `opened`. `/doc/<id>` is answered from that Markdown (fetch is wrapped), so
 * nothing leaves the page. Remote images stay off, like the IDE default.
 */
import type { PageMessage } from '../src/protocol';

const DOC_ID = 'manual';
const source = (document.getElementById('md-source')?.textContent ?? '').replace(/^\r?\n/, '');

/* The page fetches /doc/<id>: answer it from the embedded Markdown. */
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (new URL(url, location.href).pathname === `/doc/${DOC_ID}`) {
    return Promise.resolve(
      new Response(source, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Markdone-Stamp': '0' } }),
    );
  }
  return realFetch(input, init);
};

function receive(msg: unknown): void {
  if (!window.markdone) throw new Error('markdone: page did not start');
  window.markdone.receive(msg);
}

function onPage(json: string): void {
  const msg = JSON.parse(json) as PageMessage;
  if (msg.type === 'ready') {
    receive({ type: 'theme', dark: matchMedia('(prefers-color-scheme: dark)').matches, fontFamily: 'system-ui', fontSizePx: 14, zoom: 1 });
    receive({ type: 'settings', remoteImages: false, math: true, mermaid: true, highlight: true, style: 'default' });
    receive({ type: 'open', docId: DOC_ID, writable: false });
  } else if (msg.type === 'opened') {
    receive({ type: 'activate', docId: DOC_ID });
  } else if (msg.type === 'loadError') {
    console.error('markdone manual: could not load the document', msg.reason);
  }
}

/* Defined before the page module runs, so its `ready` reaches this host. */
window.__markdoneHost = {
  ready: onPage,
  patch: () => undefined,
  link: (json) => console.info('markdone manual: link', json),
  command: (json) => console.info('markdone manual: command', json),
};

await import('../src/main');
