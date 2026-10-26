// ゲームのルール数値と点数表。要件 R-03, R-40〜R-45, R-21, C-01〜。
// 数値は全てここに集約する（画面やサーバーに直接書かない）。
// 点数は満点（35,000など）で扱う。対戦記録アプリ側は百点単位なので統合時に変換する。

export const GAME_RULES = {
  START: 35000, // 持ち点（R-03）
  RETURN: 40000, // 返し。西入・終局の判定に使う（R-03, P-03）
  LAST_WEST_HAND: 3, // 西場はこの局（西3）が終わったら40000点未満でも終局（P-11）
  HANDS_PER_SET: 13, // 配牌枚数（親は14枚目をツモって開始）
  DEAD_WALL: 14, // 王牌の枚数（R-42/P-09）
  // チップ（祝儀）C-01, C-02
  CHIP_YEN: 100, // 1チップ=100円
  CHIP_BUYIN: 20, // 2,000円＝20チップ
  // 供託・積み棒（R-44, R-45）
  RIICHI_STICK: 1000,
  HONBA: 1000, // 1本場=1,000点（ロンは放銃者、ツモは各他家+500）
  TENPAI_POT: 1000, // 流局時のテンパイ料（R-45）
  KAZOE_YAKUMAN_HAN: 14, // 数え役満は14翻から（R-41）
  // 持ち時間（P-06）
  TURN_SECONDS: 10,
  TURN_STOCK_SECONDS: 20,
} as const;

/** 点数のランク（符なし・R-41）。数値は翻、それ以外は満貫以上 */
export type ScoreRank = "1han" | "2han" | "3han" | "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman";

/** 夏のランクアップ（R-21）で使う並び。1〜3翻は満貫へ飛ぶ */
const RANK_LADDER: ScoreRank[] = ["mangan", "haneman", "baiman", "sanbaiman", "yakuman"];

/**
 * 翻数→ランク（R-41）。役満役は別途 yakuman を直接渡す。
 * 満貫=4〜5、跳満=6〜7、倍満=8〜10、三倍満=11〜13、数え役満=14〜
 */
export function rankFromHan(han: number): ScoreRank {
  if (han <= 0) throw new Error("翻が0以下");
  if (han === 1) return "1han";
  if (han === 2) return "2han";
  if (han === 3) return "3han";
  if (han <= 5) return "mangan";
  if (han <= 7) return "haneman";
  if (han <= 10) return "baiman";
  if (han <= 13) return "sanbaiman";
  return "yakuman"; // 14翻以上は数え役満
}

/** 夏のランクアップ（R-21）。役満には適用しない（呼び出し側で制御） */
export function bumpRank(rank: ScoreRank): ScoreRank {
  if (rank === "1han" || rank === "2han" || rank === "3han") return "mangan";
  const i = RANK_LADDER.indexOf(rank);
  if (i < 0) return rank;
  return RANK_LADDER[Math.min(i + 1, RANK_LADDER.length - 1)];
}

// ---- 点数表（R-42。添付「MAHJONG ZOO 3人打ち点数表」） ----
// ロンの合計と、ツモの支払い内訳を満点で持つ。
// 親ツモ：他家2人がそれぞれ tsumoEach を払う。
// 子ツモ：もう1人の子が fromChild、親が fromDealer を払う。

export interface DealerPay {
  ron: number;
  tsumoEach: number; // 他家それぞれが払う
}
export interface ChildPay {
  ron: number;
  tsumoFromChild: number; // もう1人の子が払う
  tsumoFromDealer: number; // 親が払う
}

const DEALER_TABLE: Record<ScoreRank, DealerPay> = {
  "1han": { ron: 2000, tsumoEach: 1000 },
  "2han": { ron: 3000, tsumoEach: 2000 },
  "3han": { ron: 6000, tsumoEach: 3000 },
  mangan: { ron: 12000, tsumoEach: 6000 },
  haneman: { ron: 18000, tsumoEach: 9000 },
  baiman: { ron: 24000, tsumoEach: 12000 },
  sanbaiman: { ron: 36000, tsumoEach: 18000 },
  yakuman: { ron: 48000, tsumoEach: 24000 },
};

const CHILD_TABLE: Record<ScoreRank, ChildPay> = {
  "1han": { ron: 1000, tsumoFromChild: 1000, tsumoFromDealer: 1000 },
  "2han": { ron: 2000, tsumoFromChild: 1000, tsumoFromDealer: 1000 },
  "3han": { ron: 4000, tsumoFromChild: 1000, tsumoFromDealer: 3000 },
  mangan: { ron: 8000, tsumoFromChild: 3000, tsumoFromDealer: 5000 },
  haneman: { ron: 12000, tsumoFromChild: 4000, tsumoFromDealer: 8000 },
  baiman: { ron: 16000, tsumoFromChild: 6000, tsumoFromDealer: 10000 },
  sanbaiman: { ron: 24000, tsumoFromChild: 8000, tsumoFromDealer: 16000 },
  yakuman: { ron: 32000, tsumoFromChild: 12000, tsumoFromDealer: 20000 },
};

export function dealerPay(rank: ScoreRank): DealerPay {
  return DEALER_TABLE[rank];
}
export function childPay(rank: ScoreRank): ChildPay {
  return CHILD_TABLE[rank];
}
