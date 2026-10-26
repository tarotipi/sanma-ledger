// 1局〜半荘の進行エンジン（Phase 2）。要件 §2, P-01〜P-09, C-01〜C-02, R-30〜R-37。
// - 状態（GameState）はプレーンなJSON。Durable Object にそのまま保存できる
// - 1手ずつ applyAction で進む。不正な操作は状態を変えず error に理由を返す
// - 点数・役・チップは Phase1 の関数（resolveWin / settleDraw / settleChips）だけで計算する
//
// 山の並び（presetWall で指定するときもこの順）：
//   先頭から 親13枚 → 南家13枚 → 西家13枚 → 親の第1ツモ → 以降のツモ順。
//   末尾14枚が王牌：[ドラ表示5枚][裏ドラ表示5枚][嶺上4枚]。
//   嶺上から1枚引くたびに、生牌（ツモ山）の末尾1枚を嶺上へ回して王牌を14枚に保つ（P-09）。
//
// v0.6（§10）：
//   - 花は自動で抜かない。手番の人が {type:"nuki"} で1枚ずつ抜き、嶺上から補充（R-24）
//   - 花は和了・待ち・シャンテンの計算では手牌から除く。花を持ったままではテンパイ扱いにならない
//   - 持ち時間を使い切ってから60秒で自動処理。そのとき1チップを卓の供託チップへ（C-08）

import type {
  AllowedActions,
  CreateOptions,
  FinalResult,
  GameAction,
  HandResult,
  HandResultDraw,
  HandResultWin,
  PlayerPublic,
  PlayerView,
  RoundInfo,
  SeatIndex,
  TablePhase,
} from "./protocol";
import { ALL_FACES, buildWall, faceName, isTerminalOrHonor, parseTile, type Face, type Flower, type Tile } from "./tiles";
import { waits as calcWaits, shanten as calcShanten, type Meld } from "./hand";
import type { WinAnalysis, WinContext } from "./yaku";
import { resolveWin, type WinResolution } from "./win";
import { rankOf, settleDraw, settleWin, yakumanMultiplierOf } from "./score";
import { chipBreakdown, settleChips, toChipDetail } from "./chips";
import { GAME_RULES, type ScoreRank } from "./rules";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 花牌の内部表現（Tile.face）→ 花の種類 */
const FLOWER_OF: Record<string, Flower> = { f1: "spring", f2: "summer", f3: "autumn", f4: "winter" };
const FLOWER_LABEL: Record<Flower, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
const BASE_MS = GAME_RULES.TURN_SECONDS * 1000; // 1手の基本時間
const STOCK_MS = GAME_RULES.TURN_STOCK_SECONDS * 1000; // 1局ごとのストック
/** 持ち時間を使い切ってから自動処理までの猶予（C-08：−60秒で自動ツモ切り/パス） */
const OVERTIME_MS = 60 * 1000;
/** 時間超過の自動処理1回で卓の供託に出すチップ枚数（C-08） */
const TIMEOUT_CHIP_PENALTY = 1;
const DORA_SLOTS = 5; // ドラ表示の最大枚数（初期1＋カン4）
const RINSHAN_SLOTS = 4;
const RANK_ORDER: ScoreRank[] = ["1han", "2han", "3han", "mangan", "haneman", "baiman", "sanbaiman", "yakuman"];
const FACE_INDEX = new Map<Face, number>(ALL_FACES.map((f, i) => [f, i]));
const LOG_KEEP = 100;

// ---------------------------------------------------------------------------
// 状態の型（すべてプレーンJSON）
// ---------------------------------------------------------------------------

export interface PlayerState {
  id: string;
  name: string;
  seat: SeatIndex;
  score: number;
  chips: number;
  buyins: number;
  connected: boolean;
  /** 手牌（ツモ牌を除く。常に並べ替え済み） */
  hand: Tile[];
  /** ツモってきた牌（打牌待ちのときだけ） */
  drawn: Tile | null;
  discards: Tile[];
  /** 鳴かれた捨て牌のindex */
  calledDiscards: number[];
  melds: Meld[];
  meldTiles: Tile[][];
  flowers: Flower[];
  riichi: boolean;
  doubleRiichi: boolean;
  riichiDiscardIndex: number | null;
  /** オープンリーチ中（R-47：手牌を全員に公開） */
  openRiichi: boolean;
  /** 一発の権利（リーチ宣言〜自分の次の打牌まで、鳴きで消える） */
  ippatsu: boolean;
  /** 見逃しによる同巡フリテン（自分の次のツモで解除） */
  furitenTemp: boolean;
  /** リーチ後の見逃しによる永久フリテン */
  furitenRiichi: boolean;
  /** まだ最初の打牌をしていない（天和・地和・ダブル立直の判定） */
  firstTurn: boolean;
  /** 持ち時間のストック残り（ms） */
  stock: number;
  /** 局結果で「次へ」を押した */
  ready: boolean;
  /** ポン直後に切れない面（喰い替え禁止 M-01） */
  kuikaeFace: Face | null;
}

export interface ClaimEntry {
  seat: SeatIndex;
  canRon: boolean;
  canPon: boolean;
  canKan: boolean;
  response: "ron" | "pon" | "kan" | "pass" | null;
}

export interface PendingClaim {
  /** discard=打牌に対して / chankan=加槓に対して（ロンのみ） */
  kind: "discard" | "chankan";
  fromSeat: SeatIndex;
  tile: Tile;
  entries: ClaimEntry[];
  /** リーチ宣言牌（ロンされなければリーチ成立して供託を出す） */
  pendingRiichi: boolean;
}

/** discard=手番の打牌待ち / claim=鳴き・ロンの返答待ち / result=局結果表示 / end=終局 */
export type Stage = "discard" | "claim" | "result" | "end";

export interface GameState {
  version: 1;
  stage: Stage;
  /** 乱数の内部状態（mulberry32） */
  rng: number;
  seed: number;
  /** 起家の席（同点時の順位 P-07） */
  startDealer: SeatIndex;
  players: PlayerState[];
  round: RoundInfo;
  /** 局結果のあとに始まる次の局（終局なら null） */
  nextRound: RoundInfo | null;
  /** 生牌（ツモ山）。先頭から引く */
  live: Tile[];
  doraTiles: Tile[];
  uraTiles: Tile[];
  rinshan: Tile[];
  /** めくれているドラ表示の枚数 */
  doraCount: number;
  /** 打牌後にめくるカンドラの枚数（明槓・加槓） */
  pendingDora: number;
  kanCount: number;
  turnSeat: SeatIndex;
  lastDiscard: { seat: SeatIndex; tile: Tile } | null;
  claim: PendingClaim | null;
  /** 直前のツモが嶺上（カンの補充）か＝嶺上開花の判定 */
  rinshanDraw: boolean;
  /** この局で鳴き（カン含む）があったか */
  callsMade: boolean;
  /** 今の判断（打牌・鳴き）が始まった時刻 */
  decisionStart: number;
  /** 最後に操作を受けた時刻 */
  clock: number;
  result: HandResult | null;
  final: FinalResult | null;
  yakumanLog: { playerId: string; names: string[] }[];
  /** 新しい順 */
  log: string[];
  /** デバッグ：次以降の局で使う山の並び（DBG-02） */
  presetQueue: Tile[][];
}

// ---------------------------------------------------------------------------
// 小さな道具
// ---------------------------------------------------------------------------

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function seatAt(n: number): SeatIndex {
  return (((n % 3) + 3) % 3) as SeatIndex;
}

function isFlower(t: Tile): boolean {
  return t.face.startsWith("f");
}

/** 花を除いた手牌（和了・待ち・シャンテンの計算用。R-24） */
function nonFlower(tiles: Tile[]): Tile[] {
  return tiles.filter((t) => !isFlower(t));
}

/** 手牌かツモ牌に花があるか */
function hasFlower(p: PlayerState): boolean {
  return p.hand.some(isFlower) || (!!p.drawn && isFlower(p.drawn));
}

