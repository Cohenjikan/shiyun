import { useEffect, useState } from "react";
import { syncHash } from "../state/permalink";

// Copy long catalog numbers (80–229 digits) — typing them back is impractical, so every
// displayed 编号 gets a one-click copy for the 编号 reverse-search tab.
export function CopyButton({
  text,
  label = "复制",
  successLabel = "已复制 ✓",
  title = "复制完整编号",
  className = "copy-btn",
}: {
  text: string | (() => string | null);
  label?: string;
  successLabel?: string;
  title?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "done" | "error">(
    "idle",
  );
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    if (status !== "done") return;
    const timer = setTimeout(() => setStatus("idle"), 1400);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <>
      <button
        className={className}
        title={title}
        disabled={status === "copying"}
        onClick={async (e) => {
          e.stopPropagation();
          setFallback(null);
          setStatus("copying");
          let value: string | null = null;
          try {
            value = typeof text === "function" ? text() : text;
            if (
              !value ||
              typeof navigator === "undefined" ||
              !navigator.clipboard?.writeText
            ) {
              throw new Error("Clipboard unavailable");
            }
            await navigator.clipboard.writeText(value);
            setStatus("done");
          } catch {
            setFallback(value);
            setStatus("error");
          }
        }}
      >
        {status === "done"
          ? successLabel
          : status === "copying"
            ? "复制中…"
            : label}
      </button>
      {status === "error" && (
        <span className="copy-fallback" onClick={(e) => e.stopPropagation()}>
          <span role="status">
            {fallback ? "复制未成功，请手动复制：" : "暂无可复制内容"}
          </span>
          {fallback && (
            <input
              aria-label="待复制内容"
              readOnly
              value={fallback}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.currentTarget.select()}
            />
          )}
        </span>
      )}
    </>
  );
}

// Copy a shareable permalink to the current poem / poet (#p=… / #a=…).
export function ShareButton() {
  return (
    <CopyButton
      text={() => {
        syncHash();
        return location.href;
      }}
      label="分享"
      successLabel="链接已复制 ✓"
      className="copy-btn share"
      title="复制可分享的链接（直接定位到这首诗 / 这位诗人）"
    />
  );
}
