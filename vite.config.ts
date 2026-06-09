import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 诗云 — static SPA. All index↔poem math runs client-side; no backend, ever.
export default defineConfig({
  plugins: [react()],
  // Fixed reference port. strictPort → fail loudly instead of silently hopping to another
  // port (a sibling worktree's stale dev server on a hopped port would serve the WRONG code).
  server: { port: 5199, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei"],
        },
      },
    },
  },
});
