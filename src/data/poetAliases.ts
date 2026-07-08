import { searchPoets, resolveCanonicalPoet, aliasNoticeNames, type PoetRow } from "./load";

// 诗人别名层 — fixes the "搜「陶渊明」落空" class of misses: the corpus keys poets by ONE canonical
// name (陶潜, not 陶渊明; 唐寅, not 唐伯虎), but people search by 字/号/俗称. This maps the common
// alternates → the corpus canonical row. Mirrors (and corrects) the pipeline's GIFT_ALIAS table —
// every TARGET here must be a real poet row; poetAliases.test.ts asserts that against
// public/data/poets.index.json so a dead target can't ship.
export const POET_ALIASES: Record<string, string> = {
  // 魏晋南北朝 — corpus canonical is 陶潜
  陶渊明: "陶潜", 渊明: "陶潜", 靖节: "陶潜", 五柳先生: "陶潜",
  谢康乐: "谢灵运", 康乐: "谢灵运", 谢宣城: "谢朓", 玄晖: "谢朓",
  嗣宗: "阮籍", 叔夜: "嵇康", 太冲: "左思", 明远: "鲍照", 庾子山: "庾信", 子山: "庾信",
  曹孟德: "曹操", 魏武帝: "曹操", 曹子建: "曹植", 陈思王: "曹植",
  蔡文姬: "蔡琰", // 文姬=字,库内作本名「蔡琰」(东汉,qinhan) — 极常用名 蔡文姬 原搜不到
  // 帝王 帝号/庙号/谥号 → 本名 (秦汉/魏/南朝)
  汉高祖: "刘邦", 汉武帝: "刘彻", 魏文帝: "曹丕",
  梁武帝: "萧衍", 梁简文帝: "萧纲", 梁元帝: "萧绎", 陈后主: "陈叔宝",
  // 唐
  李太白: "李白", 太白: "李白", 青莲居士: "李白", 谪仙: "李白", 诗仙: "李白",
  杜子美: "杜甫", 少陵: "杜甫", 杜少陵: "杜甫", 杜工部: "杜甫", 老杜: "杜甫", 诗圣: "杜甫",
  白乐天: "白居易", 乐天: "白居易", 香山居士: "白居易", 白香山: "白居易", 醉吟先生: "白居易",
  // NOTE: some 字号 (王右丞/李义山/晦庵/柳三变/元遗山/元美/文衡山/祝枝山/天随子) exist as their OWN
  // duplicate-attribution rows in the corpus, and 方回 is a REAL distinct 元代 poet — those keys are
  // deliberately ABSENT here (the real row wins; poetAliases.test.ts enforces no-shadowing).
  王摩诘: "王维", 摩诘: "王维", 诗佛: "王维",
  韩退之: "韩愈", 退之: "韩愈", 昌黎: "韩愈", 韩昌黎: "韩愈", 韩文公: "韩愈",
  柳子厚: "柳宗元", 子厚: "柳宗元", 柳河东: "柳宗元", 柳柳州: "柳宗元",
  刘梦得: "刘禹锡", 梦得: "刘禹锡", 刘宾客: "刘禹锡", 诗豪: "刘禹锡",
  义山: "李商隐", 玉谿生: "李商隐", 玉溪生: "李商隐",
  杜牧之: "杜牧", 牧之: "杜牧", 樊川: "杜牧", 杜樊川: "杜牧", 小杜: "杜牧",
  李长吉: "李贺", 长吉: "李贺", 诗鬼: "李贺",
  孟襄阳: "孟浩然", 高常侍: "高适", 王少伯: "王昌龄", 王江宁: "王昌龄", 七绝圣手: "王昌龄",
  岑嘉州: "岑参", 四明狂客: "贺知章", 陈拾遗: "陈子昂", 伯玉: "陈子昂",
  贾浪仙: "贾岛", 浪仙: "贾岛", 孟东野: "孟郊", 东野: "孟郊",
  温飞卿: "温庭筠", 飞卿: "温庭筠", 温八叉: "温庭筠",
  刘随州: "刘长卿", 文房: "刘长卿", 韦苏州: "韦应物", 韦江州: "韦应物",
  陆鲁望: "陆龟蒙", 鲁望: "陆龟蒙", 甫里先生: "陆龟蒙",
  // 帝王 帝号/庙号 → 本名 (隋/唐; 南唐中主语料归 tang)
  隋炀帝: "杨广",
  唐太宗: "李世民", 唐玄宗: "李隆基", 唐明皇: "李隆基", 武曌: "武则天",
  南唐中主: "李璟", 李中主: "李璟",
  // 五代
  李后主: "李煜", 南唐后主: "李煜", 重光: "李煜", 冯正中: "冯延巳", 韦端己: "韦庄",
  // 宋
  苏东坡: "苏轼", 东坡: "苏轼", 东坡居士: "苏轼", 子瞻: "苏轼", 坡仙: "苏轼",
  苏子由: "苏辙", 子由: "苏辙", 颍滨遗老: "苏辙",
  苏老泉: "苏洵", 老泉: "苏洵", 明允: "苏洵",
  黄山谷: "黄庭坚", 山谷: "黄庭坚", 山谷道人: "黄庭坚", 鲁直: "黄庭坚", 涪翁: "黄庭坚",
  王荆公: "王安石", 荆公: "王安石", 介甫: "王安石", 半山: "王安石", 临川先生: "王安石",
  欧阳永叔: "欧阳修", 永叔: "欧阳修", 醉翁: "欧阳修", 六一居士: "欧阳修",
  陆放翁: "陆游", 放翁: "陆游", 务观: "陆游",
  辛稼轩: "辛弃疾", 稼轩: "辛弃疾", 幼安: "辛弃疾",
  李易安: "李清照", 易安: "李清照", 易安居士: "李清照",
  范石湖: "范成大", 石湖: "范成大", 石湖居士: "范成大",
  杨诚斋: "杨万里", 诚斋: "杨万里",
  朱晦庵: "朱熹", 晦翁: "朱熹", 紫阳: "朱熹", 朱文公: "朱熹",
  陈简斋: "陈与义", 简斋: "陈与义",
  秦少游: "秦观", 少游: "秦观", 淮海居士: "秦观", 秦淮海: "秦观",
  周清真: "周邦彦", 清真居士: "周邦彦", 美成: "周邦彦",
  晏元献: "晏殊", 同叔: "晏殊", 晏小山: "晏几道", 小山: "晏几道", 叔原: "晏几道",
  柳屯田: "柳永", 耆卿: "柳永",
  范文正: "范仲淹", 希文: "范仲淹",
  邵康节: "邵雍", 康节: "邵雍", 安乐先生: "邵雍",
  贺梅子: "贺铸", 庆湖遗老: "贺铸",
  姜白石: "姜夔", 白石: "姜夔", 白石道人: "姜夔", 尧章: "姜夔",
  吴梦窗: "吴文英", 梦窗: "吴文英", 周草窗: "周密", 草窗: "周密",
  文文山: "文天祥", 文山: "文天祥", 文信国: "文天祥", 履善: "文天祥",
  梅宛陵: "梅尧臣", 宛陵: "梅尧臣", 圣俞: "梅尧臣",
  陈后山: "陈师道", 后山: "陈师道", 曾茶山: "曾几", 茶山: "曾几", 戴石屏: "戴复古", 石屏: "戴复古",
  // 生僻字讹名 — 本名含字库外字,上游以同音字替代:正名→库内讹名,检索可达(渲染层另可正名显示)
  王禹偁: "王禹称", // 偁 U+5041 未入字库 → 库内作「王禹称」(北宋诗文革新先驱,729 首)
  // 帝王 庙号 → 本名 (宋)
  宋徽宗: "赵佶",
  // 金/元
  遗山: "元好问", 裕之: "元好问",
  // 帝王 帝号/庙号 → 本名 (金/辽)
  海陵王: "完颜亮", 辽道宗: "耶律洪基",
  虞道园: "虞集", 道园: "虞集", 萨天锡: "萨都剌", 天锡: "萨都剌",
  // 明
  高青丘: "高启", 青丘子: "高启", 季迪: "高启",
  唐伯虎: "唐寅", 伯虎: "唐寅", 六如居士: "唐寅", 桃花庵主: "唐寅",
  王弇州: "王世贞", 弇州山人: "王世贞",
  李沧溟: "李攀龙", 沧溟: "李攀龙", 衡山居士: "文徵明",
  枝山: "祝允明", 李空同: "李梦阳", 空同: "李梦阳",
  何大复: "何景明", 大复: "何景明",
  王阳明: "王守仁", 阳明: "王守仁", 阳明先生: "王守仁",
  杨升庵: "杨慎", 升庵: "杨慎", 归震川: "归有光", 震川: "归有光",
  袁中郎: "袁宏道", 中郎: "袁宏道", 陈大樽: "陈子龙", 卧子: "陈子龙",
  宋潜溪: "宋濂", 景濂: "宋濂", 刘诚意: "刘基", 伯温: "刘基", 刘伯温: "刘基",
  // 帝王 庙号 → 本名 (明)
  明太祖: "朱元璋",
  // 清
  // 帝王 年号/庙号 → 本名 (清)
  康熙: "玄烨", 雍正: "胤禛", 乾隆: "弘历",
  纳兰容若: "纳兰性德", 容若: "纳兰性德", 楞伽山人: "纳兰性德", 饮水词人: "纳兰性德",
  袁随园: "袁枚", 随园: "袁枚", 随园老人: "袁枚", 子才: "袁枚",
  龚定庵: "龚自珍", 定庵: "龚自珍", 定盦: "龚自珍",
  王渔洋: "王士禛", 渔洋: "王士禛", 渔洋山人: "王士禛", 阮亭: "王士禛",
  朱竹垞: "朱彝尊", 竹垞: "朱彝尊", 陈迦陵: "陈维崧", 迦陵: "陈维崧",
  钱牧斋: "钱谦益", 牧斋: "钱谦益", 吴梅村: "吴伟业", 梅村: "吴伟业",
  厉樊榭: "厉鹗", 樊榭: "厉鹗", 赵瓯北: "赵翼", 瓯北: "赵翼",
  黄仲则: "黄景仁", 仲则: "黄景仁", 曾涤生: "曾国藩", 涤生: "曾国藩",
  陈散原: "陈三立", 散原: "陈三立", 王观堂: "王国维", 观堂: "王国维", 静安: "王国维",
  // 近现代/当代 (本名 → 笔名)
  查海生: "海子", 赵振开: "北岛", 蒋海澄: "艾青", 周树人: "鲁迅", 郭开贞: "郭沫若",
};

