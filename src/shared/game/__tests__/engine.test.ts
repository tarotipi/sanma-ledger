import { describe, it, expect } from "vitest";
import {
  createGame,
  applyAction,
  viewFor,
  handleTimeout,
  nextDeadline,
  setConnected,
  parseWallTiles,
  type GameState,
} from "../engine";
import type { GameAction } from "../protocol";

// 席：A=0（親）, B=1, C=2。山は「A13枚→B13枚→C13枚→Aの第1ツモ→以降のツモ順」
const PLAYERS = [
  { id: "A", name: "Aさん" },
  { id: "B", name: "Bさん" },
  { id: "C", name: "Cさん" },
];
const JUNK_A = "1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 6z 7z 2p";
const JUNK_B = "1m 9m 1p 9p 1s 9s 4z 5z 6z 7z 2p 4p 6p";
const JUNK_C = "1m 9m 1p 9p 1s 9s 4z 5z 6z 7z 3p 4p 6p";
const TENPAI = "1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 9m 9m"; // 5s/8s待ち・平和形

function game(a: string, b: string, c: string, draws: string, seed = 1): GameState {
  return createGame(PLAYERS, {
    seed,
    dealerSeat: 0,
    now: 0,
    presetWall: parseWallTiles(`${a} ${b} ${c} ${draws}`),
  });
}

function act(s: GameState, id: string, action: GameAction, now = 1000): GameState {
  const r = applyAction(s, id, action, now);
  if (r.error) throw new Error(`${id} ${JSON.stringify(action)}: ${r.error}`);
  return r.state;
}

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

/** 全員ツモ切り・鳴き/ロンは全部見送りで局の終わりまで進める */
function playOut(s: GameState): GameState {
  let guard = 0;
  while (s.stage === "discard" || s.stage === "claim") {
    if (guard++ > 1000) throw new Error("終わらない");
    if (s.stage === "discard") {
      const p = s.players[s.turnSeat];
      s = p.drawn
        ? act(s, p.id, { type: "discard", drawn: true })
        : act(s, p.id, { type: "discard", index: p.hand.length - 1 });
    } else {
      const e = s.claim!.entries.find((x) => x.response === null)!;
      s = act(s, s.players[e.seat].id, { type: "pass" });
    }
  }
  return s;
}

describe("配牌と山", () => {
  it("13枚ずつ配り、親は14枚目をツモ。合計112枚・王牌14枚", () => {
    const s = createGame(PLAYERS, { seed: 42, dealerSeat: 0, now: 0 });
    for (const p of s.players) expect(p.hand.length).toBe(13);
    expect(s.players[0].drawn).not.toBeNull();
    const flowers = s.players.reduce((n, p) => n + p.flowers.length, 0);
    const dead = s.doraTiles.length + s.uraTiles.length + s.rinshan.length;
    expect(dead).toBe(14);
    expect(s.live.length + dead + 39 + 1 + flowers).toBe(112);
    expect(viewFor(s, "A").doraIndicators.length).toBe(1);
  });

  it("同じシードなら同じ山（DBG-02）", () => {
    const a = createGame(PLAYERS, { seed: 7, now: 0 });
    const b = createGame(PLAYERS, { seed: 7, now: 0 });
    expect(a.live.map((t) => t.face)).toEqual(b.live.map((t) => t.face));
    expect(a.round.dealerSeat).toBe(b.round.dealerSeat);
  });
});

describe("花の自動抜き（§2.3, P-09）", () => {
  it("配牌の花を抜いて嶺上から補充、王牌は14枚のまま", () => {
    let s = game("f1 1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 9m", JUNK_B, JUNK_C, "1z f2 3z f3 f4");
    const a = P(s, "A");
    expect(a.flowers).toEqual(["spring"]);
    expect(a.hand.length).toBe(13);
    expect(a.hand.some((t) => t.face.startsWith("f"))).toBe(false);
    expect(s.rinshan.length).toBe(4);
    expect(s.live.length).toBe(57); // 98 - 39 - 補充1 - ツモ1
    // ツモった花も抜く
    s = act(s, "A", { type: "discard", drawn: true });
    const b = P(s, "B");
    expect(b.flowers).toEqual(["summer"]);
    expect(b.drawn?.face.startsWith("f")).toBe(false);
    expect(s.rinshan.length).toBe(4);
    expect(s.live.length).toBe(55);
  });
});

