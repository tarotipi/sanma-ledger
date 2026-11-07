import type { Adjustment, ChipEntry, ChipEvent, Game, Score } from "./types";

/** ルールの数値。変更はここだけで行う */
export const RULES = {
  START: 350, // 持ち点 35,000点（百点単位）
  RETURN: 400, // 返し 40,000点
  UMA_THIRD: -10, // 3位のウマ（pt）
  TOTAL: 1050, // 3人の合計 105,000点
  RATE_STEP: 10, // レートは10円刻み（1pt あたり円）
  DEFAULT_RATE: 50,
  CHIP_STEP: 50, // チップ単価は50円刻み
  CHIP_MIN: 50,
  DEFAULT_CHIP: 100,
  /** バイインの初期枚数（最初に全員がこの枚数を買う。買い足しも記録する） */
  CHIP_START: 20,
  /** 新しい順にこの件数までは警告なしで編集できる（W-01） */
  FREE_EDIT_LATEST: 1,
  /** 場代を収支に応じて分けるときの数値（F-40） */
  FEE_UNIT: 100, // 100円単位
  FEE_LOSS_LIMIT: 5000, // 当日この額を超えて負けた人は払わない（通算の補正の前）
  FEE_BIG_WIN: 30000, // 当日この額以上勝った人がいれば、その人たちだけで払う
  FEE_LIFETIME_PERCENT: 5, // 通算で負けている人の補正の割合
  FEE_LIFETIME_MAX: 5000, // 通算で負けている人の補正の上限
  FEE_LIFETIME_WIN_PERCENT: 25, // 通算で勝っている人の補正の割合
  FEE_LIFETIME_WIN_MAX: 15000, // 通算で勝っている人の補正の上限
  FEE_GAMES_BASE: 0.5, // 半荘数の効き。一番多く打った人が1倍、0半荘に近い人がこの倍率
  FEE_SETTLED_FACTOR: 0.8, // 前回の精算を済ませた人の重みの倍率
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
  /** チップ収支＝枚数×単価 − バイイン ＋ 返却（＋旧方式の増減記録） */
  chips: number;
  chipBuy: number;
  chipReturn: number;
  /** 最後に数えた枚数。未入力なら null */
  chipCount: number | null;
  external: number;
  internal: number;
  total: number;
};

export function emptyBalance(memberId: string): Balance {
  return { memberId, games: 0, mahjong: 0, chips: 0, chipBuy: 0, chipReturn: 0, chipCount: null, external: 0, internal: 0, total: 0 };
}

