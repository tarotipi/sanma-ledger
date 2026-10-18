import type {
  Adjustment,
  ChipEntry,
  Game,
  Score,
} from "./types";

/** ルールの数値。変更はここだけで行う */
export const RULES = {
  START: 350, // 持ち点 35,000点（百点単位）
  RETURN: 400, // 返し 40,000点
  UMA_THIRD: -10, // 3位のウマ（pt）
  TOTAL: 1050, // 3人の合計 105,000点
  RATE_STEP: 10, // レートは10円刻み（1pt あたり円）
  DEFAULT_RATE: 60,
  CHIP_STEP: 50, // チップ単価は50円刻み
  CHIP_MIN: 50,
  DEFAULT_CHIP: 100,
  /** 新しい順にこの件数までは警告なしで編集できる（W-01） */
  FREE_EDIT_LATEST: 1,
} as const;

export type Rank = 1 | 2 | 3;

export type GameResult = {
  memberId: string;
  rank: Rank;
  score: number;
  pt10: number;
  yen: number;
};

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_three" | "duplicate" | "invalid" | "total" | "tie_unresolved";
      diff?: number;
    };

/** 同点のグループ（2人以上が同じ素点）を返す */
export function tieGroups(scores: Score[]): Score[][] {
  const byScore = new Map<number, Score[]>();
  for (const s of scores) {
    const list = byScore.get(s.score) ?? [];
    list.push(s);
    byScore.set(s.score, list);
  }
  return [...byScore.values()].filter((g) => g.length > 1);
}

export function hasUnresolvedTie(scores: Score[]): boolean {
  return tieGroups(scores).some((g) => {
    const ties = g.map((s) => s.tie);
    if (ties.some((t) => t === undefined || t === null || !Number.isFinite(t))) return true;
    return new Set(ties).size !== ties.length;
  });
}

export function validateGame(scores: Score[]): ValidationResult {
  if (scores.length !== 3) return { ok: false, reason: "not_three" };
  if (new Set(scores.map((s) => s.memberId)).size !== 3) return { ok: false, reason: "duplicate" };
  if (scores.some((s) => !Number.isInteger(s.score) || Math.abs(s.score) > 100000))
    return { ok: false, reason: "invalid" };
  const sum = scores.reduce((a, s) => a + s.score, 0);
  if (sum !== RULES.TOTAL) return { ok: false, reason: "total", diff: sum - RULES.TOTAL };
  if (hasUnresolvedTie(scores)) return { ok: false, reason: "tie_unresolved" };
  return { ok: true };
}

/** 素点の高い順。同点は tie の小さい順 */
export function rankOrder(scores: Score[]): Score[] {
  return [...scores].sort(
    (a, b) => b.score - a.score || (a.tie ?? Infinity) - (b.tie ?? Infinity),
  );
}

/** 1半荘の順位・pt・円。戻り値は順位順 */
export function calcGame(scores: Score[], rateYenPerPt: number): GameResult[] {
  const [first, second, third] = rankOrder(scores);
  const pt2 = second.score - RULES.RETURN;
  const pt3 = third.score - RULES.RETURN + RULES.UMA_THIRD * 10;
  const pt1 = -(pt2 + pt3);
  const yen = (pt10: number) => (pt10 * rateYenPerPt) / 10;
  return [
    { memberId: first.memberId, rank: 1, score: first.score, pt10: pt1, yen: yen(pt1) },
    { memberId: second.memberId, rank: 2, score: second.score, pt10: pt2, yen: yen(pt2) },
    { memberId: third.memberId, rank: 3, score: third.score, pt10: pt3, yen: yen(pt3) },
  ];
}

export function resultFor(game: Game, memberId: string): GameResult | undefined {
  return calcGame(game.scores, game.rate).find((r) => r.memberId === memberId);
}

// ---------- 成績 ----------

export type PlayerStats = {
  memberId: string;
  games: number;
  ranks: [number, number, number];
  topRate: number;
  rentaiRate: number;
  lastRate: number;
  avgRank: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  tobi: number;
  tobiRate: number;
  totalPt10: number;
  avgPt10: number;
  yen: number;
  maxWin: number;
  maxLoss: number;
  maxTopStreak: number;
  maxLastStreak: number;
};