describe("打牌とツモ", () => {
  it("打牌すると次の人がツモる", () => {
    let s = game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s");
    s = act(s, "A", { type: "discard", drawn: true });
    expect(s.stage).toBe("discard");
    expect(s.turnSeat).toBe(1);
    expect(P(s, "B").drawn?.face).toBe("2s");
    expect(P(s, "A").discards.map((t) => t.face)).toEqual(["5s"]);
  });

  it("手番以外の打牌はエラー", () => {
    const s = game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s");
    const r = applyAction(s, "B", { type: "discard", drawn: true }, 0);
    expect(r.error).toBeTruthy();
    expect(r.state).toBe(s);
  });

  it("他人の手牌はビューに出ない／デバッグなら全員分", () => {
    const s = game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s");
    const v = viewFor(s, "B");
    expect(v.you?.hand.length).toBe(13);
    expect(v.debugHands).toBeUndefined();
    expect(viewFor(s, "B", { debug: true }).debugHands?.A.length).toBe(14);
  });
});

describe("ポン", () => {
  it("ポンで手番が飛ぶ（Bを飛ばしてCへ）", () => {
    let s = game(JUNK_A.replace("1z", "8p"), JUNK_B, "1z 1z 1m 9m 1p 9p 1s 9s 4z 6z 7z 3p 4p", "1z");
    s = act(s, "A", { type: "discard", drawn: true });
    expect(s.stage).toBe("claim");
    expect(viewFor(s, "C").you?.options.pon).toBe(true);
    s = act(s, "C", { type: "pon" });
    expect(s.turnSeat).toBe(2);
    expect(P(s, "C").melds).toEqual([{ kind: "pon", face: "1z" }]);
    expect(P(s, "C").hand.length).toBe(11);
    expect(P(s, "B").drawn).toBeNull();
    s = act(s, "C", { type: "discard", index: 0 });
    // Cの次はA
    expect(s.turnSeat).toBe(0);
    expect(P(s, "A").drawn).not.toBeNull();
  });
});

describe("ロン", () => {
  const B_HAND = "2p 3p 4p 6p 7p 8p 2s 3s 4s 6s 7s 8s 8p"; // 8p単騎・タンヤオ
  const C_HAND = "2s 3s 4s 2s 3s 4s 6s 7s 8s 9s 9s 6p 7p"; // 5p/8p待ち
  const setup = () => game(JUNK_A, B_HAND, C_HAND, "8p");

  it("頭ハネ：BもCもロンしたら放銃者に近いBが和了", () => {
    let s = act(setup(), "A", { type: "discard", drawn: true });
    expect(viewFor(s, "B").you?.options.ron).toBe(true);
    expect(viewFor(s, "C").you?.options.ron).toBe(true);
    s = act(s, "C", { type: "ron" });
    s = act(s, "B", { type: "ron" });
    expect(s.stage).toBe("result");
    const r = s.result!;
    expect(r.kind).toBe("win");
    if (r.kind !== "win") return;
    expect(r.winnerId).toBe("B");
    expect(r.discarderId).toBe("A");
    expect(r.deltas.B).toBeGreaterThan(0);
    expect(r.deltas.A).toBe(-r.deltas.B);
    expect(r.deltas.C).toBe(0);
    expect(r.yaku.map((y) => y.name)).toContain("断么九");
  });

  it("Bが見送ればCが和了", () => {
    let s = act(setup(), "A", { type: "discard", drawn: true });
    s = act(s, "B", { type: "pass" });
    s = act(s, "C", { type: "ron" });
    expect(s.result?.kind === "win" && s.result.winnerId).toBe("C");
  });

  it("白ポッチの打牌にはロンできない（R-32）／普通の白ならロンできる", () => {
    const aHand = "1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 7z 2p 8p";
    const bHand = "6z 6z 6z 2p 3p 4p 6p 7p 8p 2s 3s 4s 5z"; // 白単騎・發
    let s = game(aHand, bHand, JUNK_C, "w5z");
    s = act(s, "A", { type: "discard", drawn: true });
    expect(s.stage).toBe("discard");
    expect(s.turnSeat).toBe(1);

    let t = game(aHand, bHand, JUNK_C, "5z");
    t = act(t, "A", { type: "discard", drawn: true });
    expect(t.stage).toBe("claim");
    expect(viewFor(t, "B").you?.options.ron).toBe(true);
  });
});

