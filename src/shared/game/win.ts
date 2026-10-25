// 和了の統合。手牌＋文脈→役・翻・点数支払い・チップを一括で出す。要件 Phase 1。

import { analyzeWin, type WinAnalysis, type WinContext } from "./yaku";
import { settleWin, yakumanMultiplierOf, type SettleResult } from "./score";
import { settleChips } from "./chips";

export interface WinMeta {
  honba: number;
  riichiSticks: number;
  dealerId: string;
  winnerId: string;
  discarderId?: string;
  players: [string, string, string];
}

export interface WinResolution {
  valid: boolean;
  analysis: WinAnalysis;
  score: SettleResult;
  /** プレイヤーID→チップ増減（役満チップ C-07 込み） */
  chips: Record<string, number>;
  /** 役満チップの倍数（0=役満でない。数え役満・夏で役満も1） */
  yakumanChipMult: number;
}

/** 和了を解決して点数とチップの移動まで返す */
export function resolveWin(ctx: WinContext, meta: WinMeta): WinResolution {
  const analysis = analyzeWin(ctx);
  if (!analysis.valid) {
    const zero: Record<string, number> = {};
    for (const p of meta.players) zero[p] = 0;
    return {
      valid: false,
      analysis,
      score: { rank: "1han", baseRank: "1han", summerUp: false, multiplier: 0, deltas: zero },
      chips: zero,
      yakumanChipMult: 0,
    };
  }
  const score = settleWin({
    analysis,
    winBy: ctx.winBy,
    honba: meta.honba,
    riichiSticks: meta.riichiSticks,
    dealerId: meta.dealerId,
    winnerId: meta.winnerId,
    discarderId: meta.discarderId,
    players: meta.players,
  });
  const yakumanChipMult = yakumanMultiplierOf(score);
  const chips = settleChips({
    chips: analysis.chips,
    yakuman: yakumanChipMult,
    winBy: ctx.winBy,
    winnerId: meta.winnerId,
    discarderId: meta.discarderId,
    players: meta.players,
  });
  return { valid: true, analysis, score, chips, yakumanChipMult };
}
