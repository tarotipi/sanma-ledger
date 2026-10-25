// 役と翻の集計。要件 §2.6, R-06, R-07, R-11, R-12, R-13, R-22, S-07〜S-09。
// 符は無いので、役の翻合計＋ドラで点数ランクが決まる（夏のランクアップは score.ts）。

import {
  type Face,
  type Flower,
  type Tile,
  nextFace,
  isHonor,
  isTerminalOrHonor,
  isDragon,
  PEI,
} from "./tiles";
import {
  allDecompositions,
  countsOf,
  isKokushi13Wait,
  type Decomposition,
  type Group,
  type Meld,
} from "./hand";

export interface WinContext {
  /** 手牌（副露を除く）。和了牌を含む物理牌（赤金白ポッチ情報つき） */
  hand: Tile[];
  /** 副露 */
  melds: Meld[];
  /** 副露の物理牌（赤金のドラ数え用）。無ければ赤金なしとして面だけ数える */
  meldTiles?: Tile[];
  winTile: Face;
  winBy: "tsumo" | "ron";
  seatWind: Face; // 自風（1z東 2z南 3z西）。北は R-06 で全員の役牌
  roundWind: Face; // 場風（1z東 2z南 3z西＝西入）
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  doraIndicators: Face[];
  uraIndicators?: Face[];
  flowers?: Flower[];
  rinshan?: boolean;
  chankan?: boolean;
  haitei?: boolean;
  houtei?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
  /** 白ポッチの万能で和了した（R-35：チップ1枚） */
  pocchiWin?: boolean;
}

export interface YakuLine {
  name: string;
  han: number;
}

export interface DoraDetail {
  aka: number;
  gold: number;
  omote: number;
  ura: number;
  autumn: number;
}

export interface ChipCounts {
  ura: number;
  gold: number;
  spring: number;
  winter: number;
  ippatsu: boolean;
  pocchi: boolean;
}

export interface WinAnalysis {
  valid: boolean; // 役があるか（ドラのみは無効）
  yakuman: number; // 役満の倍数（0なら通常役）
  yakumanNames: string[];
  han: number; // 通常役＋ドラの合計翻
  yaku: YakuLine[];
  dora: DoraDetail;
  chips: ChipCounts;
  summer: boolean; // 夏のランクアップ対象（score.ts で使う）
}

const GREEN: Set<Face> = new Set(["2s", "3s", "4s", "6s", "8s", "6z"]);

function isMenzen(melds: Meld[]): boolean {
  return melds.every((m) => m.kind === "ankan");
}

function allTilesForDora(ctx: WinContext): Tile[] {
  const out: Tile[] = [...ctx.hand];
  if (ctx.meldTiles) out.push(...ctx.meldTiles);
  else
    for (const m of ctx.melds) {
      const n = m.kind === "pon" ? 3 : 4;
      for (let i = 0; i < n; i++) out.push({ face: m.face });
    }
  return out;
}

function countDora(ctx: WinContext): DoraDetail {
  const tiles = allTilesForDora(ctx);
  const faces = tiles.map((t) => t.face);
  const fc = countsOf(faces);
  const countInd = (inds: Face[]) =>
    inds.reduce((sum, ind) => sum + (fc.get(nextFace(ind)) ?? 0), 0);
  const aka = tiles.filter((t) => t.red).length; // 赤5（R-12）
  const gold = tiles.filter((t) => t.gold).length; // 金5（R-13）
  const omote = countDoraInd(ctx.doraIndicators, fc);
  const ura = ctx.riichi ? countDoraInd(ctx.uraIndicators ?? [], fc) : 0;
  // 秋：5の牌のドラが1つ増える（R-22）。5p/5s の枚数ぶん
  const autumnPresent = (ctx.flowers ?? []).includes("autumn");
  const autumn = autumnPresent ? (fc.get("5p") ?? 0) + (fc.get("5s") ?? 0) : 0;
  void countInd;
  return { aka, gold, omote, ura, autumn };
}

function countDoraInd(inds: Face[], fc: Map<Face, number>): number {
  return inds.reduce((sum, ind) => sum + (fc.get(nextFace(ind)) ?? 0), 0);
}

