// 和了判定・面子分解・待ち計算。要件 Phase 1。
// 符は計算しないので「分解＝どの面子/雀頭で構成されるか」を列挙できれば、役と翻の判定に足りる。
// 白ポッチの万能化（R-31）は呼び出し側で解決済みとし、ここでは白(5z)として扱う。

import { ALL_FACES, HONOR_FACES, type Face } from "./tiles";

export type MeldKind = "pon" | "ankan" | "minkan" | "kakan";

/** 副露（鳴き）。三麻なのでチーはない */
export interface Meld {
  kind: MeldKind;
  face: Face;
}

export type GroupType = "pair" | "triplet" | "sequence" | "kan";

export interface Group {
  type: GroupType;
  faces: Face[];
  /** 面前（暗）かどうか。ポン・明槓・加槓は false、暗刻・暗槓・手牌内の順子/対子は true */
  concealed: boolean;
}

/** 標準形の分解結果（4面子＋1雀頭） */
export interface Decomposition {
  form: "standard" | "chiitoitsu" | "kokushi";
  /** 雀頭以外の4つ（順子・刻子・槓）。副露も含む */
  sets: Group[];
  /** 雀頭の面 */
  pair: Face;
}

const ORDER: Face[] = ALL_FACES;

function cloneCounts(c: Map<Face, number>): Map<Face, number> {
  return new Map(c);
}

/** 面ごとの枚数マップ（面文字列のみ） */
export function countsOf(faces: Face[]): Map<Face, number> {
  const m = new Map<Face, number>();
  for (const f of faces) m.set(f, (m.get(f) ?? 0) + 1);
  return m;
}

/**
 * 残りの牌を「順子・刻子だけ」で全て使い切る分解を全列挙する。
 * 常に最も小さい面から処理するので重複は出ない。使い切れなければ空配列。
 */
function decompSets(counts: Map<Face, number>): Group[][] {
  let first: Face | undefined;
  for (const f of ORDER) {
    if ((counts.get(f) ?? 0) > 0) {
      first = f;
      break;
    }
  }
  if (!first) return [[]]; // 全部使い切った
  const results: Group[][] = [];
  const n = counts.get(first)!;

  // 刻子
  if (n >= 3) {
    counts.set(first, n - 3);
    for (const rest of decompSets(counts)) {
      results.push([{ type: "triplet", faces: [first, first, first], concealed: true }, ...rest]);
    }
    counts.set(first, n);
  }

  // 順子（筒子・索子のみ）
  const suit = first[1];
  if (suit === "p" || suit === "s") {
    const r = Number(first[0]);
    if (r <= 7) {
      const f2 = `${r + 1}${suit}`;
      const f3 = `${r + 2}${suit}`;
      if ((counts.get(f2) ?? 0) > 0 && (counts.get(f3) ?? 0) > 0) {
        counts.set(first, n - 1);
        counts.set(f2, counts.get(f2)! - 1);
        counts.set(f3, counts.get(f3)! - 1);
        for (const rest of decompSets(counts)) {
          results.push([{ type: "sequence", faces: [first, f2, f3], concealed: true }, ...rest]);
        }
        counts.set(first, n);
        counts.set(f2, counts.get(f2)! + 1);
        counts.set(f3, counts.get(f3)! + 1);
      }
    }
  }

  return results;
}

/** 副露を Group に変換 */
function meldToGroup(m: Meld): Group {
  if (m.kind === "pon") return { type: "triplet", faces: [m.face, m.face, m.face], concealed: false };
  if (m.kind === "ankan") return { type: "kan", faces: [m.face, m.face, m.face, m.face], concealed: true };
  // minkan / kakan
  return { type: "kan", faces: [m.face, m.face, m.face, m.face], concealed: false };
}

/**
 * 標準形（4面子1雀頭）の分解を全列挙。
 * concealedFaces は手牌内（副露を除く）の面。melds は副露。
 */
export function decomposeStandard(concealedFaces: Face[], melds: Meld[]): Decomposition[] {
  const setsNeeded = 4 - melds.length;
  if (setsNeeded < 0) return [];
  const meldGroups = melds.map(meldToGroup);
  const base = countsOf(concealedFaces);
  const results: Decomposition[] = [];

  for (const f of ORDER) {
    const n = base.get(f) ?? 0;
    if (n >= 2) {
      const counts = cloneCounts(base);
      counts.set(f, n - 2);
      for (const sets of decompSets(counts)) {
        if (sets.length === setsNeeded) {
          results.push({ form: "standard", sets: [...meldGroups, ...sets], pair: f });
        }
      }
    }
  }
  return results;
}