// 查无此「诗人」的体面解释 — famous names people WILL search that genuinely aren't poet rows:
// prose masters, philosophers, and 蒙学 texts. Shown only when the normal search returns nothing,
// so a borderline entry that IS in the corpus can never be masked by this copy.
export const NOT_POETS: Record<string, string> = {
  庄子: "庄子存世为《庄子》散文(逍遥游/齐物论…),非诗——诗云只收诗。他的文章和一切可能的文字一样,躺在虚空的某个编号上:去「探诗」把全文贴入,可算出它的唯一住址。",
  庄周: "庄周存世为《庄子》散文,非诗——诗云只收诗。可在「探诗」里为《逍遥游》算出它在虚空中的编号。",
  老子: "老子存世为《道德经》,韵散相间但非诗——诗云只收诗。可在「探诗」里为任意章节算出虚空编号。",
  孔子: "孔子述而不作,《论语》是语录散文;《诗经》为他所编订而非所作(诗经本身在星图里,搜「诗经」)。",
  孟子: "孟子存世为《孟子》散文,非诗——诗云只收诗。",
  墨子: "墨子存世为《墨子》散文,非诗——诗云只收诗。",
  司马迁: "司马迁存世为《史记》,千古之文,非诗——诗云只收诗。",
  诸葛亮: "诸葛亮存世为《出师表》《诫子书》等文;《梁甫吟》学界多认作无名古辞。诗云只收诗,故星图无他——可在「探诗」里为《诫子书》算出它的虚空编号。",
  三字经: "《三字经》是蒙学韵文,非诗(作者王应麟在星图里——以他的诗;搜「王应麟」)。",
  千字文: "《千字文》是蒙学韵文,非诗(作者周兴嗣)。诗云只收诗。",
  百家姓: "《百家姓》是蒙学读物,非诗。诗云只收诗。",
  论语: "《论语》是语录散文,非诗。诗云只收诗。",
  道德经: "《道德经》韵散相间,传统不归入诗。可在「探诗」里为任意章节算出虚空编号。",
  出师表: "《出师表》是诸葛亮的奏表散文,非诗——可在「探诗」里贴入全文,算出它在虚空中的编号。",
  兰亭集序: "《兰亭集序》是王羲之的散文,非诗——但他的《兰亭诗》在星图里:搜「王羲之」。",
  桃花源记: "《桃花源记》是陶潜的散文(其后所附《桃花源诗》是诗)——搜「陶潜」即见他的星团。",
};

