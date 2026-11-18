import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Page, test as base, expect } from '@playwright/test';

export const ORIGIN = 'https://markdone.local';
export const CSP = [
  "default-src 'none'",
  'script-src https://markdone.local/app/',
  "style-src https://markdone.local/app/ 'unsafe-inline'",
  'img-src https://markdone.local/ data:',
  'font-src https://markdone.local/app/ https://markdone.local/file/ https://markdone.local/proj/',
  'connect-src https://markdone.local/doc/',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const DIST = fileURLToPath(new URL('../../dist-harness/', import.meta.url));
export const CORPUS = fileURLToPath(new URL('../../../src/test/resources/corpus/', import.meta.url));
const LOGO = { body: readFileSync(fileURLToPath(new URL('./assets/logo.png', import.meta.url))), type: 'image/png' };

export const REPORTS = fileURLToPath(new URL('../../../build/reports/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Corpus files (relative paths), without huge.md. */
export function corpusFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(CORPUS, dir)).sort()) {
      const rel = dir ? `${dir}/${name}` : name;
      if (statSync(join(CORPUS, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md') && rel !== 'huge.md' && name !== 'README-SOURCES.md') out.push(rel);
    }
  };
  walk('');
  return out;
}

export function readCorpus(rel: string): string {
  return readFileSync(join(CORPUS, rel), 'utf8');
}

/** Read-modify-write of a JSON report in build/reports/. */
export function mergeReport(name: string, values: Record<string, unknown>): void {
  mkdirSync(REPORTS, { recursive: true });
  const path = join(REPORTS, name);
  const old = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(path, `${JSON.stringify({ ...old, ...values }, null, 2)}\n`);
}

/** Removes a key from a JSON report in build/reports/ (renamed metrics). */
export function dropReportKey(name: string, key: string): void {
  const path = join(REPORTS, name);
  if (!existsSync(path)) return;
  const report = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (!(key in report)) return;
  const kept = Object.fromEntries(Object.entries(report).filter(([k]) => k !== key));
  writeFileSync(path, `${JSON.stringify(kept, null, 2)}\n`);
}

interface Guard {
  /** Documents served at /doc/<id>, with their stamp header value (null: no header). */
  docs: Map<string, { text: string; stamp: number | string | null }>;
  /** Files served at /file/<docId>/<path> (key: the URL path after /file/, as requested); others 404. */
  files: Map<string, { body: Buffer; type: string }>;
  /** Every /file/ request (path after /file/), in order. */
  fileRequests: string[];
  /** Expected CSP violations (`<directive> <blocked URI>`): removed from the check. */
  expectedViolations: string[];
}

/*
 * Each test page: https://markdone.local/app/** from dist-harness with the CSP header,
 * /doc/<id> from `guard.docs`, everything else aborted and failed. CSP violations fail the test.
 */
export const test = base.extend<{ guard: Guard }>({
  guard: async ({ page }, use) => {
    const outside: string[] = [];
    const docs = new Map<string, { text: string; stamp: number | string | null }>();
    const files = new Map<string, { body: Buffer; type: string }>();
    const fileRequests: string[] = [];
    const expectedViolations: string[] = [];
    await page.addInitScript(() => {
      const w = window as unknown as { __cspViolations: string[] };
      w.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === ORIGIN && url.pathname.startsWith('/app/')) {
        const file = join(DIST, decodeURIComponent(url.pathname.slice('/app/'.length)));
        if (!file.startsWith(DIST) || !existsSync(file)) return route.fulfill({ status: 404 });
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP },
          body: readFileSync(file),
        });
      }
      if (url.origin === ORIGIN && url.pathname.startsWith('/doc/')) {
        const id = decodeURIComponent(url.pathname.slice('/doc/'.length));
        // guard.docs first, else the harness mock host (its current text and stamp).
        const doc = docs.get(id) ?? (await page.evaluate((d) => window.__harness?.serve(d) ?? null, id).catch(() => null));
        if (!doc) return route.fulfill({ status: 404 });
        const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
        if (doc.stamp !== null) headers['X-Markdone-Stamp'] = String(doc.stamp);
        return route.fulfill({ status: 200, headers, body: doc.text });
      }
      if (url.origin === ORIGIN && url.pathname.startsWith('/file/')) {
        // Images (PROTOCOL.md "Images (M2)"): the IDE serves them with the path rules.
        const rest = url.pathname.slice('/file/'.length);
        fileRequests.push(rest);
        // Default: the corpus' `./logo.png` exists next to every document (small.md, styles/images.md).
        const file = files.get(rest) ?? (rest.endsWith('/.%2Flogo.png') ? LOGO : undefined);
        return file ? route.fulfill({ status: 200, headers: { 'Content-Type': file.type }, body: file.body }) : route.fulfill({ status: 404 });
      }
      outside.push(url.href);
      return route.abort();
    });
    await use({ docs, files, fileRequests, expectedViolations });
    const violations = await page
      .evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
      .catch(() => [] as string[]);
    expect(outside, 'requests outside https://markdone.local/').toEqual([]);
    expect(
      violations.filter((v) => !expectedViolations.includes(v)),
      'CSP violations',
    ).toEqual([]);
  },
});

export { expect };

/** Opens the harness page (mock host) without documents. */
export async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/app/harness/index.html');
  await page.waitForFunction(() => 'markdone' in window && '__harness' in window);
}

/** Opens the harness page and opens + activates `text` as document `docId` (IDE text: `\n` only). */
export async function openHarness(page: Page, text: string, docId = 'd1'): Promise<string> {
  await gotoHarness(page);
  await page.evaluate(([id, t]) => window.__harness.load(id, t), [docId, text] as const);
  return docId;
}

/** Waits for an idle period and two animation frames. */
export async function idle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestIdleCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), {
          timeout: 2000,
        }),
      ),
  );
}

/** Defines the host object the way Kotlin does after load end (protocol/PROTOCOL.md). */
export async function injectHost(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hostLog: unknown[]; __markdoneHost: unknown };
    w.__hostLog = [];
    const fn = (name: string) => (json: string) => w.__hostLog.push({ fn: name, msg: JSON.parse(json) as unknown });
    w.__markdoneHost = { ready: fn('ready'), patch: fn('patch'), link: fn('link'), command: fn('command') };
    window.dispatchEvent(new Event('markdone-host'));
  });
}
