// 和了の統合。手牌＋文脈→役・翻・点数支払い・チップを一括で出す。要件 Phase 1。

import { analyzeWin, type WinAnalysis, type WinContext } from "./yaku";
import { settleWin, type SettleResult } from "./score";
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
  /** プレイヤーID→チップ増減 */
  chips: Record<string, number>;
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
      score: { rank: "1han", multiplier: 0, deltas: zero },
      chips: zero,
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
  const chips = settleChips({
    chips: analysis.chips,
    winBy: ctx.winBy,
    winnerId: meta.winnerId,
    discarderId: meta.discarderId,
    players: meta.players,
  });
  return { valid: true, analysis, score, chips };
}
