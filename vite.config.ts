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
    server: { port: 5199, strictPort: true },
    build: {
      target: "es2022",
      // three.js is irreducibly ~680 KB min (176 KB gz) and the app IS the canvas — code-splitting
      // it out of the critical path buys nothing. Raise the advisory limit instead of warning forever.
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            three: ["three"],
            r3f: ["@react-three/fiber", "@react-three/drei"],
          },
        },
      },
    },
  };
});
