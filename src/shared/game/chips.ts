// チップ（祝儀）の算出。要件 C-03, C-04, C-07, R-35, R-20, R-23, R-13, R-11。
// チップは点数とは別のゼロサムのやりとり。終局時に対戦記録の精算へ合流する（C-06）。

import type { ChipCounts } from "./yaku";
import type { ChipDetail } from "./protocol";

/** 役満のチップ：ツモは他家がそれぞれこの枚数×倍数（C-07） */
export const YAKUMAN_CHIPS_TSUMO_EACH = 5;
/** 役満のチップ：ロンは放銃者がこの枚数×倍数（C-07） */
export const YAKUMAN_CHIPS_RON = 10;

export interface ChipBreakdown {
  ura: number; // 裏ドラ的中の枚数（C-04）
  gold: number; // 金5の枚数（C-04, R-13）
  spring: number; // 春の枚数（C-04, R-20）
  winter: number; // 冬でめくれた枚数（C-04, R-23）
  ippatsu: number; // 一発（1枚）
  pocchi: number; // 白ポッチ和了（1枚）
  /** 役満の倍数（0=役満でない）。枚数は winBy で変わるので yakumanChips() で出す（C-07） */
  yakuman: number;
  /** 通常の祝儀（C-04）の合計。役満分は含まない */
  total: number;
}

/** 和了1回で和了者がもらうチップ枚数の内訳（C-04）。yakuman は役満の倍数（C-07） */
export function chipBreakdown(c: ChipCounts, yakuman = 0): ChipBreakdown {
  const ura = c.ura;
  const gold = c.gold;
  const spring = c.spring;
  const winter = c.winter;
  const ippatsu = c.ippatsu ? 1 : 0;
  const pocchi = c.pocchi ? 1 : 0;
  const total = ura + gold + spring + winter + ippatsu + pocchi;
  return { ura, gold, spring, winter, ippatsu, pocchi, yakuman: Math.max(0, yakuman), total };
}

/** 役満チップ：支払う人1人あたりの枚数（ツモ＝各5×倍数、ロン＝10×倍数） */
export function yakumanChips(multiplier: number, winBy: "tsumo" | "ron"): number {
  if (multiplier <= 0) return 0;
  return multiplier * (winBy === "tsumo" ? YAKUMAN_CHIPS_TSUMO_EACH : YAKUMAN_CHIPS_RON);
}

/** 表示用の内訳（protocol の ChipDetail）。pot は時間超過の供託チップを取った枚数（C-08） */
export function toChipDetail(b: ChipBreakdown, pot = 0): ChipDetail {
  return {
    ura: b.ura,
    gold: b.gold,
    spring: b.spring,
    winter: b.winter,
    ippatsu: b.ippatsu,
    pocchi: b.pocchi,
    yakuman: b.yakuman,
    pot,
  };
}

export interface ChipSettleInput {
  chips: ChipCounts;
  winBy: "tsumo" | "ron";
  winnerId: string;
  discarderId?: string;
  players: [string, string, string];
  /** 役満の倍数（0 or 未指定＝役満でない）。数え役満・夏で役満・流し役満も1以上（C-07） */
  yakuman?: number;
}

/**
 * チップの移動を計算（C-03, C-07）。
 * 1人あたり＝通常の祝儀 total ＋ 役満分。
 * ツモ＝他家2人がそれぞれ支払う。ロン＝放銃者が支払う。
 * 返り値は プレイヤーID→チップ増減（合計0）。
 */
export function settleChips(input: ChipSettleInput): Record<string, number> {
  const { chips, winBy, winnerId, discarderId, players } = input;
  const { total } = chipBreakdown(chips);
  const each = total + yakumanChips(input.yakuman ?? 0, winBy);
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p] = 0;
  if (each === 0) return deltas;

  if (winBy === "ron") {
    if (!discarderId) throw new Error("ロンには放銃者が必要");
    deltas[discarderId] -= each;
    deltas[winnerId] += each;
  } else {
    for (const p of players) {
      if (p === winnerId) continue;
      deltas[p] -= each;
      deltas[winnerId] += each;
    }
  }
  return deltas;
}