const GENERIC_MISS =
  "诗云未收录这个名字——可能 ta 以本名/别名行世(如「陶渊明」实为「陶潜」),或其传世之作是文章而非诗(诗云只收诗)。";

export interface PoetSearchSmart {
  results: PoetRow[];
  /** explanatory line under the input: alias redirect, prose-master explanation, or generic miss */
  note: string | null;
}

// canonical 别名层 (G2, data-driven — NOT a hardcoded name table like POET_ALIASES/GIFT_ALIAS above):
// a corpus-merged identity (e.g. 唐温如 → 唐珙) ships as a poemCount:0 PoetRow carrying `mergedInto`
// (build-data.mjs, from corpus poets.jsonl). Substring search still MATCHES the alias's own name (it's
// a real row with a real `name`), so without this redirect a search for 唐温如 would surface a dead
// 0-poem entry. Mirrors the POET_ALIASES note mechanism ("「X」即「Y」") but keyed off the DATA, so a
// future merge needs zero code changes here.
function redirectMerged(rows: PoetRow[], limit: number): PoetSearchSmart | null {
  const alias = rows.find((p) => p.mergedInto);
  if (!alias) return null;
  const { canonical, aliasName } = resolveCanonicalPoet(alias);
  if (!aliasName) return null; // dead mergedInto target (data desync) — degrade to normal results below
  const exact = searchPoets(canonical.name, limit).filter((p) => p.name === canonical.name && !p.mergedInto);
  const rest = rows.filter((p) => !p.mergedInto && !exact.some((e) => e.id === p.id));
  // same-name merge (唐珙|ming → 唐珙|yuan): aliasNoticeNames dynasty-suffixes both sides so the note
  // isn't self-referential (「唐珙(明)」即「唐珙(元)」); different names pass through untouched.
  const [aName, cName] = aliasNoticeNames(alias, canonical);
  return { results: [...exact, ...rest].slice(0, limit), note: `「${aName}」即「${cName}」` };
}