// ---- 構造役（分解に依存する役）の評価 ----

interface StructResult {
  yakuman: number;
  yakumanNames: string[];
  han: number;
  yaku: YakuLine[];
}

function groupIsTripletLike(g: Group): boolean {
  return g.type === "triplet" || g.type === "kan";
}

/** 順子の並び低位の面 */
function seqLow(g: Group): Face {
  return g.faces[0];
}

function evalStandard(d: Decomposition, ctx: WinContext, menzen: boolean): StructResult {
  const yaku: YakuLine[] = [];
  const ymNames: string[] = [];
  let ym = 0;

  const sets = d.sets;
  const pair = d.pair;
  const triplets = sets.filter(groupIsTripletLike);
  const sequences = sets.filter((g) => g.type === "sequence");
  const allFaces: Face[] = [...sets.flatMap((g) => g.faces), pair, pair];
  const everyTerminalHonorSet = sets.every((g) => g.faces.some((f) => isTerminalOrHonor(f)));
  const pairTH = isTerminalOrHonor(pair);

  // --- 役満 ---
  const allHonors = allFaces.every(isHonor);
  const allTerminals = allFaces.every((f) => !isHonor(f) && (f[0] === "1" || f[0] === "9"));
  const allGreen = allFaces.every((f) => GREEN.has(f));

  // 四暗刻
  const concealedTriplets = triplets.filter((g) => g.concealed);
  let effAnkou = concealedTriplets.length;
  const ronCompletesTriplet =
    ctx.winBy === "ron" &&
    ctx.winTile !== pair &&
    concealedTriplets.some((g) => g.faces[0] === ctx.winTile);
  if (ronCompletesTriplet) effAnkou -= 1;

  if (effAnkou === 4) {
    if (ctx.winTile === pair) {
      ym += 2;
      ymNames.push("四暗刻単騎");
    } else {
      ym += 1;
      ymNames.push("四暗刻");
    }
  }

  // 大三元 / 小三元
  const dragonTriplets = triplets.filter((g) => isDragon(g.faces[0]));
  if (dragonTriplets.length === 3) {
    ym += 1;
    ymNames.push("大三元");
  }
  // 大四喜 / 小四喜
  const windTriplets = triplets.filter((g) => isWindFace(g.faces[0]));
  if (windTriplets.length === 4) {
    ym += 2;
    ymNames.push("大四喜");
  } else if (windTriplets.length === 3 && isWindFace(pair)) {
    ym += 1;
    ymNames.push("小四喜");
  }
  // 字一色
  if (allHonors) {
    ym += 1;
    ymNames.push("字一色");
  }
  // 緑一色
  if (allGreen) {
    ym += 1;
    ymNames.push("緑一色");
  }
  // 清老頭
  if (allTerminals && triplets.length === 4) {
    ym += 1;
    ymNames.push("清老頭");
  }
  // 四槓子
  if (sets.filter((g) => g.type === "kan").length === 4) {
    ym += 1;
    ymNames.push("四槓子");
  }
  // 九蓮宝燈（面前・清一色の特定形）
  const chuuren = detectChuuren(ctx, menzen);
  if (chuuren) {
    ym += chuuren === "junsei" ? 2 : 1;
    ymNames.push(chuuren === "junsei" ? "純正九蓮宝燈" : "九蓮宝燈");
  }

  if (ym > 0) {
    return { yakuman: ym, yakumanNames: ymNames, han: 0, yaku: [] };
  }

  // --- 通常役 ---
  // 役牌（白發中・場風・自風・北=全員）R-06
  for (const g of triplets) {
    const f = g.faces[0];
    if (isDragon(f)) yaku.push({ name: `役牌(${dragonName(f)})`, han: 1 });
    if (f === ctx.roundWind) yaku.push({ name: "場風", han: 1 });
    if (f === ctx.seatWind) yaku.push({ name: "自風", han: 1 });
    if (f === PEI) yaku.push({ name: "北", han: 1 });
  }
  // 小三元（2翻。役牌ぶんも別に乗る）
  if (dragonTriplets.length === 2 && isDragon(pair)) {
    yaku.push({ name: "小三元", han: 2 });
  }

  // タンヤオ（喰いタンあり R-07）
  if (allFaces.every((f) => !isTerminalOrHonor(f))) {
    yaku.push({ name: "断么九", han: 1 });
  }

  // 平和（面前・全順子・雀頭が役牌でない・両面待ち）
  if (menzen && sequences.length === 4 && !isYakuhaiPair(pair, ctx)) {
    if (isRyanmenWin(sequences, ctx.winTile)) yaku.push({ name: "平和", han: 1 });
  }

  // 一盃口 / 二盃口（面前）
  if (menzen) {
    const peko = countIipeiko(sequences);
    if (peko === 2) yaku.push({ name: "二盃口", han: 3 });
    else if (peko === 1) yaku.push({ name: "一盃口", han: 1 });
  }

  // 一気通貫
  if (hasIttsu(sequences)) yaku.push({ name: "一気通貫", han: menzen ? 2 : 1 });

  // 三色同刻（1・9は萬子でも可能）
  if (hasSanshokuDoukou(triplets)) yaku.push({ name: "三色同刻", han: 2 });

  // 対々和
  if (triplets.length === 4) yaku.push({ name: "対々和", han: 2 });

  // 三暗刻
  if (effAnkou === 3) yaku.push({ name: "三暗刻", han: 2 });

  // 混老頭（全て么九＋刻子/対子構成）
  if (allFaces.every(isTerminalOrHonor) && triplets.length === 4) {
    yaku.push({ name: "混老頭", han: 2 });
  }

  // チャンタ / 純チャン（各面子と雀頭に么九を含む・順子を含む）
  if (everyTerminalHonorSet && pairTH && sequences.length >= 1) {
    const hasHonor = allFaces.some(isHonor);
    if (!hasHonor) yaku.push({ name: "純全帯幺九", han: menzen ? 3 : 2 });
    else yaku.push({ name: "混全帯幺九", han: menzen ? 2 : 1 });
  }

  // 混一色 / 清一色
  const flush = detectFlush(allFaces);
  if (flush === "chin") yaku.push({ name: "清一色", han: menzen ? 6 : 5 });
  else if (flush === "hon") yaku.push({ name: "混一色", han: menzen ? 3 : 2 });

  const han = yaku.reduce((s, y) => s + y.han, 0);
  return { yakuman: 0, yakumanNames: [], han, yaku };
}