export function calcBalances(input: {
  games: Game[];
  chips: ChipEntry[];
  adjustments: Adjustment[];
  chipYen: number;
  chipEvents?: ChipEvent[];
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
  // バイイン方式：チップ収支＝最終枚数×単価 − バイイン合計 ＋ 返却合計。
  // 初期の20枚もバイインとして記録するので、再バイイン（買い足し）があっても正しく計算できる。
  const latestCount = new Map<string, ChipEvent>();
  for (const e of input.chipEvents ?? []) {
    const x = get(e.memberId);
    if (e.kind === "buy") x.chipBuy += e.amount;
    else if (e.kind === "return") x.chipReturn += e.amount;
    else {
      const prev = latestCount.get(e.memberId);
      if (!prev || prev.createdAt <= e.createdAt) latestCount.set(e.memberId, e);
    }
  }
  for (const [id, e] of latestCount) get(id).chipCount = e.amount;
  for (const x of Object.values(b)) x.chips += (x.chipCount ?? 0) * input.chipYen - x.chipBuy + x.chipReturn;
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

// ---------- 抜け番の提案 ----------

/**
 * 次の半荘の3人を提案する。games はそのセッションの削除済みを除いた半荘（順不同）。
 * - いまいる人＝直近4半荘に出た人（精算済みで抜けた人は除く）
 * - 抜ける順番：一度も抜けていない人が先（打った回数が多い順、同じなら memberOrder 順）、
 *   次に、最後に抜けたのが古い人から。これで「a→b→c→d→a…」のような回り方をそのまま続けられる
 */
export function suggestNext(
  games: Game[],
  memberOrder: string[],
  exclude: Set<string> = new Set(),
): { players: string[]; sitOut: string[] } | null {
  const sorted = [...games].sort((a, b) => a.seq - b.seq);
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1];
  const present = new Set<string>();
  sorted.slice(-4).forEach((g) => g.scores.forEach((s) => present.add(s.memberId)));
  exclude.forEach((id) => present.delete(id));
  const lastPlayers = last.scores.map((s) => s.memberId);
  if (present.size < 3) return null;
  if (present.size === 3) return { players: [...present], sitOut: [] };

  const firstSeen = new Map<string, number>();
  const lastOut = new Map<string, number>();
  const played = new Map<string, number>();
  for (const g of sorted) {
    const inGame = new Set(g.scores.map((s) => s.memberId));
    for (const id of inGame) {
      if (!firstSeen.has(id)) firstSeen.set(id, g.seq);
      played.set(id, (played.get(id) ?? 0) + 1);
    }
    for (const [id, first] of firstSeen) if (first < g.seq && !inGame.has(id)) lastOut.set(id, g.seq);
  }
  const order = (id: string) => {
    const i = memberOrder.indexOf(id);
    return i < 0 ? 999 : i;
  };
  const ranked = [...present].sort((a, b) => {
    const la = lastOut.get(a);
    const lb = lastOut.get(b);
    if (la === undefined && lb === undefined)
      return (played.get(b) ?? 0) - (played.get(a) ?? 0) || order(a) - order(b);
    if (la === undefined) return -1;
    if (lb === undefined) return 1;
    return la - lb;
  });
  const sitOut = ranked.slice(0, present.size - 3);
  const players = [...present]
    .filter((id) => !sitOut.includes(id))
    .sort((a, b) => {
      const ia = lastPlayers.indexOf(a);
      const ib = lastPlayers.indexOf(b);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || order(a) - order(b);
    });
  return { players, sitOut };
}

export type FeeShare = {
  memberId: string;
  /** 当日の収支（麻雀＋チップ。調整は含めない） */
  day: number;
  /** 今回より前の対局の通算（麻雀＋チップ） */
  lifetime: number;
  /** この対局で打った半荘数 */
  games: number;
  /** 前回の対局の精算を済ませたか */
  settled: boolean;
  /** 分ける比率の元になる重み */
  weight: number;
  /** 負担額（プラスの円） */
  yen: number;
};

/**
 * 場代を当日の収支と通算に応じて分ける（F-40）。
 * 基準＝当日の収支＋FEE_LOSS_LIMIT＋通算の補正。0未満は払わない。
 * 重み＝基準×半荘数の倍率×前回の精算の倍率。
 * 当日 FEE_BIG_WIN 以上の人がいれば、その人たちだけで分ける。全員の重みが0なら均等に分ける。
 * FEE_UNIT 単位で分け、割り切れない余りは一番勝っている人に足す。合計は amount と一致する。
 */
export function splitFeeByResult(amount: number, rows: readonly { memberId: string; day: number; lifetime: number; games: number; settled: boolean }[]): FeeShare[] {
  if (amount <= 0 || rows.length === 0) return [];
  const correction = (lifetime: number) => {
    if (lifetime > 0) return Math.min(RULES.FEE_LIFETIME_WIN_MAX, Math.trunc((lifetime * RULES.FEE_LIFETIME_WIN_PERCENT) / 100));
    return Math.max(-RULES.FEE_LIFETIME_MAX, Math.trunc((lifetime * RULES.FEE_LIFETIME_PERCENT) / 100));
  };
  const maxGames = Math.max(...rows.map((r) => r.games));
  const gamesFactor = (games: number) => (maxGames > 0 ? RULES.FEE_GAMES_BASE + ((1 - RULES.FEE_GAMES_BASE) * games) / maxGames : 1);
  const bigWin = rows.some((r) => r.day >= RULES.FEE_BIG_WIN);
  let list: FeeShare[] = rows.map((r) => ({
    ...r,
    weight:
      bigWin && r.day < RULES.FEE_BIG_WIN
        ? 0
        : Math.max(0, r.day + RULES.FEE_LOSS_LIMIT + correction(r.lifetime)) * gamesFactor(r.games) * (r.settled ? RULES.FEE_SETTLED_FACTOR : 1),
    yen: 0,
  }));
  if (list.every((r) => r.weight === 0)) list = list.map((r) => ({ ...r, weight: 1 }));
  const total = list.reduce((a, r) => a + r.weight, 0);
  const units = Math.floor(amount / RULES.FEE_UNIT);
  const raw = list.map((r) => (r.weight * units) / total);
  const floors = raw.map(Math.floor);
  let rest = units - floors.reduce((a, b) => a + b, 0);
  const order = list.map((_, i) => i).sort((a, b) => raw[b] - floors[b] - (raw[a] - floors[a]) || list[b].day - list[a].day);
  for (const i of order) {
    if (rest <= 0) break;
    floors[i]++;
    rest--;
  }
  const out = list.map((r, i) => ({ ...r, yen: floors[i] * RULES.FEE_UNIT }));
  const remainder = amount - units * RULES.FEE_UNIT;
  if (remainder > 0) {
    const top = out.filter((r) => r.weight > 0).sort((a, b) => b.day - a.day)[0];
    top.yen += remainder;
  }
  return out;
}
