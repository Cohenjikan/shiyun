/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional feedback endpoint. When set, the client POSTs only {message}; the self-hosted collector adds
   * receivedAt and persists no IP/UA/client timestamp. Leave unset for localStorage-only feedback.
   */
  readonly VITE_FEEDBACK_ENDPOINT?: string;
  /** Optional bodyless global claim-number endpoint. It must never receive poem text or a reversible index. */
  readonly VITE_CLAIM_ENDPOINT?: string;
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