function evalChiitoi(d: Decomposition, ctx: WinContext): StructResult {
  const faces = ctx.hand.map((t) => t.face);
  const yaku: YakuLine[] = [{ name: "七対子", han: 2 }];
  // 清一色・混一色の七対子（R-07b：清一色七対子は役満扱い）
  const flush = detectFlush(faces);
  if (flush === "chin") {
    return { yakuman: 1, yakumanNames: ["清一色七対子"], han: 0, yaku: [] };
  }
  if (flush === "hon") yaku.push({ name: "混一色", han: 3 });
  if (faces.every((f) => !isTerminalOrHonor(f))) yaku.push({ name: "断么九", han: 1 });
  if (faces.every(isTerminalOrHonor)) yaku.push({ name: "混老頭", han: 2 });
  void d;
  const han = yaku.reduce((s, y) => s + y.han, 0);
  return { yakuman: 0, yakumanNames: [], han, yaku };
}

function evalKokushi(ctx: WinContext): StructResult {
  // 和了牌を1枚除いた13枚で十三面待ちか（S-08：十三面はダブル役満）
  const faces = ctx.hand.map((t) => t.face);
  const idx = faces.indexOf(ctx.winTile);
  if (idx >= 0) faces.splice(idx, 1);
  if (isKokushi13Wait(faces)) return { yakuman: 2, yakumanNames: ["国士無双十三面"], han: 0, yaku: [] };
  return { yakuman: 1, yakumanNames: ["国士無双"], han: 0, yaku: [] };
}

// ---- 文脈役（分解に依存しない） ----