/** games は削除済みを除き、古い順に並べて渡す */
export function calcStats(games: Game[]): Record<string, PlayerStats> {
  const acc: Record<
    string,
    PlayerStats & { _scoreSum: number; _rankSum: number; _top: number; _last: number }
  > = {};
  for (const g of games) {
    for (const r of calcGame(g.scores, g.rate)) {
      const s =
        acc[r.memberId] ??
        (acc[r.memberId] = {
          memberId: r.memberId,
          games: 0,
          ranks: [0, 0, 0],
          topRate: 0,
          rentaiRate: 0,
          lastRate: 0,
          avgRank: 0,
          avgScore: 0,
          maxScore: -Infinity,
          minScore: Infinity,
          tobi: 0,
          tobiRate: 0,
          totalPt10: 0,
          avgPt10: 0,
          yen: 0,
          maxWin: -Infinity,
          maxLoss: Infinity,
          maxTopStreak: 0,
          maxLastStreak: 0,
          _scoreSum: 0,
          _rankSum: 0,
          _top: 0,
          _last: 0,
        });
      s.games++;
      s.ranks[r.rank - 1]++;
      s._scoreSum += r.score;
      s._rankSum += r.rank;
      s.maxScore = Math.max(s.maxScore, r.score);
      s.minScore = Math.min(s.minScore, r.score);
      if (r.score < 0) s.tobi++;
      s.totalPt10 += r.pt10;
      s.yen += r.yen;
      s.maxWin = Math.max(s.maxWin, r.yen);
      s.maxLoss = Math.min(s.maxLoss, r.yen);
      s._top = r.rank === 1 ? s._top + 1 : 0;
      s._last = r.rank === 3 ? s._last + 1 : 0;
      s.maxTopStreak = Math.max(s.maxTopStreak, s._top);
      s.maxLastStreak = Math.max(s.maxLastStreak, s._last);
    }
  }
  const out: Record<string, PlayerStats> = {};
  for (const [id, s] of Object.entries(acc)) {
    const n = s.games;
    const { _scoreSum, _rankSum, _top, _last, ...rest } = s;
    void _top;
    void _last;
    out[id] = {
      ...rest,
      topRate: s.ranks[0] / n,
      rentaiRate: (s.ranks[0] + s.ranks[1]) / n,
      lastRate: s.ranks[2] / n,
      avgRank: _rankSum / n,
      avgScore: _scoreSum / n,
      tobiRate: s.tobi / n,
      avgPt10: s.totalPt10 / n,
    };
  }
  return out;
}

// ---------- 精算 ----------

export type Balance = {
  memberId: string;
  games: number;
  mahjong: number;
  chips: number;
  external: number;
  internal: number;
  total: number;
};

export function emptyBalance(memberId: string): Balance {
  return { memberId, games: 0, mahjong: 0, chips: 0, external: 0, internal: 0, total: 0 };
}

export function calcBalances(input: {
  games: Game[];
  chips: ChipEntry[];
  adjustments: Adjustment[];
  chipYen: number;
}): Record<string, Balance> {
  const b: Record<string, Balance> = {};
  const get = (id: string) => b[id] ?? (b[id] = emptyBalance(id));
  for (const g of input.games) {
    for (const r of calcGame(g.scores, g.rate)) {
      const x = get(r.memberId);
      x.games++;
      x.mahjong += r.yen;
    }
  }
  for (const c of input.chips) for (const l of c.lines) get(l.memberId).chips += l.count * input.chipYen;
  for (const a of input.adjustments)
    for (const l of a.lines) {
      const x = get(l.memberId);
      if (a.kind === "internal") x.internal += l.yen;
      else x.external += l.yen;
    }
  for (const x of Object.values(b)) x.total = x.mahjong + x.chips + x.internal + x.external;
  return b;
}

export type Transfer = { from: string; to: string; yen: number };

/** 送金リスト。対象は麻雀収支＋チップ＋メンバー間の調整（合計0）。回数は人数−1以下 */
export function calcTransfers(balances: Record<string, Balance>): Transfer[] {
  const net = Object.values(balances)
    .map((x) => ({ id: x.memberId, v: x.mahjong + x.chips + x.internal }))
    .filter((x) => x.v !== 0);
  const payers = net.filter((x) => x.v < 0).map((x) => ({ ...x, v: -x.v }));
  const receivers = net.filter((x) => x.v > 0);
  const out: Transfer[] = [];
  while (payers.length && receivers.length) {
    payers.sort((a, b) => b.v - a.v);
    receivers.sort((a, b) => b.v - a.v);
    const p = payers[0];
    const r = receivers[0];
    const yen = Math.min(p.v, r.v);
    out.push({ from: p.id, to: r.id, yen });
    p.v -= yen;
    r.v -= yen;
    if (p.v === 0) payers.shift();
    if (r.v === 0) receivers.shift();
  }
  return out;
}

export function sumIsZero(values: number[]): boolean {
  return values.reduce((a, v) => a + v, 0) === 0;
}

/**
 * 場代などの金額を重みに応じて割る。戻り値は支払いなのでマイナス。
 * 1円未満は切り捨て、余りは端数の大きい人から1円ずつ配る。
 */
export function splitFee(
  amount: number,
  payers: { memberId: string; weight: number }[],
): { memberId: string; yen: number }[] {
  const list = payers.filter((p) => p.weight > 0);
  const W = list.reduce((a, p) => a + p.weight, 0);
  if (!W || amount <= 0) return [];
  const raw = list.map((p) => {
    const exact = (amount * p.weight) / W;
    return { memberId: p.memberId, base: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let rest = amount - raw.reduce((a, r) => a + r.base, 0);
  [...raw]
    .sort((a, b) => b.frac - a.frac)
    .forEach((r) => {
      if (rest > 0) {
        r.base++;
        rest--;
      }
    });
  return raw.map((r) => ({ memberId: r.memberId, yen: -r.base }));
}

// ---------- 表示用 ----------

export function fmtPt(pt10: number): string {
  const v = pt10 / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
}

export function fmtYen(yen: number, withSign = true): string {
  const s = Math.abs(Math.round(yen)).toLocaleString("ja-JP");
  if (!withSign) return `${yen < 0 ? "−" : ""}${s}`;
  return `${yen > 0 ? "+" : yen < 0 ? "−" : "±"}${s}`;
}

export function fmtScore(score100: number): string {
  return `${score100 < 0 ? "−" : ""}${Math.abs(score100 * 100).toLocaleString("ja-JP")}`;
}
