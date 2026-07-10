// 收录状态标注层 — 诗人级「为什么收录不全」的一行灰字文案。
//
// 为什么单独一个纯函数:文案是「按类拼装」而非「按人硬编码」——三类信号(策展 collection[] / 现当代通用版权 /
// 散曲缺口)各自独立、可叠加,规则集中在一处便于单测(每类、叠加、抑制、null 各有断言)。PoetPanel 只负责渲染
// 返回的字符串,不含任何人名判断。数据来自 poets.index 的可选键(build-data.mjs 写),缺键 = 无该类信号。
//
// 边界:调用方(PoetPanel)渲染前 selectedPoet 恒为正身行(permalink.ts 已 resolveCanonicalPoet),故此处
// 无需处理别名——别名 redirect 行本就不带任何收录状态键,即便误传进来也只会返回 null,安全。
import type { PoetRow } from "./load";

/**
 * 组装诗人级收录状态灰字。子句顺序固定:collection[] 策展文案 → 现当代通用版权 → 散曲缺口;「;」连接;无子句返回 null。
 * - collection[]:corpus/pipeline 写的结构性事实文案(弘历/毛泽东/叶嘉莹)。
 * - 现当代通用:dynasty ∈ {jinxiandai, dangdai} 且 collection 里 **无** k==="copyright"(否则该诗人已有更精确的
 *   版权文案,通用句会重复)→ 补一句「现当代作品受版权所限,收录不完整」。
 * - 散曲缺口:quGap → 「散曲存世文献电子化极少,收录不完整」。
 */
export function collectionNotice(poet: PoetRow): string | null {
  const clauses: string[] = [];

  // 1) 策展文案(逐条,保序)
  if (poet.collection) for (const c of poet.collection) clauses.push(c.note);

  // 2) 现当代通用版权(已有 copyright 精确文案的诗人抑制此句,避免重复)
  const isModern = poet.dynasty === "jinxiandai" || poet.dynasty === "dangdai";
  const hasCopyright = !!poet.collection?.some((c) => c.k === "copyright");
  if (isModern && !hasCopyright) clauses.push("现当代作品受版权所限,收录不完整");

  // 3) 散曲缺口
  if (poet.quGap) clauses.push("散曲存世文献电子化极少,收录不完整");

  return clauses.length ? clauses.join("；") : null;
}
