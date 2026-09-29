import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton, ShareButton } from "./CopyButton";
import { syncHash } from "../state/permalink";

vi.mock("../state/permalink", () => ({ syncHash: vi.fn() }));
let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function click() {
  await act(async () => {
    await tree.root
      .findByType("button")
      .props.onClick({ stopPropagation: vi.fn() });
  });
}
describe("copy feedback", () => {
  it.each(["missing", "denied"])(
    "offers the exact text for manual copying when clipboard is %s",
    async (kind) => {
      vi.stubGlobal(
        "navigator",
        kind === "missing"
          ? {}
          : {
              clipboard: {
                writeText: vi.fn().mockRejectedValue(new Error("denied")),
              },
            },
      );
      act(() => {
        tree = create(<CopyButton text="12345678901234567890" />);
      });
      await click();
      expect(
        tree.root.findByProps({ role: "status" }).children.join(""),
      ).toContain("手动复制");
      expect(tree.root.findByType("input").props.value).toBe(
        "12345678901234567890",
      );
      const select = vi.fn();
      tree.root
        .findByType("input")
        .props.onFocus({ currentTarget: { select } });
      expect(select).toHaveBeenCalledOnce();
    },
  );
  it("computes lazy values only on click and allows retry after a rejection", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue(undefined);
    const compute = vi.fn(() => "987654321");
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    act(() => {
      tree = create(<CopyButton text={compute} />);
    });
    expect(compute).not.toHaveBeenCalled();
    await click();
    await click();
    expect(writeText).toHaveBeenLastCalledWith("987654321");
    expect(tree.root.findByType("button").children.join("")).toBe("已复制 ✓");
    expect(tree.root.findAllByType("input")).toHaveLength(0);
  });
  it("shares the synced URL and offers it on clipboard failure", async () => {
    vi.stubGlobal("location", { href: "https://example.test/#p=123" });
    vi.stubGlobal("navigator", {});
    act(() => {
      tree = create(<ShareButton />);
    });
    await click();
    expect(syncHash).toHaveBeenCalledOnce();
    expect(tree.root.findByType("input").props.value).toBe(
      "https://example.test/#p=123",
    );
  });
});
