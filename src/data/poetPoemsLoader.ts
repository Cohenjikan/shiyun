import { loadPoetPoems } from "./load";
import { useStore } from "../state/store";

// The ONE way the UI fetches a poet's poems. Centralises the fire-and-forget
// `loadPoetPoems(id).then(setPoetPoems)` pattern that was copy-pasted across 5 call sites — and,
// crucially, catches network failure: without this, a CDN hiccup left the PoetPanel on an eternal
// 「载入作品…」 with no error and no way to retry (the exact symptom of the missing-data deploy bug).
export function fetchPoetPoems(id: string): void {
  useStore.getState().setPoetPoemsError(null);
  loadPoetPoems(id)
    .then((poems) => useStore.getState().setPoetPoems(id, poems))
    .catch((e) => {
      console.error("载入作品失败", id, e);
      useStore.getState().setPoetPoemsError(id);
    });
}
