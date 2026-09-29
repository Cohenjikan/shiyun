import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create, act } from "react-test-renderer";
import { SearchPanel } from "./SearchPanel";
import { useStore } from "../state/store";
import { searchPoems } from "../data/load";

vi.mock("../data/load", async (original) => ({
  ...(await original()),
  searchPoems: vi.fn(),
  searchByLine: vi.fn().mockResolvedValue([]),
}));
vi.mock("../data/poetAliases", () => ({
  searchPoetsSmart: () => ({
    results: [
      {
        id: "test",
        name: "李白",
        dynasty: "tang",
        poemCount: 1,
        clusterSize: 1,
      },
    ],
    note: null,
  }),
}));
vi.mock("../data/poetPoemsLoader", () => ({ fetchPoetPoems: vi.fn() }));
let tree: ReturnType<typeof create>;
const initialState = useStore.getState();
const select = vi.fn();
function button(label: string) {
  return tree.root
    .findAllByType("button")
    .find((b) => b.children.join("") === label)!;
}
async function click(label: string) {
  await act(async () => button(label).props.onClick());
}
async function input(value: string) {
  await act(async () =>
    tree.root.findByType("input").props.onChange({ target: { value } }),
  );
}
beforeEach(async () => {
  vi.clearAllMocks();
  useStore.setState({
    selectPoet: select,
    lockPoet: vi.fn(),
    lockPoem: vi.fn(),
    pulseAt: vi.fn(),
  });
  await act(async () => {
    tree = create(<SearchPanel />);
  });
});
afterEach(() => {
  act(() => tree.unmount());
  useStore.setState(initialState, true);
});
describe("SearchPanel interaction regressions", () => {
  it.each([{ isComposing: true }, { isComposing: false, keyCode: 229 }])(
    "ignores IME Enter (%j)",
    async (nativeEvent) => {
      await input("李");
      await act(async () =>
        tree.root
          .findByType("input")
          .props.onKeyDown({ key: "Enter", nativeEvent }),
      );
      expect(select).not.toHaveBeenCalled();
      await act(async () =>
        tree.root
          .findByType("input")
          .props.onKeyDown({ key: "Enter", nativeEvent: {} }),
      );
      expect(select).toHaveBeenCalledOnce();
    },
  );
  it("tracks composition events even without a native composing flag", async () => {
    await input("李");
    await act(async () =>
      tree.root.findByType("input").props.onCompositionStart(),
    );
    await act(async () =>
      tree.root
        .findByType("input")
        .props.onKeyDown({ key: "Enter", nativeEvent: {} }),
    );
    expect(select).not.toHaveBeenCalled();
    await act(async () =>
      tree.root.findByType("input").props.onCompositionEnd(),
    );
    await act(async () =>
      tree.root
        .findByType("input")
        .props.onKeyDown({ key: "Enter", nativeEvent: {} }),
    );
    expect(select).toHaveBeenCalledOnce();
  });
  it("ignores a response from a search tab that was closed", async () => {
    let resolve!: (hits: Awaited<ReturnType<typeof searchPoems>>) => void;
    vi.mocked(searchPoems).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await click("寻诗");
    await input("山");
    await click("诗人");
    await click("寻诗");
    await act(async () =>
      resolve([
        {
          poetId: "test",
          poemIdx: 0,
          title: "旧结果",
          firstLine: "山",
          form: "wujue",
          poet: {
            id: "test",
            name: "李白",
            dynasty: "tang",
            poemCount: 1,
            clusterSize: 1,
          },
        },
      ]),
    );
    await act(async () =>
      tree.root
        .findByType("input")
        .props.onKeyDown({ key: "Enter", nativeEvent: {} }),
    );
    expect(select).not.toHaveBeenCalled();
  });
  it("does not navigate to an old hit while a new search is pending", async () => {
    const hit = {
      poetId: "test",
      poemIdx: 0,
      title: "旧结果",
      firstLine: "山",
      form: "wujue",
      poet: {
        id: "test",
        name: "李白",
        dynasty: "tang",
        poemCount: 1,
        clusterSize: 1,
      },
    };
    vi.mocked(searchPoems)
      .mockResolvedValueOnce([hit])
      .mockImplementationOnce(() => new Promise(() => {}));
    await click("寻诗");
    await input("山");
    await input("月");
    await act(async () =>
      tree.root
        .findByType("input")
        .props.onKeyDown({ key: "Enter", nativeEvent: {} }),
    );
    expect(select).not.toHaveBeenCalled();
  });
  it("recomputes the filled grid when returning from reverse mode", async () => {
    await click("探诗");
    await click("七绝");
    await input("山".repeat(28));
    expect(tree.root.findAllByProps({ className: "rev-poem" }).length).toBe(1);
    await click("凭编号 → 诗");
    await click("五绝");
    await click("填字 → 编号");
    expect(tree.root.findByType("input").props.value).toBe("山".repeat(28));
    expect(tree.root.findAllByProps({ className: "cell" }).length).toBe(20);
    expect(tree.root.findAllByProps({ className: "rev-poem" }).length).toBe(1);
  });
  it("recomputes the saved index when returning from make mode", async () => {
    await click("探诗");
    await click("凭编号 → 诗");
    await act(async () =>
      tree.root
        .findByType("textarea")
        .props.onChange({ target: { value: "123" } }),
    );
    expect(tree.root.findAllByProps({ className: "rev-poem" })).toHaveLength(1);
    await click("填字 → 编号");
    await click("七绝");
    await click("凭编号 → 诗");
    expect(tree.root.findByType("textarea").props.value).toBe("123");
    expect(tree.root.findAllByProps({ className: "rev-poem" })).toHaveLength(1);
  });
});
