// チップ（祝儀）の算出。要件 C-03, C-04, R-35, R-20, R-23, R-13, R-11。
// チップは点数とは別のゼロサムのやりとり。終局時に対戦記録の精算へ合流する（C-06）。

import type { ChipCounts } from "./yaku";

export interface ChipBreakdown {
  ura: number; // 裏ドラ的中の枚数（C-04）
  gold: number; // 金5の枚数（C-04, R-13）
  spring: number; // 春の枚数（C-04, R-20）
  winter: number; // 冬でめくれた枚数（C-04, R-23）
  ippatsu: number; // 一発（1枚）
  pocchi: number; // 白ポッチ和了（1枚）
  total: number;
}

/** 和了1回で和了者がもらうチップ枚数の内訳（C-04） */
export function chipBreakdown(c: ChipCounts): ChipBreakdown {
  const ura = c.ura;
  const gold = c.gold;
  const spring = c.spring;
  const winter = c.winter;
  const ippatsu = c.ippatsu ? 1 : 0;
  const pocchi = c.pocchi ? 1 : 0;
  const total = ura + gold + spring + winter + ippatsu + pocchi;
  return { ura, gold, spring, winter, ippatsu, pocchi, total };
}

export interface ChipSettleInput {
  chips: ChipCounts;
  winBy: "tsumo" | "ron";
  winnerId: string;
  discarderId?: string;
  players: [string, string, string];
}

/**
 * チップの移動を計算（C-03）。
 * ツモ＝他家2人がそれぞれ total 枚を支払う。ロン＝放銃者が total 枚を支払う。
 * 返り値は プレイヤーID→チップ増減（合計0）。
 */
export function settleChips(input: ChipSettleInput): Record<string, number> {
  const { chips, winBy, winnerId, discarderId, players } = input;
  const { total } = chipBreakdown(chips);
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p] = 0;
  if (total === 0) return deltas;

  if (winBy === "ron") {
    if (!discarderId) throw new Error("ロンには放銃者が必要");
    deltas[discarderId] -= total;
    deltas[winnerId] += total;
  } else {
    for (const p of players) {
      if (p === winnerId) continue;
      deltas[p] -= total;
      deltas[winnerId] += total;
    }
  }
  return deltas;
}