/** mulberry32。状態は s.rng に保存して再現可能にする */
function rand(s: GameState): number {
  const t = (s.rng + 0x6d2b79f5) >>> 0;
  s.rng = t;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function shuffle(s: GameState, arr: Tile[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function sameKind(a: Tile, b: Tile): boolean {
  return a.face === b.face && !!a.red === !!b.red && !!a.gold === !!b.gold && !!a.pocchi === !!b.pocchi;
}

function tileKey(t: Tile): number {
  return (FACE_INDEX.get(t.face) ?? 99) * 10 + (t.red ? 1 : 0) + (t.gold ? 2 : 0) + (t.pocchi ? 3 : 0);
}

function sortTiles(arr: Tile[]): void {
  arr.sort((a, b) => tileKey(a) - tileKey(b));
}

/** 表示用の牌名（ログ） */
export function tileLabel(t: Tile): string {
  if (isFlower(t)) return FLOWER_LABEL[FLOWER_OF[t.face]];
  return faceName(t.face) + (t.red ? "(赤)" : "") + (t.gold ? "(金)" : "") + (t.pocchi ? "(ポッチ)" : "");
}

function addLog(s: GameState, msg: string): void {
  s.log.unshift(msg);
  if (s.log.length > LOG_KEEP) s.log.length = LOG_KEEP;
}

function idsOf(s: GameState): [string, string, string] {
  return [s.players[0].id, s.players[1].id, s.players[2].id];
}

function windLabel(w: Face): string {
  return w === "1z" ? "東" : w === "2z" ? "南" : "西";
}

function roundLabel(r: RoundInfo): string {
  return `${windLabel(r.wind)}${r.number}局 ${r.honba}本場`;
}

/** 自風：親=東(1z)、その次=南(2z)、その次=西(3z) */
function seatWindOf(s: GameState, seat: SeatIndex): Face {
  return `${seatAt(seat - s.round.dealerSeat) + 1}z`;
}

function doraFaces(s: GameState): Face[] {
  return s.doraTiles.slice(0, s.doraCount).map((t) => t.face);
}

function uraFaces(s: GameState): Face[] {
  return s.uraTiles.slice(0, s.doraCount).map((t) => t.face);
}

function facesOf(tiles: Tile[]): Face[] {
  return tiles.map((t) => t.face);
}

function isMenzen(p: PlayerState): boolean {
  return p.melds.every((m) => m.kind === "ankan");
}

/** 手牌（ツモ牌を除く）が13枚相当（3n+1枚）のときの待ち。花は除いて数える */
function waitsOf(p: PlayerState): Face[] {
  const faces = facesOf(nonFlower(p.hand));
  if (faces.length % 3 !== 1) return [];
  return calcWaits(faces, p.melds);
}

/**
 * 14枚相当を持っているとき、切るとテンパイになる牌とその待ち（D-07）。
 * index は手牌の位置、ツモ牌は -1。花は切れないので対象外。花が残っていれば枚数が合わず空になる。
 */
function tenpaiDiscards(p: PlayerState): { index: number; waits: Face[] }[] {
  const all = p.drawn ? [...p.hand, p.drawn] : [...p.hand];
  if (nonFlower(all).length % 3 !== 2) return [];
  const out: { index: number; waits: Face[] }[] = [];
  const cache = new Map<string, Face[]>(); // 同じ面を切ったときの結果は同じ
  const tryDiscard = (index: number, tile: Tile) => {
    if (isFlower(tile)) return;
    if (!cache.has(tile.face)) {
      const rest = [...all];
      rest.splice(index === -1 ? all.length - 1 : index, 1);
      cache.set(tile.face, calcWaits(facesOf(nonFlower(rest)), p.melds));
    }
    const w = cache.get(tile.face)!;
    if (w.length) out.push({ index, waits: [...w] });
  };
  p.hand.forEach((t, i) => tryDiscard(i, t));
  if (p.drawn) tryDiscard(-1, p.drawn);
  return out;
}

/** シャンテン数（花を除く。手牌＋ツモ牌） */
function shantenOf(p: PlayerState): number {
  const all = p.drawn ? [...p.hand, p.drawn] : p.hand;
  return calcShanten(facesOf(nonFlower(all)), p.melds);
}

// ---------------------------------------------------------------------------
// デバッグ用の補助（DBG-02）
// ---------------------------------------------------------------------------

/** 山を文字列で書く。"1p r5p w5z f1" のように。f1〜f4 は春夏秋冬 */
export function parseWallTiles(str: string): Tile[] {
  return str
    .split(/\s+/)
    .filter((x) => x.length)
    .map((tok) => (/^f[1-4]$/.test(tok) ? { face: tok } : parseTile(tok)));
}

/** 次の局から使う山の並びを予約する（デバッグ卓・テスト用） */
export function queuePresetWall(state: GameState, wall: Tile[]): GameState {
  const s = clone(state);
  s.presetQueue.push(wall.map((t) => ({ ...t })));
  return s;
}

// ---------------------------------------------------------------------------
// 山
// ---------------------------------------------------------------------------

/** 112枚（108＋花4）をそろえる */
function fullSet(): Tile[] {
  const { tiles } = buildWall();
  const all: Tile[] = tiles.map((t) => ({ ...t }));
  for (const face of Object.keys(FLOWER_OF)) all.push({ face });
  return all;
}

/** 山を作る。preset があれば先頭に置き、残りは使っていない牌をシャッフルして続ける */
function composeWall(s: GameState, preset?: Tile[]): Tile[] {
  const pool = fullSet();
  shuffle(s, pool);
  let wall: Tile[] = pool;
  if (preset && preset.length) {
    const rest = [...pool];
    for (const p of preset) {
      const i = rest.findIndex((t) => sameKind(t, p));
      if (i >= 0) rest.splice(i, 1);
    }
    wall = [...preset.map((t) => ({ ...t })), ...rest];
  }
  return wall.map((t, i) => {
    const copy: Tile = { face: t.face };
    if (t.red) copy.red = true;
    if (t.gold) copy.gold = true;
    if (t.pocchi) copy.pocchi = true;
    copy.id = i;
    return copy;
  });
}

/** ドラ表示・裏ドラ表示の位置に花があれば、生牌の末尾の普通の牌と入れ替える（花はドラ表示にしない） */
function keepFlowersOutOfIndicators(s: GameState): void {
  for (const arr of [s.doraTiles, s.uraTiles]) {
    for (let i = 0; i < arr.length; i++) {
      if (!isFlower(arr[i])) continue;
      for (let j = s.live.length - 1; j >= 0; j--) {
        if (!isFlower(s.live[j])) {
          [arr[i], s.live[j]] = [s.live[j], arr[i]];
          break;
        }
      }
    }
  }
}

/** 嶺上から1枚引き、生牌の末尾1枚を嶺上へ回す（王牌14枚を維持） */
function drawRinshan(s: GameState): Tile | null {
  const t = s.rinshan.shift() ?? null;
  if (s.live.length > 0) s.rinshan.push(s.live.pop()!);
  return t;
}

/** 花を抜けるか（嶺上が残っていて、手牌かツモ牌に花がある） */
function canNuki(s: GameState, seat: SeatIndex): boolean {
  return s.stage === "discard" && s.turnSeat === seat && s.rinshan.length > 0 && hasFlower(s.players[seat]);
}

/**
 * 花を1枚抜いて公開し、嶺上から1枚補充する（R-24）。
 * ツモ牌が花ならそれを、なければ手牌の最初の花を抜く。
 * 補充牌は新しいツモ牌になる（元のツモ牌は手牌へ入れる）。嶺上開花の判定（rinshanDraw）は変えない。
 */
function nukiOne(s: GameState, seat: SeatIndex): void {
  const p = s.players[seat];
  let flowerTile: Tile;
  if (p.drawn && isFlower(p.drawn)) {
    flowerTile = p.drawn;
    p.drawn = null;
  } else {
    const i = p.hand.findIndex(isFlower);
    flowerTile = p.hand.splice(i, 1)[0];
    if (p.drawn) {
      p.hand.push(p.drawn);
      p.drawn = null;
    }
    sortTiles(p.hand);
  }
  const f = FLOWER_OF[flowerTile.face];
  p.flowers.push(f);
  p.drawn = drawRinshan(s);
  addLog(s, `${p.name} ${FLOWER_LABEL[f]}を抜いた`);
}

/** 通常のツモ（生牌の先頭）。花でもそのまま持つ（抜くのは本人の操作 R-24） */
function drawNormal(s: GameState, seat: SeatIndex): void {
  const p = s.players[seat];
  p.drawn = s.live.shift() ?? null;
  p.furitenTemp = false; // 見逃しフリテンは自分のツモで解除
  s.rinshanDraw = false;
}

// ---------------------------------------------------------------------------
// 局の開始
// ---------------------------------------------------------------------------

function newPlayer(p: { id: string; name: string }, seat: number): PlayerState {
  return {
    id: p.id,
    name: p.name,
    seat: seatAt(seat),
    score: GAME_RULES.START,
    chips: GAME_RULES.CHIP_BUYIN,
    buyins: 1,
    connected: true,
    hand: [],
    drawn: null,
    discards: [],
    calledDiscards: [],
    melds: [],
    meldTiles: [],
    flowers: [],
    riichi: false,
    doubleRiichi: false,
    riichiDiscardIndex: null,
    openRiichi: false,
    ippatsu: false,
    furitenTemp: false,
    furitenRiichi: false,
    firstTurn: true,
    stock: STOCK_MS,
    ready: false,
    kuikaeFace: null,
  };
}

function resetPlayerForHand(p: PlayerState): void {
  p.hand = [];
  p.drawn = null;
  p.discards = [];
  p.calledDiscards = [];
  p.melds = [];
  p.meldTiles = [];
  p.flowers = [];
  p.riichi = false;
  p.doubleRiichi = false;
  p.riichiDiscardIndex = null;
  p.openRiichi = false;
  p.ippatsu = false;
  p.furitenTemp = false;
  p.furitenRiichi = false;
  p.firstTurn = true;
  p.stock = STOCK_MS;
  p.ready = false;
  p.kuikaeFace = null;
}

/** 山を作って配牌し、親の第1ツモまで済ませる */
function startHand(s: GameState, now: number): void {
  const wall = composeWall(s, s.presetQueue.shift());
  s.live = wall.slice(0, wall.length - GAME_RULES.DEAD_WALL);
  const dead = wall.slice(wall.length - GAME_RULES.DEAD_WALL);
  s.doraTiles = dead.slice(0, DORA_SLOTS);
  s.uraTiles = dead.slice(DORA_SLOTS, DORA_SLOTS * 2);
  s.rinshan = dead.slice(DORA_SLOTS * 2, DORA_SLOTS * 2 + RINSHAN_SLOTS);
  keepFlowersOutOfIndicators(s);
  s.doraCount = 1;
  s.pendingDora = 0;
  s.kanCount = 0;
  s.callsMade = false;
  s.rinshanDraw = false;
  s.claim = null;
  s.lastDiscard = null;
  s.result = null;
  s.nextRound = null;
  for (const p of s.players) resetPlayerForHand(p);

  const d = s.round.dealerSeat;
  // 配牌の花も手に残す。各自が自分の手番で抜く（R-24）
  for (let k = 0; k < 3; k++) {
    const p = s.players[seatAt(d + k)];
    p.hand = s.live.splice(0, GAME_RULES.HANDS_PER_SET);
    sortTiles(p.hand);
  }

  addLog(s, `${roundLabel(s.round)} 開始（親：${s.players[d].name}）`);
  s.turnSeat = d;
  s.stage = "discard";
  drawNormal(s, d);
  s.decisionStart = now;
  s.clock = now;
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

export function createGame(players: { id: string; name: string }[], opts: CreateOptions): GameState {
  if (players.length !== 3) throw new Error("プレイヤーはちょうど3人必要です");
  if (new Set(players.map((p) => p.id)).size !== 3) throw new Error("プレイヤーIDが重複しています");
  const now = opts.now ?? Date.now();
  const s: GameState = {
    version: 1,
    stage: "discard",
    rng: opts.seed >>> 0,
    seed: opts.seed,
    startDealer: 0,
    players: players.map((p, i) => newPlayer(p, i)),
    round: { wind: "1z", number: 1, honba: 0, riichiSticks: 0, dealerSeat: 0, chipPot: 0 },
    nextRound: null,
    live: [],
    doraTiles: [],
    uraTiles: [],
    rinshan: [],
    doraCount: 1,
    pendingDora: 0,
    kanCount: 0,
    turnSeat: 0,
    lastDiscard: null,
    claim: null,
    rinshanDraw: false,
    callsMade: false,
    decisionStart: now,
    clock: now,
    result: null,
    final: null,
    yakumanLog: [],
    log: [],
    presetQueue: opts.presetWall ? [opts.presetWall.map((t) => ({ ...t }))] : [],
  };
  const dealer = opts.dealerSeat ?? seatAt(Math.floor(rand(s) * 3));
  s.startDealer = dealer;
  s.round.dealerSeat = dealer;
  startHand(s, now);
  return s;
}

// ---------------------------------------------------------------------------
// 和了の判定（Phase1 の resolveWin を使う）
// ---------------------------------------------------------------------------

interface WinFlags {
  chankan?: boolean;
  pocchi?: boolean;
  /** オープンリーチ者へのリーチしていない人の放銃（R-48） */
  openRiichiDealIn?: boolean;
}

/**
 * R-48：和了者がオープンリーチ中で、放銃者がリーチしていないか。
 * 放銃者のリーチ宣言牌への放銃はリーチ不成立（供託も出ない）なので「リーチしていない」扱い。
 */
function isOpenRiichiDealIn(s: GameState, winnerSeat: SeatIndex, fromSeat: SeatIndex, pendingRiichi: boolean): boolean {
  const w = s.players[winnerSeat];
  const d = s.players[fromSeat];
  if (!(w.riichi && w.openRiichi)) return false;
  const discarderInRiichi = d.riichi && !pendingRiichi;
  return !discarderInRiichi;
}

function buildCtx(
  s: GameState,
  seat: SeatIndex,
  handTiles: Tile[],
  winFace: Face,
  winBy: "tsumo" | "ron",
  flags: WinFlags,
): WinContext {
  const p = s.players[seat];
  const first = p.firstTurn && !s.callsMade;
  return {
    hand: handTiles,
    melds: p.melds,
    meldTiles: p.meldTiles.flat(),
    winTile: winFace,
    winBy,
    seatWind: seatWindOf(s, seat),
    roundWind: s.round.wind,
    riichi: p.riichi,
    doubleRiichi: p.doubleRiichi,
    ippatsu: p.riichi && p.ippatsu,
    openRiichi: p.riichi && p.openRiichi,
    doraIndicators: doraFaces(s),
    uraIndicators: p.riichi ? uraFaces(s) : [],
    flowers: p.flowers,
    rinshan: winBy === "tsumo" && s.rinshanDraw,
    chankan: !!flags.chankan,
    haitei: winBy === "tsumo" && s.live.length === 0 && !s.rinshanDraw,
    houtei: winBy === "ron" && s.live.length === 0,
    tenhou: winBy === "tsumo" && first && seat === s.round.dealerSeat,
    chiihou: winBy === "tsumo" && first && seat !== s.round.dealerSeat,
    pocchiWin: !!flags.pocchi,
    openRiichiDealIn: winBy === "ron" && !!flags.openRiichiDealIn,
  };
}

function tryWin(
  s: GameState,
  seat: SeatIndex,
  handTiles: Tile[],
  winFace: Face,
  winBy: "tsumo" | "ron",
  discarderSeat: SeatIndex | null,
  flags: WinFlags,
): WinResolution {
  const ctx = buildCtx(s, seat, handTiles, winFace, winBy, flags);
  return resolveWin(ctx, {
    honba: s.round.honba,
    riichiSticks: s.round.riichiSticks,
    dealerId: s.players[s.round.dealerSeat].id,
    winnerId: s.players[seat].id,
    discarderId: discarderSeat === null ? undefined : s.players[discarderSeat].id,
    players: idsOf(s),
  });
}

/** a が b より高いか（倍数→ランク→翻→和了者の収支）R-34 */
function isBetter(a: WinResolution, b: WinResolution, winnerId: string): boolean {
  if (a.score.multiplier !== b.score.multiplier) return a.score.multiplier > b.score.multiplier;
  const ra = RANK_ORDER.indexOf(a.score.rank);
  const rb = RANK_ORDER.indexOf(b.score.rank);
  if (ra !== rb) return ra > rb;
  if (a.analysis.han !== b.analysis.han) return a.analysis.han > b.analysis.han;
  return (a.score.deltas[winnerId] ?? 0) > (b.score.deltas[winnerId] ?? 0);
}

interface TsumoEval {
  res: WinResolution;
  winFace: Face;
  /** 結果画面に出す手牌（白ポッチはそのまま） */
  displayTiles: Tile[];
  /** 計算に使った手牌（白ポッチは解釈後の牌） */
  evalTiles: Tile[];
  pocchi: boolean;
}

/** 今のツモで和了できるか。白ポッチ万能（R-31/R-34）も含めて最も高い解釈を返す */
function evalTsumo(s: GameState, seat: SeatIndex): TsumoEval | null {
  const p = s.players[seat];
  if (!p.drawn) return null;
  if (hasFlower(p)) return null; // 花を抜いた後の手で判定する（R-24）
  const candidates: TsumoEval[] = [];
  const normalTiles = [...p.hand, p.drawn];
  const normal = tryWin(s, seat, normalTiles, p.drawn.face, "tsumo", null, {});
  if (normal.valid) {
    candidates.push({ res: normal, winFace: p.drawn.face, displayTiles: normalTiles, evalTiles: normalTiles, pocchi: false });
  }
  // リーチ後に新しくツモった白ポッチは待ちのどれにでもなる（R-31）
  if (p.riichi && p.drawn.pocchi) {
    for (const f of waitsOf(p)) {
      const evalTiles = [...p.hand, { face: f }];
      const r = tryWin(s, seat, evalTiles, f, "tsumo", null, { pocchi: true });
      if (r.valid) candidates.push({ res: r, winFace: f, displayTiles: normalTiles, evalTiles, pocchi: true });
    }
  }
  let best: TsumoEval | null = null;
  for (const c of candidates) if (!best || isBetter(c.res, best.res, p.id)) best = c;
  return best;
}

/** フリテンか（自分の捨て牌に待ちがある／見逃し中／リーチ後見逃し）。リーチ宣言には関係しない（R-46） */
function isFuriten(p: PlayerState, w: Face[]): boolean {
  if (p.furitenTemp || p.furitenRiichi) return true;
  return p.discards.some((d) => w.includes(d.face));
}

function canRonOn(s: GameState, seat: SeatIndex, tile: Tile, kind: "discard" | "chankan", fromSeat: SeatIndex): boolean {
  if (tile.pocchi) return false; // 白ポッチではロンできない（R-32）
  const p = s.players[seat];
  const w = waitsOf(p);
  if (!w.includes(tile.face)) return false;
  if (isFuriten(p, w)) return false;
  return tryWin(s, seat, [...p.hand, tile], tile.face, "ron", fromSeat, { chankan: kind === "chankan" }).valid;
}

function countFace(tiles: Tile[], face: Face): number {
  return tiles.filter((t) => t.face === face).length;
}

function canPonOn(s: GameState, seat: SeatIndex, tile: Tile): boolean {
  const p = s.players[seat];
  if (p.riichi || s.live.length === 0) return false; // 河底牌は鳴けない
  return countFace(p.hand, tile.face) >= 2;
}

function canMinkanOn(s: GameState, seat: SeatIndex, tile: Tile): boolean {
  const p = s.players[seat];
  if (p.riichi || s.live.length === 0 || s.kanCount >= 4 || s.rinshan.length === 0) return false;
  return countFace(p.hand, tile.face) >= 3;
}

/** 自分の番にできるカン（暗槓・加槓）の面 */
function ownKanFaces(s: GameState, seat: SeatIndex): Face[] {
  const p = s.players[seat];
  if (!p.drawn || p.riichi || s.kanCount >= 4 || s.live.length === 0 || s.rinshan.length === 0) return [];
  const all = [...p.hand, p.drawn];
  const out: Face[] = [];
  for (const f of new Set(all.map((t) => t.face))) if (countFace(all, f) === 4) out.push(f); // 暗槓
  for (const m of p.melds) if (m.kind === "pon" && all.some((t) => t.face === m.face)) out.push(m.face); // 加槓
  return out;
}

/**
 * リーチ宣言として切れる牌（手牌index、ツモ牌は -1）。
 * フリテンでも宣言できる（R-46。ロンはできない）。花は切れないので候補にならない。
 */
function riichiCandidates(s: GameState, seat: SeatIndex): number[] {
  const p = s.players[seat];
  if (p.riichi || !p.drawn || !isMenzen(p)) return [];
  if (p.score < GAME_RULES.RIICHI_STICK || s.live.length < 3) return [];
  return tenpaiDiscards(p).map((x) => x.index);
}

// ---------------------------------------------------------------------------
// できる操作
// ---------------------------------------------------------------------------

function emptyOptions(): AllowedActions {
  return {
    discard: false,
    riichi: false,
    riichiDiscards: [],
    tsumo: false,
    ron: false,
    pon: false,
    kan: [],
    pass: false,
    nextHand: false,
    nuki: false,
  };
}

function computeOptions(s: GameState, seat: SeatIndex): AllowedActions {
  const o = emptyOptions();
  const p = s.players[seat];
  if (s.stage === "discard" && s.turnSeat === seat) {
    o.discard = true;
    o.tsumo = evalTsumo(s, seat) !== null;
    o.kan = ownKanFaces(s, seat);
    o.riichiDiscards = riichiCandidates(s, seat);
    o.riichi = o.riichiDiscards.length > 0;
    o.nuki = canNuki(s, seat);
  } else if (s.stage === "claim" && s.claim) {
    const e = s.claim.entries.find((x) => x.seat === seat);
    if (e && e.response === null) {
      o.ron = e.canRon;
      o.pon = e.canPon;
      o.kan = e.canKan ? [s.claim.tile.face] : [];
      o.pass = true;
    }
  } else if (s.stage === "result") {
    o.nextHand = !p.ready;
  }
  return o;
}

// ---------------------------------------------------------------------------
// 持ち時間（P-06）
// ---------------------------------------------------------------------------

/** 持ち時間（基本＋ストック）を使い切る時刻。ここから残り秒がマイナス表示になる（C-08） */
function overtimeFromOf(s: GameState, seat: SeatIndex): number {
  return s.decisionStart + BASE_MS + s.players[seat].stock;
}

/** 自動処理（ツモ切り・パス）の時刻＝持ち時間切れ＋60秒（C-08） */
function deadlineOf(s: GameState, seat: SeatIndex): number {
  return overtimeFromOf(s, seat) + OVERTIME_MS;
}

/** この人が今判断中か（打牌待ちの手番、または鳴き・ロンの返答待ち） */
function isDeciding(s: GameState, seat: SeatIndex): boolean {
  if (s.stage === "discard") return s.turnSeat === seat;
  if (s.stage === "claim" && s.claim) {
    const e = s.claim.entries.find((x) => x.seat === seat);
    return !!e && e.response === null;
  }
  return false;
}

/** 使った分だけストックを減らす（基本時間を超えた分） */
function consumeStock(s: GameState, seat: SeatIndex, now: number): void {
  const used = now - s.decisionStart - BASE_MS;
  if (used > 0) {
    const p = s.players[seat];
    p.stock = Math.max(0, p.stock - used);
  }
}

function personalDeadline(s: GameState, seat: SeatIndex): number | null {
  return isDeciding(s, seat) ? deadlineOf(s, seat) : null;
}

function personalOvertimeFrom(s: GameState, seat: SeatIndex): number | null {
  return isDeciding(s, seat) ? overtimeFromOf(s, seat) : null;
}

export function nextDeadline(s: GameState): number | null {
  if (s.stage === "discard") return deadlineOf(s, s.turnSeat);
  if (s.stage === "claim" && s.claim) {
    const pend = s.claim.entries.filter((e) => e.response === null);
    if (!pend.length) return null;
    return Math.min(...pend.map((e) => deadlineOf(s, e.seat)));
  }
  return null;
}

// ---------------------------------------------------------------------------
// 打牌・鳴き
// ---------------------------------------------------------------------------

function markCall(s: GameState): void {
  s.callsMade = true;
  for (const p of s.players) p.ippatsu = false; // 鳴きで一発は消える
}

function confirmRiichi(s: GameState, seat: SeatIndex): void {
  const p = s.players[seat];
  p.score -= GAME_RULES.RIICHI_STICK;
  s.round.riichiSticks += 1;
}

function doDiscard(s: GameState, seat: SeatIndex, a: Extract<GameAction, { type: "discard" }>, now: number): string | undefined {
  if (s.stage !== "discard") return "今は打牌できません";
  if (s.turnSeat !== seat) return "あなたの手番ではありません";
  const p = s.players[seat];
  const opts = computeOptions(s, seat);
  const useDrawn = !!a.drawn;
  if (useDrawn && !p.drawn) return "ツモ牌がありません";
  if (!useDrawn) {
    if (a.index === undefined || a.index < 0 || a.index >= p.hand.length) return "切る牌の位置が不正です";
    if (p.riichi) return "リーチ中はツモ切りしかできません";
    if (p.kuikaeFace && p.hand[a.index].face === p.kuikaeFace) return "喰い替えになるため、ポンした牌と同じ牌は切れません";
  }
  const target = useDrawn ? p.drawn! : p.hand[a.index!];
  if (isFlower(target)) return "花は切れません（「抜く」で抜いてください）";
  if (a.open && !a.riichi) return "オープンリーチはリーチ宣言と同時にしか選べません";
  if (a.riichi) {
    if (!opts.riichi) return "リーチできません（門前・テンパイ・1000点以上・残りツモ3枚以上が必要）";
    const idx = useDrawn ? -1 : a.index!;
    if (!opts.riichiDiscards.includes(idx)) return "その牌を切るとテンパイになりません";
  }
  consumeStock(s, seat, now);

  let tile: Tile;
  if (useDrawn) {
    tile = p.drawn!;
    p.drawn = null;
  } else {
    tile = p.hand.splice(a.index!, 1)[0];
    if (p.drawn) {
      p.hand.push(p.drawn);
      p.drawn = null;
    }
    sortTiles(p.hand);
  }
  p.discards.push(tile);
  p.kuikaeFace = null;

  let pendingRiichi = false;
  if (a.riichi) {
    p.riichi = true;
    p.doubleRiichi = p.firstTurn && !s.callsMade;
    p.riichiDiscardIndex = p.discards.length - 1;
    p.openRiichi = !!a.open; // オープンリーチ（R-47）
    p.ippatsu = true;
    pendingRiichi = true;
  } else if (p.riichi) {
    p.ippatsu = false; // リーチ後の次の打牌で一発は消える
  }
  p.firstTurn = false;
  if (s.pendingDora > 0) {
    s.doraCount = Math.min(DORA_SLOTS, s.doraCount + s.pendingDora); // 明槓・加槓のドラは打牌後
    s.pendingDora = 0;
  }
  s.lastDiscard = { seat, tile };
  s.rinshanDraw = false;
  const riichiLabel = a.riichi ? `${a.open ? "オープン" : ""}${p.doubleRiichi ? "ダブルリーチ " : "リーチ "}` : "";
  addLog(s, `${p.name} ${riichiLabel}打 ${tileLabel(tile)}`);
  openClaims(s, seat, tile, "discard", pendingRiichi, now);
  return undefined;
}

/** 打牌（または加槓）に対して鳴き・ロンできる人を集める。いなければそのまま進める */
function openClaims(s: GameState, fromSeat: SeatIndex, tile: Tile, kind: "discard" | "chankan", pendingRiichi: boolean, now: number): void {
  const entries: ClaimEntry[] = [];
  for (const k of [1, 2]) {
    const o = seatAt(fromSeat + k);
    const canRon = canRonOn(s, o, tile, kind, fromSeat);
    const canPon = kind === "discard" && canPonOn(s, o, tile);
    const canKan = kind === "discard" && canMinkanOn(s, o, tile);
    if (canRon || canPon || canKan) entries.push({ seat: o, canRon, canPon, canKan, response: null });
  }
  if (!entries.length) {
    finishWithoutClaim(s, fromSeat, tile, kind, pendingRiichi, now);
    return;
  }
  s.claim = { kind, fromSeat, tile, entries, pendingRiichi };
  s.stage = "claim";
  s.decisionStart = now;
}

function finishWithoutClaim(s: GameState, fromSeat: SeatIndex, tile: Tile, kind: "discard" | "chankan", pendingRiichi: boolean, now: number): void {
  s.claim = null;
  if (kind === "chankan") {
    completeKakan(s, fromSeat, tile, now);
    return;
  }
  if (pendingRiichi) confirmRiichi(s, fromSeat);
  nextTurn(s, fromSeat, now);
}

/** 次の人がツモる。山が尽きていれば流局 */
function nextTurn(s: GameState, fromSeat: SeatIndex, now: number): void {
  if (s.live.length === 0) {
    exhaustiveDraw(s);
    return;
  }
  const next = seatAt(fromSeat + 1);
  s.turnSeat = next;
  s.stage = "discard";
  drawNormal(s, next);
  s.decisionStart = now;
  if (!s.players[next].drawn) exhaustiveDraw(s);
}

function doClaimResponse(s: GameState, seat: SeatIndex, resp: "ron" | "pon" | "kan" | "pass", now: number): string | undefined {
  if (s.stage !== "claim" || !s.claim) {
    return resp === "pass" ? "今は見送る対象がありません" : "今は鳴き・ロンの判断中ではありません";
  }
  const e = s.claim.entries.find((x) => x.seat === seat);
  if (!e) return "この牌に対してあなたは鳴き・ロンできません";
  if (e.response !== null) return "すでに返答済みです";
  if (resp === "ron" && !e.canRon) return "ロンできません（役なし・フリテン・白ポッチなど）";
  if (resp === "pon" && !e.canPon) return "ポンできません";
  if (resp === "kan" && !e.canKan) return "カンできません";
  consumeStock(s, seat, now);
  e.response = resp;
  if (resp === "pass" && e.canRon) {
    const p = s.players[seat];
    if (p.riichi) p.furitenRiichi = true; // リーチ後の見逃しは永久フリテン
    else p.furitenTemp = true;
  }
  if (s.claim.entries.every((x) => x.response !== null)) resolveClaim(s, now);
  return undefined;
}

/** 全員の返答がそろったら処理。ロン（頭ハネ）＞ポン・カン＞流す */
function resolveClaim(s: GameState, now: number): void {
  const c = s.claim!;
  // 頭ハネ：放銃者の次の席から順に見て最初にロンした人だけ
  for (const k of [1, 2]) {
    const o = seatAt(c.fromSeat + k);
    const e = c.entries.find((x) => x.seat === o);
    if (e && e.response === "ron") {
      winByRon(s, o, c, now);
      return;
    }
  }
  const caller = c.entries.find((x) => x.response === "pon" || x.response === "kan");
  if (c.kind === "chankan") {
    finishWithoutClaim(s, c.fromSeat, c.tile, "chankan", false, now);
    return;
  }
  if (c.pendingRiichi) confirmRiichi(s, c.fromSeat);
  s.claim = null;
  if (caller?.response === "pon") executePon(s, caller.seat, c.fromSeat, c.tile, now);
  else if (caller?.response === "kan") executeMinkan(s, caller.seat, c.fromSeat, c.tile, now);
  else nextTurn(s, c.fromSeat, now);
}

/** 手牌から指定の面を n 枚取り出す */
function takeFromHand(p: PlayerState, face: Face, n: number): Tile[] {
  const taken: Tile[] = [];
  for (let i = p.hand.length - 1; i >= 0 && taken.length < n; i--) {
    if (p.hand[i].face === face) taken.push(p.hand.splice(i, 1)[0]);
  }
  return taken;
}

function executePon(s: GameState, seat: SeatIndex, fromSeat: SeatIndex, tile: Tile, now: number): void {
  const p = s.players[seat];
  const from = s.players[fromSeat];
  const taken = takeFromHand(p, tile.face, 2);
  p.melds.push({ kind: "pon", face: tile.face });
  p.meldTiles.push([...taken, tile]);
  from.calledDiscards.push(from.discards.length - 1);
  markCall(s);
  p.kuikaeFace = tile.face;
  p.drawn = null;
  s.lastDiscard = null;
  s.turnSeat = seat;
  s.stage = "discard";
  s.decisionStart = now;
  addLog(s, `${p.name} ポン ${tileLabel(tile)}`);
}

function executeMinkan(s: GameState, seat: SeatIndex, fromSeat: SeatIndex, tile: Tile, now: number): void {
  const p = s.players[seat];
  const from = s.players[fromSeat];
  const taken = takeFromHand(p, tile.face, 3);
  p.melds.push({ kind: "minkan", face: tile.face });
  p.meldTiles.push([...taken, tile]);
  from.calledDiscards.push(from.discards.length - 1);
  markCall(s);
  s.kanCount += 1;
  s.pendingDora += 1;
  s.lastDiscard = null;
  addLog(s, `${p.name} カン ${tileLabel(tile)}`);
  drawKanReplacement(s, seat, now);
}

/** カンの補充（嶺上ツモ） */
function drawKanReplacement(s: GameState, seat: SeatIndex, now: number): void {
  const p = s.players[seat];
  p.drawn = drawRinshan(s);
  p.furitenTemp = false;
  s.rinshanDraw = true;
  s.turnSeat = seat;
  s.stage = "discard";
  s.decisionStart = now;
  if (!p.drawn) exhaustiveDraw(s);
}

/** 花を抜く（R-24）。手番の人だけ。リーチ中でも抜ける */
function doNuki(s: GameState, seat: SeatIndex, now: number): string | undefined {
  if (s.stage !== "discard") return "今は花を抜けません";
  if (s.turnSeat !== seat) return "あなたの手番ではありません";
  if (!hasFlower(s.players[seat])) return "抜ける花がありません";
  if (s.rinshan.length === 0) return "王牌が残っていないため花を抜けません";
  consumeStock(s, seat, now);
  nukiOne(s, seat);
  s.decisionStart = now; // 補充牌を見てから改めて判断する
  return undefined;
}

function doOwnKan(s: GameState, seat: SeatIndex, face: Face | undefined, now: number): string | undefined {
  if (s.stage !== "discard") return "今はカンできません";
  if (s.turnSeat !== seat) return "あなたの手番ではありません";
  const faces = ownKanFaces(s, seat);
  if (!face) return faces.length ? "カンする牌を指定してください" : "カンできる牌がありません";
  if (!faces.includes(face)) return "その牌ではカンできません";
  consumeStock(s, seat, now);
  const p = s.players[seat];
  const all = [...p.hand, p.drawn!];
  if (countFace(all, face) === 4) {
    // 暗槓：ドラは即めくる
    p.hand.push(p.drawn!);
    p.drawn = null;
    const taken = takeFromHand(p, face, 4);
    sortTiles(p.hand);
    p.melds.push({ kind: "ankan", face });
    p.meldTiles.push(taken);
    s.kanCount += 1;
    s.doraCount = Math.min(DORA_SLOTS, s.doraCount + 1);
    markCall(s);
    addLog(s, `${p.name} 暗槓 ${faceName(face)}`);
    drawKanReplacement(s, seat, now);
    return undefined;
  }
  // 加槓：槍槓のロンを確認してから成立
  let tile: Tile;
  if (p.drawn!.face === face) {
    tile = p.drawn!;
    p.drawn = null;
  } else {
    const i = p.hand.findIndex((t) => t.face === face);
    tile = p.hand.splice(i, 1)[0];
    p.hand.push(p.drawn!);
    p.drawn = null;
    sortTiles(p.hand);
  }
  addLog(s, `${p.name} 加槓 ${tileLabel(tile)}`);
  openClaims(s, seat, tile, "chankan", false, now);
  return undefined;
}

/** 加槓の成立（槍槓がなかった） */
function completeKakan(s: GameState, seat: SeatIndex, tile: Tile, now: number): void {
  const p = s.players[seat];
  const mi = p.melds.findIndex((m) => m.kind === "pon" && m.face === tile.face);
  p.melds[mi] = { kind: "kakan", face: tile.face };
  p.meldTiles[mi] = [...p.meldTiles[mi], tile];
  s.kanCount += 1;
  s.pendingDora += 1;
  markCall(s);
  drawKanReplacement(s, seat, now);
}

// ---------------------------------------------------------------------------
// 和了・流局・局の終わり
// ---------------------------------------------------------------------------

function applyBuyin(p: PlayerState): void {
  while (p.chips <= 0) {
    p.chips += GAME_RULES.CHIP_BUYIN; // チップが無くなったら2,000円分バイイン（C-02）
    p.buyins += 1;
  }
}

/** 時間超過の自動処理：その人のチップを卓の供託へ出す（C-08）。0以下になればバイイン */
function payTimeoutChip(s: GameState, seat: SeatIndex): void {
  const p = s.players[seat];
  p.chips -= TIMEOUT_CHIP_PENALTY;
  s.round.chipPot += TIMEOUT_CHIP_PENALTY;
  applyBuyin(p);
  addLog(s, `${p.name} 時間超過でチップ${TIMEOUT_CHIP_PENALTY}枚を供託`);
}

/** 卓の供託チップを和了者に渡す。chipDeltas にも加える。取った枚数を返す（C-08） */
function takeChipPot(s: GameState, winnerId: string, chipDeltas: Record<string, number>): number {
  const pot = s.round.chipPot;
  if (pot > 0) {
    chipDeltas[winnerId] = (chipDeltas[winnerId] ?? 0) + pot;
    s.round.chipPot = 0;
  }
  return pot;
}

function doTsumo(s: GameState, seat: SeatIndex, now: number): string | undefined {
  if (s.stage !== "discard" || s.turnSeat !== seat) return "今はツモ和了できません";
  const t = evalTsumo(s, seat);
  if (!t) return "ツモ和了できません（和了形でないか、役がありません）";
  consumeStock(s, seat, now);
  finishWin(s, seat, "tsumo", t.res, t.displayTiles, t.evalTiles, t.winFace, null, t.pocchi);
  return undefined;
}

function winByRon(s: GameState, seat: SeatIndex, c: PendingClaim, now: number): void {
  void now;
  const p = s.players[seat];
  const handTiles = [...p.hand, c.tile];
  const res = tryWin(s, seat, handTiles, c.tile.face, "ron", c.fromSeat, {
    chankan: c.kind === "chankan",
    openRiichiDealIn: isOpenRiichiDealIn(s, seat, c.fromSeat, c.pendingRiichi),
  });
  s.claim = null;
  finishWin(s, seat, "ron", res, handTiles, handTiles, c.tile.face, c.fromSeat, false);
}

/** 冬：王牌の隣（生牌の末尾）から順にめくり、和了手と同じ面が出たら終了（R-23）。リーチ和了時だけ（R-23b） */
function revealWinter(s: GameState, evalTiles: Tile[], melds: Meld[]): Face[] {
  const faces = new Set<Face>([...facesOf(evalTiles), ...melds.map((m) => m.face)]);
  const out: Face[] = [];
  for (let i = s.live.length - 1; i >= 0; i--) {
    const t = s.live[i];
    if (!isFlower(t) && faces.has(t.face)) break;
    out.push(t.face);
  }
  return out;
}

function finishWin(
  s: GameState,
  seat: SeatIndex,
  winBy: "tsumo" | "ron",
  res: WinResolution,
  displayTiles: Tile[],
  evalTiles: Tile[],
  winFace: Face,
  discarderSeat: SeatIndex | null,
  pocchi: boolean,
): void {
  const p = s.players[seat];
  const ids = idsOf(s);
  const discarderId = discarderSeat === null ? undefined : s.players[discarderSeat].id;

  // 冬はリーチして和了したときだけめくる（R-23b）
  const winterRevealed: Face[] = p.riichi && p.flowers.includes("winter") ? revealWinter(s, evalTiles, p.melds) : [];
  const chipCounts = { ...res.analysis.chips, winter: winterRevealed.length };
  const ymMult = res.yakumanChipMult; // 役満チップの倍数（C-07）
  const chipDeltas = settleChips({ chips: chipCounts, winBy, winnerId: p.id, discarderId, players: ids, yakuman: ymMult });
  const pot = takeChipPot(s, p.id, chipDeltas); // 供託チップは和了者が総取り（C-08）
  const chipDetail = toChipDetail(chipBreakdown(chipCounts, ymMult), pot);

  for (const q of s.players) {
    q.score += res.score.deltas[q.id] ?? 0;
    q.chips += chipDeltas[q.id] ?? 0;
    applyBuyin(q);
  }
  s.round.riichiSticks = 0; // 供託は和了者が総取り（settleWin に含まれる）

  let yakumanNames = res.analysis.yakumanNames;
  if (!yakumanNames.length && res.score.rank === "yakuman") {
    yakumanNames = [res.analysis.han >= GAME_RULES.KAZOE_YAKUMAN_HAN ? "数え役満" : "夏で役満"];
  }
  if (yakumanNames.length) s.yakumanLog.push({ playerId: p.id, names: yakumanNames });

  const result: HandResultWin = {
    kind: "win",
    winnerId: p.id,
    discarderId: discarderId ?? null,
    winBy,
    hand: displayTiles.map((t) => ({ ...t })),
    melds: p.melds.map((m) => ({ ...m })),
    winTile: winFace,
    yaku: res.analysis.yaku,
    han: res.analysis.han,
    rank: res.score.rank,
    baseRank: res.score.baseRank,
    summerUp: res.score.summerUp,
    multiplier: res.score.multiplier,
    yakumanNames,
    chipDetail,
    deltas: res.score.deltas,
    chipDeltas,
    doraIndicators: doraFaces(s),
    uraIndicators: p.riichi ? uraFaces(s) : [],
    winterRevealed,
    pocchiWin: pocchi,
  };
  s.result = result;
  s.claim = null;
  s.lastDiscard = null;
  const from = discarderSeat === null ? "" : `（放銃：${s.players[discarderSeat].name}）`;
  addLog(s, `${p.name} ${winBy === "tsumo" ? "ツモ" : "ロン"} ${faceName(winFace)}${from} ${yakumanNames.length ? yakumanNames.join("・") : `${res.analysis.han}翻`}`);
  concludeHand(s, seat === s.round.dealerSeat, true);
}

/** 流し役満の WinAnalysis（点数は役満固定。ドラ・チップなし） */
function nagashiAnalysis(): WinAnalysis {
  return {
    valid: true,
    yakuman: 1,
    yakumanNames: ["流し役満"],
    han: 0,
    yaku: [],
    dora: { aka: 0, gold: 0, omote: 0, ura: 0, autumn: 0, flower: 0 },
    chips: { ura: 0, gold: 0, spring: 0, winter: 0, ippatsu: false, pocchi: false },
    summer: false,
  };
}

/** 王牌を除いて引き切った（R-07b, R-45） */
function exhaustiveDraw(s: GameState): void {
  const ids = idsOf(s);
  const dealerId = s.players[s.round.dealerSeat].id;
  const deltas: Record<string, number> = { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 };
  const chipDeltas: Record<string, number> = { [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 };
  const nagashi = s.players.filter(
    (p) => p.discards.length > 0 && p.calledDiscards.length === 0 && p.discards.every((t) => isTerminalOrHonor(t.face)),
  );
  const tenpai = s.players.filter((p) => waitsOf(p).length > 0);
  const revealed: Record<string, Tile[]> = {};
  for (const p of tenpai) revealed[p.id] = p.hand.map((t) => ({ ...t }));

  let renchan: boolean;
  let asWin: boolean;
  if (nagashi.length) {
    // 流し役満：役満ツモ扱い（和了扱いで連荘）
    nagashi.forEach((p, i) => {
      const r = settleWin({
        analysis: nagashiAnalysis(),
        winBy: "tsumo",
        honba: s.round.honba,
        riichiSticks: i === 0 ? s.round.riichiSticks : 0,
        dealerId,
        winnerId: p.id,
        players: ids,
      });
      for (const id of ids) deltas[id] += r.deltas[id];
      // 流し役満も役満チップ（倍数1・ツモ扱い）を受け取る（C-07）
      const analysis = nagashiAnalysis();
      const ch = settleChips({
        chips: analysis.chips,
        winBy: "tsumo",
        winnerId: p.id,
        players: ids,
        yakuman: yakumanMultiplierOf(rankOf(analysis)),
      });
      for (const id of ids) chipDeltas[id] += ch[id];
      // 供託チップは供託リーチ棒と同じく最初の成立者へ（C-08）
      if (i === 0) takeChipPot(s, p.id, chipDeltas);
      s.yakumanLog.push({ playerId: p.id, names: ["流し役満"] });
      addLog(s, `${p.name} 流し役満`);
    });
    s.round.riichiSticks = 0;
    renchan = nagashi.some((p) => p.id === dealerId);
    asWin = true;
  } else {
    Object.assign(deltas, settleDraw({ tenpai: tenpai.map((p) => p.id), players: ids }));
    renchan = tenpai.some((p) => p.id === dealerId);
    asWin = false;
    addLog(s, `流局（聴牌：${tenpai.map((p) => p.name).join("・") || "なし"}）`);
  }
  // 通常の流局では供託チップは繰り越す（C-08）
  for (const p of s.players) {
    p.score += deltas[p.id];
    p.chips += chipDeltas[p.id];
    applyBuyin(p);
  }
  const result: HandResultDraw = {
    kind: "draw",
    nagashiIds: nagashi.map((p) => p.id),
    tenpaiIds: tenpai.map((p) => p.id),
    deltas,
    chipDeltas,
    revealed,
  };
  s.result = result;
  s.claim = null;
  s.lastDiscard = null;
  // 流し役満は子が和了しても「和了扱い」なので本場0。通常流局は本場+1
  concludeHand(s, renchan, asWin);
}

/**
 * 局の終わり：終局判定（トビ・南3以降で40000点以上）→ 次の局を決める。
 * renchan=親が続ける。childWin=子の和了で親が流れる（本場0）。そうでない親流れは本場+1。
 */
function concludeHand(s: GameState, renchan: boolean, isWin: boolean): void {
  const r = s.round;
  for (const p of s.players) {
    p.ready = false;
    p.drawn = null;
  }
  const late = r.wind === "3z" || (r.wind === "2z" && r.number >= 3);
  const tobi = s.players.some((p) => p.score < 0);
  const reached = s.players.some((p) => p.score >= GAME_RULES.RETURN);
  if (tobi || (late && reached)) {
    endGame(s, tobi ? "トビ" : "40000点到達");
    return;
  }
  // P-11：西3局が終わったら、40000点以上の人がいなくても・親の連荘中でも打ち切る（終わらない半荘を防ぐため）
  if (r.wind === "3z" && r.number >= GAME_RULES.LAST_WEST_HAND) {
    endGame(s, "西場打ち切り");
    return;
  }
  const next: RoundInfo = { ...r };
  if (renchan) {
    next.honba = r.honba + 1;
  } else {
    next.honba = isWin ? 0 : r.honba + 1;
    next.dealerSeat = seatAt(r.dealerSeat + 1);
    next.number = r.number + 1;
    if (next.number > 3) {
      next.number = 1;
      // 東→南→西。西3が終わったら上で打ち切るので、西のあとに続くことはない（P-11）
      next.wind = r.wind === "1z" ? "2z" : "3z";
    }
  }
  s.nextRound = next;
  s.stage = "result";
}

/** 終局：残った供託はトップへ。最終結果を作る */
function endGame(s: GameState, reason: string): void {
  const order = [...s.players].sort(
    (a, b) => b.score - a.score || seatAt(a.seat - s.startDealer) - seatAt(b.seat - s.startDealer),
  );
  if (s.round.riichiSticks > 0) {
    order[0].score += s.round.riichiSticks * GAME_RULES.RIICHI_STICK;
    s.round.riichiSticks = 0;
  }
  // 残った供託チップもトップへ（chipNet の合計を0に保つ。C-08）
  if (s.round.chipPot > 0) {
    order[0].chips += s.round.chipPot;
    s.round.chipPot = 0;
  }
  const scores: Record<string, number> = {};
  const chipNet: Record<string, number> = {};
  const buyins: Record<string, number> = {};
  for (const p of s.players) {
    scores[p.id] = p.score;
    chipNet[p.id] = p.chips - GAME_RULES.CHIP_BUYIN * p.buyins;
    buyins[p.id] = p.buyins;
  }
  s.final = { scores, chipNet, buyins, yakuman: s.yakumanLog.map((y) => ({ playerId: y.playerId, names: [...y.names] })) };
  s.nextRound = null;
  s.stage = "end";
  addLog(s, `終局（${reason}）`);
}

/** 全員が「次へ」を押したか（切断中は押したものとみなす。ただし誰か1人は接続していること） */
function allReady(s: GameState): boolean {
  return s.players.some((p) => p.connected) && s.players.every((p) => p.ready || !p.connected);
}

function proceedToNextHand(s: GameState, now: number): void {
  if (!s.nextRound) return;
  s.round = s.nextRound;
  s.nextRound = null;
  startHand(s, now);
}

function doNextHand(s: GameState, seat: SeatIndex, now: number): string | undefined {
  if (s.stage !== "result") return "今は次の局へ進めません";
  const p = s.players[seat];
  if (p.ready) return "すでに「次へ」を押しています";
  p.ready = true;
  if (allReady(s)) proceedToNextHand(s, now);
  return undefined;
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

export function applyAction(
  state: GameState,
  playerId: string,
  action: GameAction,
  now: number = Date.now(),
): { state: GameState; error?: string } {
  const seatNum = state.players.findIndex((p) => p.id === playerId);
  if (seatNum < 0) return { state, error: "この卓のプレイヤーではありません" };
  if (state.stage === "end") return { state, error: "対局は終了しています" };
  const seat = seatAt(seatNum);
  const s = normalize(clone(state));
  s.clock = now;
  let err: string | undefined;
  switch (action.type) {
    case "discard":
      err = doDiscard(s, seat, action, now);
      break;
    case "nuki":
      err = doNuki(s, seat, now);
      break;
    case "tsumo":
      err = doTsumo(s, seat, now);
      break;
    case "ron":
      err = doClaimResponse(s, seat, "ron", now);
      break;
    case "pon":
      err = doClaimResponse(s, seat, "pon", now);
      break;
    case "pass":
      err = doClaimResponse(s, seat, "pass", now);
      break;
    case "kan":
      err = s.stage === "claim" ? doClaimResponse(s, seat, "kan", now) : doOwnKan(s, seat, action.face, now);
      break;
    case "next_hand":
      err = doNextHand(s, seat, now);
      break;
    default:
      err = "不明な操作です";
  }
  if (err) return { state, error: err };
  return { state: s };
}

/** 古い保存状態（v0.6 より前）に無い項目を補う */
function normalize(s: GameState): GameState {
  if (typeof s.round.chipPot !== "number") s.round.chipPot = 0;
  if (s.nextRound && typeof s.nextRound.chipPot !== "number") s.nextRound.chipPot = s.round.chipPot;
  for (const p of s.players) if (typeof p.openRiichi !== "boolean") p.openRiichi = false;
  return s;
}

/**
 * 時間切れの打牌を決める。花があれば先に全部抜き（嶺上が尽きていれば抜かずに花以外を切る）、
 * ツモ牌があればツモ切り、なければ喰い替えにならない一番右の花以外の牌。
 */
function autoDiscard(s: GameState, seat: SeatIndex, now: number): string | undefined {
  const p = s.players[seat];
  while (hasFlower(p) && s.rinshan.length > 0) nukiOne(s, seat);
  if (p.drawn && !isFlower(p.drawn)) return doDiscard(s, seat, { type: "discard", drawn: true }, now);
  let idx = p.hand.length - 1;
  while (idx > 0 && (isFlower(p.hand[idx]) || p.hand[idx].face === p.kuikaeFace)) idx--;
  return doDiscard(s, seat, { type: "discard", index: idx }, now);
}

/**
 * 期限切れの判断を自動で処理する（打牌待ち→ツモ切り、鳴き待ち→パス）。
 * 期限＝持ち時間切れ＋60秒。自動処理した人はチップ1枚を卓の供託へ出す（C-08）。
 */
export function handleTimeout(state: GameState, now: number): GameState {
  let s = state;
  for (let guard = 0; guard < 12; guard++) {
    if (s.stage === "result" && allReady(s)) {
      s = normalize(clone(s));
      s.clock = now;
      proceedToNextHand(s, now);
      continue;
    }
    const d = nextDeadline(s);
    if (d === null || now < d) break;
    s = normalize(clone(s));
    s.clock = now;
    if (s.stage === "discard") {
      const seat = s.turnSeat;
      const p = s.players[seat];
      p.stock = 0;
      payTimeoutChip(s, seat); // 和了・終局で供託が精算される前に出す
      addLog(s, `${p.name} 時間切れ`);
      const err = autoDiscard(s, seat, now);
      if (err) break;
    } else if (s.stage === "claim" && s.claim) {
      const expired = s.claim.entries.filter((e) => e.response === null && deadlineOf(s, e.seat) <= now).map((e) => e.seat);
      for (const seat of expired) {
        if (s.stage !== "claim") break;
        s.players[seat].stock = 0;
        payTimeoutChip(s, seat);
        doClaimResponse(s, seat, "pass", now);
      }
    } else {
      break;
    }
  }
  return s;
}

export function setConnected(state: GameState, playerId: string, connected: boolean): GameState {
  const s = clone(state);
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return state;
  p.connected = connected;
  addLog(s, `${p.name} ${connected ? "接続" : "切断"}`);
  if (s.stage === "result" && allReady(s)) proceedToNextHand(s, s.clock);
  return s;
}

function publicOf(s: GameState, p: PlayerState): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    score: p.score,
    chips: p.chips,
    buyins: p.buyins,
    connected: p.connected,
    riichi: p.riichi,
    riichiDiscardIndex: p.riichiDiscardIndex,
    discards: p.discards.map((t) => ({ ...t })),
    calledDiscards: [...p.calledDiscards],
    melds: p.melds.map((m) => ({ ...m })),
    meldTiles: p.meldTiles.map((g) => g.map((t) => ({ ...t }))),
    flowers: [...p.flowers],
    handCount: p.hand.length + (p.drawn ? 1 : 0),
    ready: p.ready,
    isDealer: p.seat === s.round.dealerSeat,
    // オープンリーチ中は手牌（ツモ牌を除く）を全員に公開（R-47）
    openHand: p.riichi && p.openRiichi ? p.hand.map((t) => ({ ...t })) : null,
  };
}

/** フリテン表示（D-07）：待ちが自分の捨て牌にある／見逃し中／リーチ後見逃し */
function furitenOf(p: PlayerState): boolean {
  if (p.furitenTemp || p.furitenRiichi) return true;
  const w = waitsOf(p);
  return w.length > 0 && isFuriten(p, w);
}

export function viewFor(s: GameState, playerId: string, opts: { debug?: boolean } = {}): PlayerView {
  const seatNum = s.players.findIndex((p) => p.id === playerId);
  const me = seatNum >= 0 ? s.players[seatNum] : null;
  const phase: TablePhase = s.stage === "result" ? "hand_end" : s.stage === "end" ? "game_end" : "playing";
  const view: PlayerView = {
    phase,
    round: { ...s.round, chipPot: s.round.chipPot ?? 0 },
    wallRemaining: s.live.length,
    doraIndicators: doraFaces(s),
    players: s.players.map((p) => publicOf(s, p)),
    turnSeat: s.stage === "discard" || s.stage === "claim" ? s.turnSeat : null,
    lastDiscard: s.lastDiscard ? { seat: s.lastDiscard.seat, tile: { ...s.lastDiscard.tile } } : null,
    you: me
      ? {
          id: me.id,
          seat: me.seat,
          hand: me.hand.map((t) => ({ ...t })),
          drawn: me.drawn ? { ...me.drawn } : null,
          waits: waitsOf(me),
          options: computeOptions(s, me.seat),
          deadline: personalDeadline(s, me.seat),
          overtimeFrom: personalOvertimeFrom(s, me.seat),
          shanten: shantenOf(me),
          furiten: furitenOf(me),
          discardWaits: tenpaiDiscards(me),
        }
      : null,
    result: s.result ? clone(s.result) : null,
    final: s.final ? clone(s.final) : null,
    log: s.log.slice(0, 30),
  };
  if (opts.debug) {
    view.debugHands = Object.fromEntries(s.players.map((p) => [p.id, [...p.hand, ...(p.drawn ? [p.drawn] : [])].map((t) => ({ ...t }))]));
  }
  return view;
}
