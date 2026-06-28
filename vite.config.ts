import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 诗云 — static SPA. All index↔poem math runs client-side; the ONLY optional server touchpoint is
// feedback collection (VITE_FEEDBACK_ENDPOINT, see docs/DEPLOY.md §5).
export default defineConfig(({ mode }) => {
  // og:image needs an ABSOLUTE url for Facebook/X scrapers. VITE_SITE_ORIGIN (e.g.
  // "https://shiyun.example.com") is baked in at build; unset → root-relative "/og.jpg" (fine for
  // Telegram/most CN apps, degraded for FB/X). Set it in .env.local before the production build.
  const env = loadEnv(mode, process.cwd(), "");
  const origin = (env.VITE_SITE_ORIGIN || "").trim().replace(/\/$/, "");
  return {
    plugins: [
      react(),
      {
        name: "shiyun-og-origin",
        transformIndexHtml: (html: string) => html.replaceAll("__OG_ORIGIN__", origin),
      },
    ],
    // Fixed reference port. strictPort → fail loudly instead of silently hopping to another
    // port (a sibling worktree's stale dev server on a hopped port would serve the WRONG code).
    // Dev-only proxy: forward the 认领 claim API to a locally-run deploy/claim-server.mjs (port 8788) so
    // the feature is testable end-to-end in `npm run dev` without nginx. In prod nginx does this routing;
    // if no local claim server is running the proxy just errors and the client falls back (local-only).
    server: {
      port: 5199,
      strictPort: true,
      proxy: { "/api/claim": "http://127.0.0.1:8788" },
    },
    build: {
      target: "es2022",
      // three.js is irreducibly ~680 KB min (176 KB gz) and the app IS the canvas — code-splitting
      // it out of the critical path buys nothing. Raise the advisory limit instead of warning forever.
      chunkSizeWarningLimit: 700,
      // Vite 8 swapped Rollup for Rolldown, which dropped the object form of
      // rollupOptions.output.manualChunks AND would merge a manual chunk into its sole importer — a
      // plain three+r3f `manualChunks` function collapsed both into one ~950 KB chunk, tripping the
      // 700 KB warning above. Rolldown's native codeSplitting.groups (the rollupOptions successor)
      // restores the Vite 5 split: three.js → its own ~680 KB chunk (under the limit), fiber+drei → a
      // shared r3f chunk. The higher `priority` on `three` makes Rolldown materialise it as its OWN
      // chunk first (claiming three's modules before the sole-importer merge pass), so it stays split.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "three", test: /[\\/]node_modules[\\/]three[\\/]/, priority: 2 },
              { name: "r3f", test: /[\\/]node_modules[\\/]@react-three[\\/](fiber|drei)[\\/]/, priority: 1 },
            ],
          },
        },
      },
    },
  };
});
