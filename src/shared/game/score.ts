// 点数の確定と支払い。要件 R-40〜R-45, R-21, S-07〜S-09。
// 符なし。翻／役満 → ランク → 固定点数表（rules.ts）で金額を出し、本場・供託を足す。

import {
  rankFromHan,
  bumpRank,
  dealerPay,
  childPay,
  GAME_RULES,
  type ScoreRank,
} from "./rules";
import type { WinAnalysis } from "./yaku";

export interface SettleInput {
  analysis: WinAnalysis;
  winBy: "tsumo" | "ron";
  /** 本場数 */
  honba: number;
  /** 場に出ている供託リーチ棒の本数（和了者が総取り） */
  riichiSticks: number;
  /** 親（起家でなく、その局の親）のプレイヤーID */
  dealerId: string;
  /** 和了者のID */
  winnerId: string;
  /** ロンの放銃者ID（ツモのときは未指定） */
  discarderId?: string;
  /** 卓の3人のID */
  players: [string, string, string];
}

export interface SettleResult {
  rank: ScoreRank;
  /** 夏のランクアップ前のランク（R-21） */
  baseRank: ScoreRank;
  /** 夏で1ランク上がったか */
  summerUp: boolean;
  /** 役満の倍数（0なら通常役。rank==='yakuman' で倍数1以上） */
  multiplier: number;
  /** プレイヤーID→点数の増減（合計0） */
  deltas: Record<string, number>;
}

export interface RankInfo {
  rank: ScoreRank;
  multiplier: number;
  /** 夏のランクアップ前のランク */
  baseRank: ScoreRank;
  /** 夏で1ランク上がったか（R-21） */
  summerUp: boolean;
}

/** 分析結果からランクと倍数を決める（夏のランクアップ込み R-21） */
export function rankOf(analysis: WinAnalysis): RankInfo {
  if (analysis.yakuman > 0) {
    return { rank: "yakuman", multiplier: analysis.yakuman, baseRank: "yakuman", summerUp: false };
  }
  const baseRank = rankFromHan(analysis.han);
  // 役満には来ない（yakuman>0で上のreturn）。数え役満はそれ以上上がらない
  const rank = analysis.summer ? bumpRank(baseRank) : baseRank;
  const multiplier = 1; // 数え/夏での役満は等倍
  return { rank, multiplier, baseRank, summerUp: rank !== baseRank };
}

/** 役満チップ（C-07）に使う倍数。役満ランクなら最低1（数え・夏・流しも1）、それ以外は0 */
export function yakumanMultiplierOf(r: { rank: ScoreRank; multiplier: number }): number {
  return r.rank === "yakuman" ? Math.max(1, r.multiplier) : 0;
}

export function settleWin(input: SettleInput): SettleResult {
  const { analysis, winBy, honba, riichiSticks, dealerId, winnerId, discarderId, players } = input;
  const { rank, multiplier, baseRank, summerUp } = rankOf(analysis);
  const mult = Math.max(1, multiplier);
  const winnerIsDealer = winnerId === dealerId;
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p] = 0;

  const honbaRon = GAME_RULES.HONBA * honba; // ロン：放銃者が+1000/本場
  const honbaTsumoEach = (GAME_RULES.HONBA / 2) * honba; // ツモ：各他家+500/本場

  if (winBy === "ron") {
    if (!discarderId) throw new Error("ロンには放銃者が必要");
    const base = winnerIsDealer ? dealerPay(rank).ron : childPay(rank).ron;
    const pay = base * mult + honbaRon;
    deltas[discarderId] -= pay;
    deltas[winnerId] += pay;
  } else {
    if (winnerIsDealer) {
      const each = dealerPay(rank).tsumoEach * mult + honbaTsumoEach;
      for (const p of players) {
        if (p === winnerId) continue;
        deltas[p] -= each;
        deltas[winnerId] += each;
      }
    } else {
      const fromDealer = childPay(rank).tsumoFromDealer * mult + honbaTsumoEach;
      const fromChild = childPay(rank).tsumoFromChild * mult + honbaTsumoEach;
      for (const p of players) {
        if (p === winnerId) continue;
        const pay = p === dealerId ? fromDealer : fromChild;
        deltas[p] -= pay;
        deltas[winnerId] += pay;
      }
    }
  }

  // 供託リーチ棒は和了者が総取り（R-44）
  deltas[winnerId] += riichiSticks * GAME_RULES.RIICHI_STICK;

  return { rank, baseRank, summerUp, multiplier: mult === 1 && analysis.yakuman === 0 ? 0 : mult, deltas };
}

// ---- 流局（R-45） ----

export interface DrawInput {
  /** テンパイしているプレイヤーIDの集合 */
  tenpai: string[];
  players: [string, string, string];
}

/** 流局時のテンパイ料（合計1000点を聴牌と不聴でやりとり R-45） */
export function settleDraw(input: DrawInput): Record<string, number> {
  const { tenpai, players } = input;
  const deltas: Record<string, number> = {};
  for (const p of players) deltas[p] = 0;
  const t = tenpai.length;
  const n = players.length - t; // 不聴の人数
  if (t === 0 || t === players.length) return deltas; // 全員聴牌/全員不聴は授受なし
  const pot = GAME_RULES.TENPAI_POT; // 1000
  const recv = pot / t; // 聴牌者が受け取る
  const pay = pot / n; // 不聴者が払う
  for (const p of players) {
    if (tenpai.includes(p)) deltas[p] += recv;
    else deltas[p] -= pay;
  }
  return deltas;
}
