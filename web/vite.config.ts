import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig } from 'vite';

const page = fileURLToPath(new URL('./index.html', import.meta.url));

/**
 * Copies the draw.io frame (nmey/DRAWIO.md §4.1) to `<outDir>/drawio/` as it is: the vendored viewer (8.9 MB, with
 * VERSION and the licenses) and `src/drawio-frame/` (`viewer.html`, `frame.js`). They are plain files, not bundled.
 */
function drawioFrame(): Plugin {
  return {
    name: 'markdone-drawio-frame',
    writeBundle(options) {
      const out = `${options.dir}/drawio`;
      cpSync(fileURLToPath(new URL('./vendor/drawio', import.meta.url)), out, { recursive: true });
      cpSync(fileURLToPath(new URL('./src/drawio-frame', import.meta.url)), out, { recursive: true });
    },
  };
}

/*
 * Default mode: the bundle goes straight into the Gradle generated resources directory. Gradle
 * packages build/generated/web-resources/ into the plugin jar, so the files end up under web/.
 *
 * `--mode harness`: test build of the same page plus web/harness/, into web/dist-harness/
 * (git-ignored, never in the jar). Playwright serves it as https://markdone.local/app/ with the
 * CSP header.
 */
export default defineConfig(({ mode }) => {
  const harness = mode === 'harness';
  return {
    // Relative URLs: the page is served from https://markdone.local/app/ by the asset handler.
    base: './',
    plugins: [drawioFrame()],
    build: {
      outDir: harness
        ? fileURLToPath(new URL('./dist-harness', import.meta.url))
        : fileURLToPath(new URL('../build/generated/web-resources/web', import.meta.url)),
      emptyOutDir: true,
      target: 'es2022',
      /*
       * The CSS minifier drops `@layer base, theme, user, editor-ui;` (no rule of the page CSS is in
       * `user`), which would put the user layer after editor-ui. The page CSS is small: not minified.
       */
      cssMinify: false,
      // Fonts (KaTeX) stay files under /app/assets/: a `data:` font is blocked by the CSP font-src.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
      // Default Rollup naming already hashes file names; kept explicit because the plugin relies on it.
      rollupOptions: {
        input: harness
          ? [page, fileURLToPath(new URL('./harness/index.html', import.meta.url))]
          : page,
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