/** 七対子（面前のみ・7種の対子） */
export function isChiitoitsu(concealedFaces: Face[], melds: Meld[]): boolean {
  if (melds.length > 0) return false;
  if (concealedFaces.length !== 14) return false;
  const c = countsOf(concealedFaces);
  if (c.size !== 7) return false;
  for (const v of c.values()) if (v !== 2) return false;
  return true;
}

/** 国士無双の13種 */
const KOKUSHI_FACES: Face[] = ["1m", "9m", "1p", "9p", "1s", "9s", ...HONOR_FACES];

/** 国士無双（面前のみ・13種すべて＋どれか1枚が2枚） */
export function isKokushi(concealedFaces: Face[], melds: Meld[]): boolean {
  if (melds.length > 0) return false;
  if (concealedFaces.length !== 14) return false;
  const c = countsOf(concealedFaces);
  for (const f of KOKUSHI_FACES) if ((c.get(f) ?? 0) < 1) return false;
  let pair = 0;
  for (const [f, v] of c) {
    if (!KOKUSHI_FACES.includes(f)) return false;
    if (v >= 2) pair++;
  }
  return pair === 1 && c.size === 13;
}

/** 国士十三面待ち（和了前の13枚が13種1枚ずつ）判定に使う */
export function isKokushi13Wait(concealed13: Face[]): boolean {
  if (concealed13.length !== 13) return false;
  const c = countsOf(concealed13);
  if (c.size !== 13) return false;
  for (const f of KOKUSHI_FACES) if (c.get(f) !== 1) return false;
  return true;
}

/** 和了しているか（14枚相当＝手牌＋副露が完成形か） */
export function isWinningHand(concealedFaces: Face[], melds: Meld[]): boolean {
  if (isKokushi(concealedFaces, melds)) return true;
  if (isChiitoitsu(concealedFaces, melds)) return true;
  return decomposeStandard(concealedFaces, melds).length > 0;
}

/** 全ての和了形（標準＋七対子＋国士）を返す。役判定で使う */
export function allDecompositions(concealedFaces: Face[], melds: Meld[]): Decomposition[] {
  const out = decomposeStandard(concealedFaces, melds);
  if (isChiitoitsu(concealedFaces, melds)) {
    const c = countsOf(concealedFaces);
    const pair = [...c.keys()][0];
    out.push({ form: "chiitoitsu", sets: [], pair });
  }
  if (isKokushi(concealedFaces, melds)) {
    const c = countsOf(concealedFaces);
    let pair: Face = "1z";
    for (const [f, v] of c) if (v >= 2) pair = f;
    out.push({ form: "kokushi", sets: [], pair });
  }
  return out;
}

/**
 * 待ち牌を列挙（テンパイ表示 D-05 用）。
 * concealedFaces は手牌内（副露を除く）。1枚足して和了になる面を返す。
 */
export function waits(concealedFaces: Face[], melds: Meld[]): Face[] {
  const out: Face[] = [];
  for (const f of ORDER) {
    if (isWinningHand([...concealedFaces, f], melds)) out.push(f);
  }
  return out;
}

/** テンパイか */
export function isTenpai(concealedFaces: Face[], melds: Meld[]): boolean {
  return waits(concealedFaces, melds).length > 0;
}

// ---------------------------------------------------------------------------
// シャンテン数（D-07 表示用）。0=テンパイ、-1=和了形。
// 手牌は副露を除いた面だけを渡す（花 "f*" は呼び出し側で除くが、念のためここでも無視する）。
// 13枚相当（3n+1）でも14枚相当（3n+2）でも使える（14枚なら「1枚切った後の最小」と同じ値になる）。
// ---------------------------------------------------------------------------

/** 牌種index → スート（順子が作れるのは筒子・索子だけ） */
const SUIT_OF: string[] = ORDER.map((f) => f[1]);
/** 牌種index → 数字（字牌は0） */
const RANK_OF: number[] = ORDER.map((f) => (f[1] === "z" ? 0 : Number(f[0])));
const INDEX_OF = new Map<Face, number>(ORDER.map((f, i) => [f, i]));

