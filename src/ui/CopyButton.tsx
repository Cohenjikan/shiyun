import { useState } from "react";
import { syncHash } from "../state/permalink";

// Copy long catalog numbers (80–229 digits) — typing them back is impractical, so every
// displayed 编号 gets a one-click copy for the 编号 reverse-search tab.
export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-btn"
      title="复制完整编号"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "已复制 ✓" : label}
    </button>
  );
}

// Copy a shareable permalink to the current poem / poet (#p=… / #a=…).
export function ShareButton() {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-btn share"
      title="复制可分享的链接（直接定位到这首诗 / 这位诗人）"
      onClick={() => {
        syncHash();
        navigator.clipboard?.writeText(location.href).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "链接已复制 ✓" : "分享"}
    </button>
  );
}
