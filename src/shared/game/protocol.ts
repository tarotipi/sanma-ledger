// 進行エンジン・サーバー・画面が共通で使う型（約束事）。
// ここを変えると3者に影響するので、変更は慎重に。
// エンジン（engine.ts）はこの型だけを外に出し、サーバーと画面はこの型だけに依存する。

import type { Face, Flower, Tile } from "./tiles";
import type { Meld } from "./hand";
import type { YakuLine } from "./yaku";
import type { ScoreRank } from "./rules";

export type SeatIndex = 0 | 1 | 2;

/** 卓の段階 */
export type TablePhase = "waiting" | "playing" | "hand_end" | "game_end";

/** プレイヤーの操作（クライアント→サーバー） */
export type GameAction =
  /** 打牌。index は自分の手牌配列（drawn を含めない）の位置、drawn=true ならツモ牌を切る。riichi=true でリーチ宣言打牌 */
  | { type: "discard"; index?: number; drawn?: boolean; riichi?: boolean }
  /** ツモ和了 */
  | { type: "tsumo" }
  /** ロン和了（他家の打牌に対して） */
  | { type: "ron" }
  /** ポン（他家の打牌に対して） */
  | { type: "pon" }
  /** カン。自分の番なら暗槓/加槓（face指定）、他家打牌なら大明槓 */
  | { type: "kan"; face?: Face }
  /** 鳴き・ロンを見送る */
  | { type: "pass" }
  /** 局の結果を見た後、次局へ（3人全員が押したら進む） */
  | { type: "next_hand" };

/** そのプレイヤーが今できる操作 */
export interface AllowedActions {
  discard: boolean;
  riichi: boolean; // リーチ宣言できる（門前・テンパイ・1000点以上・残りツモあり）
  /** リーチ宣言打牌として切れる牌（手牌index、drawnは -1） */
  riichiDiscards: number[];
  tsumo: boolean;
  ron: boolean;
  pon: boolean;
  /** カンできる面（暗槓・加槓・大明槓） */
  kan: Face[];
  pass: boolean;
  nextHand: boolean;
}

/** 公開情報（全員に見える） */
export interface PlayerPublic {
  id: string;
  name: string;
  seat: SeatIndex;
  score: number;
  /** チップ残数（C-01。初期20） */
  chips: number;
  /** バイインした回数（初回含む。C-02） */
  buyins: number;
  connected: boolean;
  riichi: boolean;
  /** リーチ宣言牌の捨て牌index（横向き表示用） */
  riichiDiscardIndex: number | null;
  discards: Tile[];
  /** 鳴かれた捨て牌の index（表示で薄くする用） */
  calledDiscards: number[];
  melds: Meld[];
  /** 副露の物理牌（赤金の表示用） */
  meldTiles: Tile[][];
  flowers: Flower[];
  handCount: number;
  /** 局結果画面で「次へ」を押したか */
  ready: boolean;
}

export interface HandResultWin {
  kind: "win";
  winnerId: string;
  discarderId: string | null; // ツモなら null
  winBy: "tsumo" | "ron";
  hand: Tile[];
  melds: Meld[];
  winTile: Face;
  yaku: YakuLine[];
  han: number;
  rank: ScoreRank;
  multiplier: number;
  yakumanNames: string[];
  /** 点数移動（本場・供託込み） */
  deltas: Record<string, number>;
  /** チップ移動 */
  chipDeltas: Record<string, number>;
  doraIndicators: Face[];
  uraIndicators: Face[];
  /** 冬でめくれた牌（表示用） */
  winterRevealed: Face[];
  /** 白ポッチの万能和了なら true */
  pocchiWin: boolean;
}

export interface HandResultDraw {
  kind: "draw";
  /** 流し役満の成立者（いれば） */
  nagashiIds: string[];
  tenpaiIds: string[];
  deltas: Record<string, number>;
  chipDeltas: Record<string, number>;
  /** 聴牌者の手牌公開 */
  revealed: Record<string, Tile[]>;
}

export type HandResult = HandResultWin | HandResultDraw;

export interface RoundInfo {
  /** 場風 1z東 2z南 3z西 */
  wind: Face;
  /** 局番号 1〜3（東1局＝1） */
  number: number;
  honba: number;
  riichiSticks: number;
  dealerSeat: SeatIndex;
}

/** 終局時の最終結果（対戦記録への登録に使う） */
export interface FinalResult {
  /** プレイヤーID→最終持ち点（満点） */
  scores: Record<string, number>;
  /** プレイヤーID→チップの増減（開始時20枚＋バイイン分からの差。ゼロサム） */
  chipNet: Record<string, number>;
  /** プレイヤーID→バイイン回数 */
  buyins: Record<string, number>;
  /** 役満の記録（殿堂用） */
  yakuman: { playerId: string; names: string[] }[];
}

/** 各プレイヤーに送る画面用の状態（自分の手牌だけ含む） */
export interface PlayerView {
  phase: TablePhase;
  round: RoundInfo | null;
  wallRemaining: number;
  doraIndicators: Face[];
  players: PlayerPublic[];
  /** 今の手番の席 */
  turnSeat: SeatIndex | null;
  /** 直前の打牌（鳴き・ロンの対象） */
  lastDiscard: { seat: SeatIndex; tile: Tile } | null;
  you: {
    id: string;
    seat: SeatIndex;
    hand: Tile[];
    /** ツモってきた牌（手牌の右に離して表示） */
    drawn: Tile | null;
    /** テンパイ時の待ち（D-05） */
    waits: Face[];
    options: AllowedActions;
    /** 手番の残り秒（P-06） */
    deadline: number | null;
  } | null;
  result: HandResult | null;
  final: FinalResult | null;
  /** 直近の出来事（デバッグ・表示用、新しい順に最大30件） */
  log: string[];
  /** デバッグ表示時のみ：全員の手牌 */
  debugHands?: Record<string, Tile[]>;
}

/** エンジンの生成オプション */
export interface CreateOptions {
  /** 牌山のシード（同じシードなら同じ山。DBG-02） */
  seed: number;
  /** 起家の席。未指定ならシードから決める（P-01） */
  dealerSeat?: SeatIndex;
  /** デバッグ用：山の並びを直接指定（先頭からツモ順。DBG-02/03） */
  presetWall?: Tile[];
  /** 現在時刻（ms）。持ち時間の計算に使う。テストでは固定値を渡す */
  now?: number;
}