describe("リーチとツモ和了", () => {
  it("ダブル立直・一発・ツモ・平和で和了、点数とチップが動く", () => {
    let s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z 8s");
    const o = viewFor(s, "A").you!.options;
    expect(o.riichi).toBe(true);
    expect(o.riichiDiscards).toContain(-1);
    s = act(s, "A", { type: "discard", drawn: true, riichi: true });
    expect(P(s, "A").riichi).toBe(true);
    expect(P(s, "A").score).toBe(34000);
    expect(s.round.riichiSticks).toBe(1);
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    expect(viewFor(s, "A").you?.options.tsumo).toBe(true);
    expect(applyAction(s, "A", { type: "discard", index: 0 }).error).toMatch(/ツモ切り/);
    s = act(s, "A", { type: "tsumo" });
    const r = s.result!;
    expect(r.kind).toBe("win");
    if (r.kind !== "win") return;
    const names = r.yaku.map((y) => y.name);
    expect(names).toContain("ダブル立直");
    expect(names).toContain("一発");
    expect(names).toContain("門前清自摸和");
    expect(names).toContain("平和");
    // 供託1本（1000点）を和了者が受け取るので、移動の合計は+1000
    expect(r.deltas.A + r.deltas.B + r.deltas.C).toBe(1000);
    expect(s.players.reduce((n, p) => n + p.score, 0)).toBe(105000);
    expect(r.chipDeltas.A).toBeGreaterThanOrEqual(2); // 一発1枚×2人
    expect(r.chipDeltas.A + r.chipDeltas.B + r.chipDeltas.C).toBe(0);
    // 親の和了は連荘
    expect(s.nextRound?.dealerSeat).toBe(0);
    expect(s.nextRound?.honba).toBe(1);
  });

  it("リーチ後にツモった白ポッチは万能牌（R-31）でチップ+1", () => {
    let s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z w5z");
    s = act(s, "A", { type: "discard", drawn: true, riichi: true });
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    expect(viewFor(s, "A").you?.options.tsumo).toBe(true);
    s = act(s, "A", { type: "tsumo" });
    const r = s.result!;
    expect(r.kind === "win" && r.pocchiWin).toBe(true);
    if (r.kind !== "win") return;
    expect(["5s", "8s"]).toContain(r.winTile);
    expect(r.chipDeltas.A).toBeGreaterThanOrEqual(4); // (一発1+白ポッチ1)×2人
  });

  it("リーチ前の白ポッチは普通の白（万能にならない）", () => {
    // Aはリーチせずに白ポッチをツモる
    const s = game(TENPAI, JUNK_B, JUNK_C, "w5z");
    expect(viewFor(s, "A").you?.options.tsumo).toBe(false);
  });
});

describe("カン", () => {
  it("暗槓：ドラ表示が増え、嶺上からツモ、王牌は14枚", () => {
    let s = game("1z 1z 1z 1p 2p 3p 7p 8p 9p 2s 3s 4s 9m", JUNK_B, JUNK_C, "1z");
    expect(viewFor(s, "A").you?.options.kan).toContain("1z");
    const liveBefore = s.live.length;
    s = act(s, "A", { type: "kan", face: "1z" });
    const a = P(s, "A");
    expect(a.melds).toEqual([{ kind: "ankan", face: "1z" }]);
    expect(a.drawn).not.toBeNull();
    expect(viewFor(s, "A").doraIndicators.length).toBe(2);
    expect(s.doraTiles.length + s.uraTiles.length + s.rinshan.length).toBe(14);
    expect(s.live.length).toBe(liveBefore - 1);
  });
});