function contextYaku(ctx: WinContext, menzen: boolean): { yaku: YakuLine[]; yakuman: number; ymNames: string[] } {
  const yaku: YakuLine[] = [];
  let ym = 0;
  const ymNames: string[] = [];
  if (ctx.tenhou) {
    ym += 1;
    ymNames.push("天和");
  }
  if (ctx.chiihou) {
    ym += 1;
    ymNames.push("地和");
  }
  if (ctx.doubleRiichi) yaku.push({ name: "ダブル立直", han: 2 });
  else if (ctx.riichi) yaku.push({ name: "立直", han: 1 });
  if (ctx.ippatsu) yaku.push({ name: "一発", han: 1 });
  if (menzen && ctx.winBy === "tsumo") yaku.push({ name: "門前清自摸和", han: 1 });
  if (ctx.haitei) yaku.push({ name: "海底摸月", han: 1 });
  if (ctx.houtei) yaku.push({ name: "河底撈魚", han: 1 });
  if (ctx.rinshan) yaku.push({ name: "嶺上開花", han: 1 });
  if (ctx.chankan) yaku.push({ name: "槍槓", han: 1 });
  return { yaku, yakuman: ym, ymNames };
}

// ---- ヘルパー ----

function isWindFace(f: Face): boolean {
  return f[1] === "z" && Number(f[0]) >= 1 && Number(f[0]) <= 4;
}
function dragonName(f: Face): string {
  return f === "5z" ? "白" : f === "6z" ? "發" : "中";
}
function isYakuhaiPair(pair: Face, ctx: WinContext): boolean {
  if (isDragon(pair)) return true;
  if (pair === ctx.roundWind || pair === ctx.seatWind) return true;
  if (pair === PEI) return true; // 北は全員の役牌（R-06）
  return false;
}

/** 両面待ちで和了したか（平和用） */
function isRyanmenWin(sequences: Group[], winTile: Face): boolean {
  for (const g of sequences) {
    if (!g.faces.includes(winTile)) continue;
    const low = seqLow(g);
    const r = Number(low[0]);
    const w = Number(winTile[0]);
    if (w === r + 1) continue; // 嵌張
    if (w === r) {
      // 低位側で和了。789待ちの7は辺張
      if (r === 7) continue;
      return true;
    }
    if (w === r + 2) {
      // 高位側で和了。123待ちの3は辺張
      if (r === 1) continue;
      return true;
    }
  }
  return false;
}

function countIipeiko(sequences: Group[]): number {
  const key = (g: Group) => g.faces.join(",");
  const m = new Map<string, number>();
  for (const g of sequences) m.set(key(g), (m.get(key(g)) ?? 0) + 1);
  let pairs = 0;
  for (const v of m.values()) pairs += Math.floor(v / 2);
  return pairs; // 2で二盃口
}

function hasIttsu(sequences: Group[]): boolean {
  for (const suit of ["p", "s"] as const) {
    const lows = new Set(sequences.filter((g) => g.faces[0][1] === suit).map((g) => Number(g.faces[0][0])));
    if (lows.has(1) && lows.has(4) && lows.has(7)) return true;
  }
  return false;
}

function hasSanshokuDoukou(triplets: Group[]): boolean {
  const byNum = new Map<number, Set<string>>();
  for (const g of triplets) {
    const f = g.faces[0];
    if (f[1] === "z") continue;
    const n = Number(f[0]);
    if (!byNum.has(n)) byNum.set(n, new Set());
    byNum.get(n)!.add(f[1]);
  }
  for (const suits of byNum.values()) if (suits.size === 3) return true;
  return false;
}

function detectFlush(faces: Face[]): "chin" | "hon" | null {
  const suits = new Set(faces.filter((f) => f[1] !== "z").map((f) => f[1]));
  const hasHonor = faces.some((f) => f[1] === "z");
  if (suits.size === 1) return hasHonor ? "hon" : "chin";
  return null;
}