/** Poet search with the alias layer + graceful-miss copy. Drop-in for searchPoets in the UI. */
export function searchPoetsSmart(q: string, limit = 24): PoetSearchSmart {
  const s = q.trim();
  if (!s) return { results: [], note: null };
  const direct = searchPoets(s, limit);
  // a REAL, non-merged poet row with exactly this name always wins over the alias tables (defensive:
  // today no alias key collides with a row — poetAliases.test.ts asserts it — but future corpus updates
  // could add e.g. a contemporary poet writing under 「小山」). Still DROP any merged-alias rows mixed
  // into the substring match (e.g. querying 唐珙 also substring-matches the 唐珙|ming alias row) so a
  // 0-poem redirect entry never appears clickable in the results list.
  if (direct.some((p) => p.name === s && !p.mergedInto)) {
    return { results: direct.filter((p) => !p.mergedInto), note: null };
  }
  // data-driven merge redirect takes priority over the hardcoded POET_ALIASES table (a corpus-merged
  // identity is authoritative provenance, not a mere 字/号 nicety).
  const merged = redirectMerged(direct, limit);
  if (merged) return merged;
  const canonical = POET_ALIASES[s];
  if (canonical) {
    // exact alias: surface the canonical poet(s) first, then any other substring matches
    const exact = searchPoets(canonical, limit).filter((p) => p.name === canonical);
    const rest = direct.filter((p) => !exact.some((e) => e.id === p.id));
    return { results: [...exact, ...rest].slice(0, limit), note: `「${s}」即「${canonical}」` };
  }
  // NOT_POETS explanation shows whenever there's no EXACT row for the query — even if substring
  // matches exist (搜「庄子」 hits the contemporary poet 庄子轩; the philosopher still deserves his line).
  if (NOT_POETS[s]) return { results: direct, note: NOT_POETS[s] };
  if (direct.length) return { results: direct, note: null };
  return { results: direct, note: GENERIC_MISS };
}
