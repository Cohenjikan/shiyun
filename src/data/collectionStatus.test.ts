import { describe, it, expect } from "vitest";
import { collectionNotice } from "./collectionStatus";
import type { PoetRow } from "./load";

// 收录状态诗人级灰字 — 纯函数,按类拼装、零人名硬编码。每类 / 叠加 / 抑制 / null 各有断言。
// 子句顺序固定:collection[] → 现当代通用版权 → 散曲缺口;「;」(U+FF1B 全角分号)连接。
const base = (over: Partial<PoetRow>): PoetRow => ({
  id: "x", name: "某", dynasty: "tang", poemCount: 1, clusterSize: 2, ...over,
});
const SEP = "；"; // 全角分号,与 collectionNotice 内的 join 一致

describe("collectionNotice (收录状态诗人级灰字)", () => {
  it("无任何信号 → null(古典诗人,不误标)", () => {
    expect(collectionNotice(base({ dynasty: "song" }))).toBeNull();
    // 辛弃疾/苏轼/李清照 这类头部词人:无 collection/quGap → 无标注(反向抽查)
    expect(collectionNotice(base({ name: "辛弃疾", dynasty: "song" }))).toBeNull();
  });

  it("collection[] 策展文案(弘历 partial)→ 直接返回该文案", () => {
    const poet = base({
      name: "弘历", dynasty: "qing",
      collection: [{ k: "partial", note: "《御制诗集》四万余首,开源语料仅传三百余首" }],
    });
    expect(collectionNotice(poet)).toBe("《御制诗集》四万余首,开源语料仅传三百余首");
  });

  it("现当代通用版权(无 collection 的现当代诗人)→ 通用句", () => {
    expect(collectionNotice(base({ dynasty: "jinxiandai" }))).toBe("现当代作品受版权所限,收录不完整");
    expect(collectionNotice(base({ dynasty: "dangdai" }))).toBe("现当代作品受版权所限,收录不完整");
  });

  it("k===copyright 抑制现当代通用句(避免与更精确的版权文案重复)—— 毛泽东/叶嘉莹式", () => {
    const mao = base({
      name: "毛泽东", dynasty: "jinxiandai",
      collection: [{ k: "copyright", note: "部分作品在版权保护期内,2027 年 1 月进入公有领域后补全" }],
    });
    // 只有精确文案,没有再叠一句通用版权
    expect(collectionNotice(mao)).toBe("部分作品在版权保护期内,2027 年 1 月进入公有领域后补全");
  });

  it("quGap(散曲缺口)独立成句(元代散曲诗人,非现当代)", () => {
    expect(collectionNotice(base({ name: "兰楚芳", dynasty: "yuan", quGap: 1 }))).toBe(
      "散曲存世文献电子化极少,收录不完整",
    );
  });

  it("现当代通用 + quGap 叠加,顺序为 通用 → 散曲", () => {
    expect(collectionNotice(base({ dynasty: "dangdai", quGap: 1 }))).toBe(
      `现当代作品受版权所限,收录不完整${SEP}散曲存世文献电子化极少,收录不完整`,
    );
  });

  it("三类全叠加,顺序 collection → 现当代通用 → 散曲(collection 为 partial 不抑制通用句)", () => {
    const poet = base({
      dynasty: "jinxiandai", quGap: 1,
      collection: [{ k: "partial", note: "自定策展说明" }],
    });
    expect(collectionNotice(poet)).toBe(
      `自定策展说明${SEP}现当代作品受版权所限,收录不完整${SEP}散曲存世文献电子化极少,收录不完整`,
    );
  });

  it("多条 collection 文案逐条保序拼接", () => {
    const poet = base({
      dynasty: "qing",
      collection: [
        { k: "partial", note: "甲" },
        { k: "partial", note: "乙" },
      ],
    });
    expect(collectionNotice(poet)).toBe(`甲${SEP}乙`);
  });

  it("copyright 现当代诗人 + quGap:通用句仍被抑制,但散曲句照常", () => {
    const poet = base({
      dynasty: "jinxiandai", quGap: 1,
      collection: [{ k: "copyright", note: "版权文案" }],
    });
    expect(collectionNotice(poet)).toBe(`版权文案${SEP}散曲存世文献电子化极少,收录不完整`);
  });
});
