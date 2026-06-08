// Placeholder landmark poets so the cloud has named anchors across the full dynasty
// sweep in the Step-4 shell. The real ~30k-poet set arrives from the Step-3 pipeline
// (Werneror backbone + chinese-poetry 唐宋 overlay). `dynasty` = canonical key in DYNASTIES.
export interface Landmark {
  name: string;
  dynasty: string;
}

export const FAMOUS_POETS: Landmark[] = [
  { name: "屈原", dynasty: "xianqin" },
  { name: "宋玉", dynasty: "xianqin" },
  { name: "项羽", dynasty: "qinhan" },
  { name: "司马相如", dynasty: "qinhan" },
  { name: "蔡文姬", dynasty: "qinhan" },
  { name: "曹操", dynasty: "weijin" },
  { name: "曹植", dynasty: "weijin" },
  { name: "阮籍", dynasty: "weijin" },
  { name: "陶渊明", dynasty: "weijin" },
  { name: "谢灵运", dynasty: "nanbeichao" },
  { name: "鲍照", dynasty: "nanbeichao" },
  { name: "庾信", dynasty: "nanbeichao" },
  { name: "杨广", dynasty: "sui" },
  { name: "李白", dynasty: "tang" },
  { name: "杜甫", dynasty: "tang" },
  { name: "王维", dynasty: "tang" },
  { name: "白居易", dynasty: "tang" },
  { name: "李商隐", dynasty: "tang" },
  { name: "杜牧", dynasty: "tang" },
  { name: "李煜", dynasty: "wudai" },
  { name: "韦庄", dynasty: "wudai" },
  { name: "苏轼", dynasty: "song" },
  { name: "陆游", dynasty: "song" },
  { name: "李清照", dynasty: "song" },
  { name: "辛弃疾", dynasty: "song" },
  { name: "王安石", dynasty: "song" },
  { name: "萧观音", dynasty: "liao" },
  { name: "元好问", dynasty: "jin" },
  { name: "关汉卿", dynasty: "yuan" },
  { name: "马致远", dynasty: "yuan" },
  { name: "白朴", dynasty: "yuan" },
  { name: "高启", dynasty: "ming" },
  { name: "唐寅", dynasty: "ming" },
  { name: "于谦", dynasty: "ming" },
  { name: "纳兰性德", dynasty: "qing" },
  { name: "龚自珍", dynasty: "qing" },
  { name: "袁枚", dynasty: "qing" },
  { name: "秋瑾", dynasty: "jinxiandai" },
  { name: "黄遵宪", dynasty: "jinxiandai" },
  { name: "毛泽东", dynasty: "dangdai" },
  // 现代/当代 新诗 (from the modern-poetry corpus)
  { name: "徐志摩", dynasty: "jinxiandai" },
  { name: "戴望舒", dynasty: "jinxiandai" },
  { name: "闻一多", dynasty: "jinxiandai" },
  { name: "艾青", dynasty: "jinxiandai" },
  { name: "海子", dynasty: "dangdai" },
  { name: "北岛", dynasty: "dangdai" },
  { name: "顾城", dynasty: "dangdai" },
  { name: "舒婷", dynasty: "dangdai" },
];