describe("流局と連荘", () => {
  it("親だけ聴牌：テンパイ料1000点、親の連荘で本場+1", () => {
    let s = playOut(game(TENPAI, JUNK_B, JUNK_C, "", 3));
    const r = s.result!;
    expect(r.kind).toBe("draw");
    if (r.kind !== "draw") return;
    expect(r.nagashiIds).toEqual([]);
    expect(r.tenpaiIds).toEqual(["A"]);
    expect(r.deltas).toEqual({ A: 1000, B: -500, C: -500 });
    expect(s.nextRound).toMatchObject({ dealerSeat: 0, honba: 1, number: 1 });
    s = act(s, "A", { type: "next_hand" });
    expect(s.stage).toBe("result");
    s = act(s, "B", { type: "next_hand" });
    s = act(s, "C", { type: "next_hand" });
    expect(s.stage).toBe("discard");
    expect(s.round).toMatchObject({ dealerSeat: 0, honba: 1, wind: "1z", number: 1 });
  });

  it("親がノーテンなら親流れ・本場+1", () => {
    const s = playOut(game(JUNK_A, TENPAI, JUNK_C, "", 5));
    expect(s.result?.kind).toBe("draw");
    expect(s.nextRound).toMatchObject({ dealerSeat: 1, honba: 1, number: 2 });
  });

  it("子の和了で親流れ・本場0", () => {
    let s = game(JUNK_A, "2p 3p 4p 6p 7p 8p 2s 3s 4s 6s 7s 8s 8p", "2s 3s 4s 2s 3s 4s 6s 7s 8s 9s 9s 6p 7p", "8p");
    s = act(s, "A", { type: "discard", drawn: true });
    s = act(s, "B", { type: "ron" });
    s = act(s, "C", { type: "pass" });
    expect(s.nextRound).toMatchObject({ dealerSeat: 1, honba: 0, number: 2 });
  });

  it("切断中の人は「次へ」を押したものとみなす", () => {
    let s = playOut(game(TENPAI, JUNK_B, JUNK_C, "", 3));
    s = setConnected(s, "C", false);
    s = act(s, "A", { type: "next_hand" });
    s = act(s, "B", { type: "next_hand" });
    expect(s.stage).toBe("discard");
  });
});

describe("終局", () => {
  const B_HAND = "2p 3p 4p 6p 7p 8p 2s 3s 4s 6s 7s 8s 8p";
  const C_HAND = "2s 3s 4s 2s 3s 4s 6s 7s 8s 9s 9s 6p 7p";
  const ronByB = (s: GameState) => {
    s = act(s, "A", { type: "discard", drawn: true });
    s = act(s, "B", { type: "ron" });
    return act(s, "C", { type: "pass" });
  };

  it("トビ（0点未満）で即終局", () => {
    let s = game(JUNK_A, B_HAND, C_HAND, "8p");
    s.players[0].score = 500;
    s = ronByB(s);
    expect(s.stage).toBe("end");
    expect(viewFor(s, "A").phase).toBe("game_end");
    expect(s.final?.scores.A).toBeLessThan(0);
  });

  it("南3で誰かが40000点以上なら終局", () => {
    let s = game(JUNK_A, B_HAND, C_HAND, "8p");
    s.round = { ...s.round, wind: "2z", number: 3 };
    s.players[1].score = 39500;
    s = ronByB(s);
    expect(s.stage).toBe("end");
    const f = s.final!;
    expect(f.scores.B).toBeGreaterThanOrEqual(40000);
    expect(Object.values(f.chipNet).reduce((a, b) => a + b, 0)).toBe(0);
    expect(f.buyins).toEqual({ A: 1, B: 1, C: 1 });
  });

  it("南3で40000点未満なら西入（場風=西）", () => {
    let s = game(JUNK_A, B_HAND, C_HAND, "8p");
    s.round = { ...s.round, wind: "2z", number: 3 };
    s.players[1].score = 30000;
    s = ronByB(s);
    expect(s.stage).toBe("result");
    expect(s.nextRound).toMatchObject({ wind: "3z", number: 1, dealerSeat: 1 });
    for (const id of ["A", "B", "C"]) s = act(s, id, { type: "next_hand" });
    expect(s.round.wind).toBe("3z");
    expect(s.stage).toBe("discard");
  });
});

describe("持ち時間（P-06）", () => {
  it("基本10秒＋ストック20秒を過ぎたら自動ツモ切り", () => {
    const s = game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s");
    expect(nextDeadline(s)).toBe(30000);
    expect(handleTimeout(s, 29999)).toBe(s);
    const t = handleTimeout(s, 30000);
    expect(P(t, "A").discards.length).toBe(1);
    expect(t.turnSeat).toBe(1);
    expect(P(t, "A").stock).toBe(0);
  });
});

describe("JSON往復（Durable Object 保存）", () => {
  it("JSON化して戻しても続きを打てる", () => {
    let s = JSON.parse(JSON.stringify(game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s"))) as GameState;
    s = act(s, "A", { type: "discard", drawn: true });
    s = JSON.parse(JSON.stringify(s)) as GameState;
    s = act(s, "B", { type: "discard", drawn: true });
    expect(s.turnSeat).toBe(2);
    expect(viewFor(s, "C").you?.drawn).not.toBeNull();
  });
});