function detectChuuren(ctx: WinContext, menzen: boolean): "junsei" | "normal" | null {
  if (!menzen || ctx.melds.length > 0) return null;
  const faces = ctx.hand.map((t) => t.face);
  if (faces.length !== 14) return null;
  const suits = new Set(faces.map((f) => f[1]));
  if (suits.size !== 1) return null;
  const suit = [...suits][0];
  if (suit === "z" || suit === "m") return null; // 萬子は1,9だけで九蓮にならない
  const c = countsOf(faces);
  const need = (n: number) => c.get(`${n}${suit}`) ?? 0;
  if (need(1) < 3 || need(9) < 3) return null;
  for (let n = 2; n <= 8; n++) if (need(n) < 1) return null;
  // 純正：和了牌を除くと 1112345678999
  const minus = [...faces];
  const idx = minus.indexOf(ctx.winTile);
  if (idx >= 0) minus.splice(idx, 1);
  const cm = countsOf(minus);
  const pure =
    (cm.get(`1${suit}`) ?? 0) === 3 &&
    (cm.get(`9${suit}`) ?? 0) === 3 &&
    [2, 3, 4, 5, 6, 7, 8].every((n) => (cm.get(`${n}${suit}`) ?? 0) === 1);
  return pure ? "junsei" : "normal";
}

// ---- 公開関数 ----

export function analyzeWin(ctx: WinContext): WinAnalysis {
  const menzen = isMenzen(ctx.melds);
  const concealedFaces = ctx.hand.map((t) => t.face);
  const decomps = allDecompositions(concealedFaces, ctx.melds);
  const dora = countDora(ctx);
  const doraHan = dora.aka + dora.gold + dora.omote + dora.ura + dora.autumn;
  const ctxY = contextYaku(ctx, menzen);

  let best: StructResult | null = null;
  for (const d of decomps) {
    let r: StructResult | null = null;
    if (d.form === "standard") r = evalStandard(d, ctx, menzen);
    else if (d.form === "chiitoitsu") r = evalChiitoi(d, ctx);
    else if (d.form === "kokushi") r = evalKokushi(ctx);
    if (!r) continue;
    if (!best) {
      best = r;
    } else if (r.yakuman !== best.yakuman) {
      // 役満優先
      if (r.yakuman > best.yakuman) best = r;
    } else if (r.yakuman === 0 && r.han > best.han) {
      // 同じ役満倍数なら翻が高い方
      best = r;
    }
  }

  const dummyChips: ChipCounts = {
    ura: dora.ura,
    gold: dora.gold,
    spring: (ctx.flowers ?? []).filter((f) => f === "spring").length,
    winter: (ctx.flowers ?? []).filter((f) => f === "winter").length,
    ippatsu: !!ctx.ippatsu,
    pocchi: !!ctx.pocchiWin,
  };

  if (!best) {
    return {
      valid: false,
      yakuman: 0,
      yakumanNames: [],
      han: 0,
      yaku: [],
      dora,
      chips: dummyChips,
      summer: (ctx.flowers ?? []).includes("summer"),
    };
  }

  // 役満
  const totalYakuman = best.yakuman + ctxY.yakuman;
  if (totalYakuman > 0) {
    return {
      valid: true,
      yakuman: totalYakuman,
      yakumanNames: [...best.yakumanNames, ...ctxY.ymNames],
      han: 0,
      yaku: [],
      dora,
      chips: dummyChips,
      summer: false, // 役満には夏を適用しない（R-21）
    };
  }

  // 通常役
  const yaku = [...best.yaku, ...ctxY.yaku];
  const yakuHan = yaku.reduce((s, y) => s + y.han, 0);
  const doraLines: YakuLine[] = [];
  if (dora.omote) doraLines.push({ name: "ドラ", han: dora.omote });
  if (dora.aka) doraLines.push({ name: "赤", han: dora.aka });
  if (dora.gold) doraLines.push({ name: "金", han: dora.gold });
  if (dora.autumn) doraLines.push({ name: "秋ドラ", han: dora.autumn });
  if (dora.ura) doraLines.push({ name: "裏ドラ", han: dora.ura });
  const han = yakuHan + doraHan;
  return {
    valid: yakuHan > 0, // 役がある場合のみ和了可（ドラのみは無効）
    yakuman: 0,
    yakumanNames: [],
    han,
    yaku: [...yaku, ...doraLines],
    dora,
    chips: dummyChips,
    summer: (ctx.flowers ?? []).includes("summer"),
  };
}
