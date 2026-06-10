/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional feedback-collection endpoint. When set at BUILD time, in-page feedback is also POSTed here
   * (fire-and-forget JSON) on top of the always-on localStorage save — the single place 诗云 talks to a
   * server. Leave unset to stay 100% static. See state/feedback.ts + docs/DEPLOY.md.
   * e.g. VITE_FEEDBACK_ENDPOINT="https://shiyun-feedback.<you>.workers.dev"
   */
  readonly VITE_FEEDBACK_ENDPOINT?: string;
  /**
   * Optional base URL/path for the heavy data shards (poems/lines/search/manifest/…). When set at BUILD
   * time, all six fetch helpers in src/data/load.ts default to it instead of same-origin "/data".
   * Two uses: point at an absolute CDN/object-storage origin to offload egress, OR a versioned same-origin
   * path like "/data/v2" so an nginx immutable-cache location can serve byte-frozen shards forever (a data
   * bump → new suffix → old caches die naturally). Trailing slashes are stripped. See docs/DEPLOY.md §1.1/§2.1.
   * e.g. VITE_DATA_BASE="/data/v2"  or  VITE_DATA_BASE="https://cdn.example.com/shiyun-data"
   */
  readonly VITE_DATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
