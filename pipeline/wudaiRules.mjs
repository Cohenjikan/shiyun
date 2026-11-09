// 五代十国 DISPLAY layer (UF-16, 2026-11) — pure, unit-tested (pipeline/wudaiRules.test.mjs).
//
// Upstream (Werneror 唐.csv) files every 五代十国 poet under 唐, so 李煜/李璟/冯延巳 showed as 唐 (user
// feedback #77). We do NOT move them: poetId = fnv32(name|dynasty) and the star position both key on the
// stored dynasty, so changing it would re-id the poet, move the star and break every #a= link. Instead
// poets.index rows get two OPTIONAL additive keys that only the UI reads:
//   dd: "wudai"   → shown as 五代十国 and filtered by the 五代十国 legend toggle (colour follows it)
//   ds: "南唐"…    → the state, appended to the label (五代十国·南唐) when it is unambiguous
// Nothing else (id / position / 编号 / search keys) reads these keys.
//
// RULE (applies only to poets stored as dynasty "tang"):
//   1. DATA-DRIVEN: the corpus row's own dynasty_raw is 「唐末宋初」 (44 poets in the 2026 corpus, e.g.
//      徐铉 / 孙光宪 / 孟宾于 / 谭用之) → 五代十国. That label is upstream's, not ours.
//   2. CURATED (below): poets upstream labels plain 「唐」 whose life and career fall in the 五代十国
//      (907–979): the rulers, ministers and court poets of the Ten Kingdoms and the Five Dynasties, and the
//      花间 poets active in 前蜀/后蜀. Standard references (中国文学史 textbooks, 全唐诗 小传) agree on these.
//   3. NOT moved (stay 唐 — borderline, listed in docs/DATA_ERRATA.md UF-16 for the owner): late-Tang
//      jinshi who were already established before 907 and died soon after or wrote mainly under Tang —
//      韦庄 牛峤 贯休 齐己 韩偓 罗隐 杜荀鹤 郑谷 司空图 黄滔 徐夤 翁承赞 卢延让 殷文圭 杜光庭 陈陶.
// Name keys must match the corpus canonical author string exactly (顾夐 not 顾敻).
export const WUDAI_CURATED = Object.freeze({
  // 南唐
  李璟: "南唐", 李煜: "南唐", 冯延巳: "南唐", 韩熙载: "南唐", 成彦雄: "南唐", 李建勋: "南唐", 李中: "南唐",
  江为: "南唐", 潘佑: "南唐", 左偃: "南唐", 孙鲂: "南唐", 沈彬: "南唐", 李从谦: "南唐", 廖凝: "南唐",
  // 前蜀 / 后蜀
  王衍: "前蜀", 魏承班: "前蜀", 尹鹗: "前蜀", 李珣: "前蜀", 薛昭蕴: "前蜀", 牛希济: "前蜀", 毛文锡: "前蜀",
  孟昶: "后蜀", 欧阳炯: "后蜀", 鹿虔扆: "后蜀", 阎选: "后蜀", 毛熙震: "后蜀",
  顾夐: "", 花蕊夫人: "", 张泌: "", 欧阳彬: "", // 五代 for certain; state disputed (two 花蕊夫人, two 张泌…)
  // 五代中原 / 吴越 / 闽 / 楚
  李存勖: "后唐", 和凝: "", 冯道: "", 王仁裕: "",
  钱镠: "吴越", 王继鹏: "闽", 王延彬: "闽", 詹敦仁: "", 刘昭禹: "楚",
});

/** @returns {{dd: "wudai", ds?: string} | null} the display override for one poet row, or null. */
export function wudaiDisplay(name, dynasty, dynastyRaw) {
  if (dynasty !== "tang") return null;
  if (Object.prototype.hasOwnProperty.call(WUDAI_CURATED, name)) {
    const ds = WUDAI_CURATED[name];
    return ds ? { dd: "wudai", ds } : { dd: "wudai" };
  }
  if (dynastyRaw === "唐末宋初") return { dd: "wudai" };
  return null;
}
