/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional feedback-collection endpoint. When set at BUILD time, in-page feedback is also POSTed here
   * (fire-and-forget JSON) on top of the always-on localStorage save — the single place 诗云 talks to a
   * server. Leave unset to stay 100% static. See state/feedback.ts + docs/DEPLOY.md.
   * e.g. VITE_FEEDBACK_ENDPOINT="https://shiyun-feedback.<you>.workers.dev"
   */
  readonly VITE_FEEDBACK_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