/** index i から始まる順子・搭子に使えるスートか（萬子は1と9しかないので不可） */
function seqSuit(i: number): boolean {
  return SUIT_OF[i] === "p" || SUIT_OF[i] === "s";
}

/** 面ごとの枚数（ORDER 順の配列）。花など ORDER に無い面は無視 */
function countArray(faces: Face[]): number[] {
  const c = ORDER.map(() => 0);
  for (const f of faces) {
    const i = INDEX_OF.get(f);
    if (i !== undefined) c[i]++;
  }
  return c;
}

/**
 * 面子・搭子の取り方を全部試して「2×面子数＋搭子数」の最大を返す（面子＋搭子は need 個まで）。
 * c は破壊的に使うが、戻る前に必ず元に戻す。
 */
function bestSetScore(c: number[], start: number, m: number, t: number, need: number): number {
  let i = start;
  while (i < c.length && c[i] === 0) i++;
  if (i >= c.length) return 2 * m + Math.min(t, need - m);
  let best = 0;
  const r = RANK_OF[i];
  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3;
    best = Math.max(best, bestSetScore(c, i, m + 1, t, need));
    c[i] += 3;
  }
  // 順子
  if (seqSuit(i) && r <= 7 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    best = Math.max(best, bestSetScore(c, i, m + 1, t, need));
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
  }
  // 対子（搭子として）
  if (c[i] >= 2) {
    c[i] -= 2;
    best = Math.max(best, bestSetScore(c, i, m, t + 1, need));
    c[i] += 2;
  }
  // 両面・辺張
  if (seqSuit(i) && r <= 8 && c[i + 1] > 0) {
    c[i]--;
    c[i + 1]--;
    best = Math.max(best, bestSetScore(c, i, m, t + 1, need));
    c[i]++;
    c[i + 1]++;
  }
  // 嵌張
  if (seqSuit(i) && r <= 7 && c[i + 2] > 0) {
    c[i]--;
    c[i + 2]--;
    best = Math.max(best, bestSetScore(c, i, m, t + 1, need));
    c[i]++;
    c[i + 2]++;
  }
  // 孤立牌として捨てる
  c[i]--;
  best = Math.max(best, bestSetScore(c, i, m, t, need));
  c[i]++;
  return best;
}

/** 標準形（4面子1雀頭）のシャンテン数。副露1つ＝面子1つ */
export function shantenStandard(concealedFaces: Face[], melds: Meld[]): number {
  const c = countArray(concealedFaces);
  const need = 4 - melds.length;
  const base = 8 - 2 * melds.length;
  let best = base - bestSetScore(c, 0, 0, 0, need); // 雀頭なし
  for (let i = 0; i < c.length; i++) {
    if (c[i] < 2) continue;
    c[i] -= 2;
    best = Math.min(best, base - bestSetScore(c, 0, 0, 0, need) - 1);
    c[i] += 2;
  }
  return best;
}

/** 七対子のシャンテン数（副露があれば対象外＝大きな値） */
export function shantenChiitoitsu(concealedFaces: Face[], melds: Meld[]): number {
  if (melds.length > 0) return 99;
  const c = countArray(concealedFaces);
  const kinds = c.filter((n) => n > 0).length;
  const pairs = c.filter((n) => n >= 2).length;
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双のシャンテン数（副露があれば対象外＝大きな値） */
export function shantenKokushi(concealedFaces: Face[], melds: Meld[]): number {
  if (melds.length > 0) return 99;
  const c = countsOf(concealedFaces);
  let kinds = 0;
  let hasPair = false;
  for (const f of KOKUSHI_FACES) {
    const n = c.get(f) ?? 0;
    if (n > 0) kinds++;
    if (n >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** 標準形・七対子・国士の最小シャンテン数（0=テンパイ、-1=和了形） */
export function shanten(concealedFaces: Face[], melds: Meld[]): number {
  const faces = concealedFaces.filter((f) => !f.startsWith("f"));
  return Math.min(shantenStandard(faces, melds), shantenChiitoitsu(faces, melds), shantenKokushi(faces, melds));
}
