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

/** 全員ツモ切り（花は抜く）・鳴き/ロンは全部見送りで局の終わりまで進める */
function playOut(s: GameState): GameState {
  let guard = 0;
  while (s.stage === "discard" || s.stage === "claim") {
    if (guard++ > 1000) throw new Error("終わらない");
    if (s.stage === "discard") {
      const p = s.players[s.turnSeat];
      if (viewFor(s, p.id).you?.options.nuki) {
        s = act(s, p.id, { type: "nuki" });
        continue;
      }
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

/** 嶺上（花の補充・カンの補充）を指定の牌にする（テスト用） */
function setRinshan(s: GameState, str: string): void {
  s.rinshan = parseWallTiles(str).map((t, i) => ({ ...t, id: 900 + i }));
}

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

describe("持ち時間（P-06, C-08）", () => {
  it("基本10秒＋ストック20秒を使い切ってから60秒で自動ツモ切り", () => {
    const s = game(JUNK_A, JUNK_B, JUNK_C, "r5s 2s");
    expect(viewFor(s, "A").you?.overtimeFrom).toBe(30000);
    expect(viewFor(s, "A").you?.deadline).toBe(90000);
    expect(viewFor(s, "B").you?.overtimeFrom).toBeNull();
    expect(nextDeadline(s)).toBe(90000);
    expect(handleTimeout(s, 89999)).toBe(s);
    const t = handleTimeout(s, 90000);
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

// ---------------------------------------------------------------------------
// v0.6（§10）
// ---------------------------------------------------------------------------

const B_RON_HAND = "2p 3p 4p 6p 7p 8p 2s 3s 4s 6s 7s 8s 8p"; // 8p単騎・タンヤオ
const C_RON_HAND = "2s 3s 4s 2s 3s 4s 6s 7s 8s 9s 9s 6p 7p"; // 5p/8p待ち

describe("R-24 花の手動抜き", () => {
  it("配牌・ツモの花は手に残り、手番で1枚ずつ抜く。補充は嶺上から、王牌14枚を維持", () => {
    let s = game("f1 1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 9m", JUNK_B, JUNK_C, "f2 2z 3z");
    setRinshan(s, "1z 2z 3z 4z");
    const a = P(s, "A");
    expect(a.flowers).toEqual([]);
    expect(a.hand.some((t) => t.face === "f1")).toBe(true);
    expect(a.drawn?.face).toBe("f2");
    expect(viewFor(s, "A").you?.options.nuki).toBe(true);
    expect(viewFor(s, "B").you?.options.nuki).toBe(false);
    // 花は切れない
    expect(applyAction(s, "A", { type: "discard", drawn: true }).error).toMatch(/花は切れません/);
    const fi = a.hand.findIndex((t) => t.face === "f1");
    expect(applyAction(s, "A", { type: "discard", index: fi }).error).toMatch(/花は切れません/);
    // 手番でない人は抜けない
    expect(applyAction(s, "B", { type: "nuki" }).error).toBeTruthy();

    const liveBefore = s.live.length;
    s = act(s, "A", { type: "nuki" }); // ツモ牌の夏から
    expect(P(s, "A").flowers).toEqual(["summer"]);
    expect(P(s, "A").drawn?.face).toBe("1z");
    expect(s.rinshan.length).toBe(4);
    expect(s.live.length).toBe(liveBefore - 1);
    s = act(s, "A", { type: "nuki" }); // 次は手牌の春
    expect(P(s, "A").flowers).toEqual(["summer", "spring"]);
    expect(P(s, "A").hand.length).toBe(13);
    expect(P(s, "A").hand.some((t) => t.face.startsWith("f"))).toBe(false);
    expect(P(s, "A").drawn?.face).toBe("2z");
    expect(viewFor(s, "A").you?.options.nuki).toBe(false);
    expect(viewFor(s, "B").players[0].flowers).toEqual(["summer", "spring"]);
    expect(s.doraTiles.length + s.uraTiles.length + s.rinshan.length).toBe(14);
  });

  it("花を持ったままではツモ和了できず、抜いた補充牌で和了れる。花は1枚1翻（R-25）", () => {
    // 1巡目の親ツモは天和になるので、1巡回してから花を引く
    let s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z f3");
    setRinshan(s, "8s 1z 2z 3z");
    s = act(s, "A", { type: "discard", drawn: true });
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    expect(viewFor(s, "A").you?.options.tsumo).toBe(false);
    expect(viewFor(s, "A").you?.waits).toEqual(["5s", "8s"]); // 花は待ち計算から除く
    expect(viewFor(s, "A").you?.shanten).toBe(0);
    s = act(s, "A", { type: "nuki" });
    expect(viewFor(s, "A").you?.options.tsumo).toBe(true);
    s = act(s, "A", { type: "tsumo" });
    const r = s.result!;
    if (r.kind !== "win") throw new Error("和了していない");
    expect(r.yaku).toContainEqual({ name: "花", han: 1 });
  });

  it("花を持っている人はテンパイ扱いにならない（ロン不可）", () => {
    // B は花を除くと12枚（2p3p4p 6p7p 2s3s4s 6s7s8s 8p）。8p が来てもロンにならない
    const bHand = "2p 3p 4p 6p 7p f1 2s 3s 4s 6s 7s 8s 8p";
    const s = act(game(JUNK_A, bHand, JUNK_C, "8p"), "A", { type: "discard", drawn: true });
    expect(s.stage).toBe("discard");
    expect(s.turnSeat).toBe(1);
    expect(viewFor(s, "B").you?.options.nuki).toBe(true);
  });

  it("リーチ中でもツモった花は抜ける", () => {
    let s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z f4");
    setRinshan(s, "4z 1z 2z 3z");
    s = act(s, "A", { type: "discard", drawn: true, riichi: true });
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    expect(viewFor(s, "A").you?.options.nuki).toBe(true);
    s = act(s, "A", { type: "nuki" });
    expect(P(s, "A").flowers).toEqual(["winter"]);
    expect(P(s, "A").drawn?.face).toBe("4z");
    s = act(s, "A", { type: "discard", drawn: true });
    expect(s.turnSeat).toBe(1);
  });

  it("時間切れの自動処理は花を切らない（抜いてからツモ切り）", () => {
    let s = game(JUNK_A, JUNK_B, JUNK_C, "f1");
    setRinshan(s, "2s 1z 2z 3z");
    s = handleTimeout(s, 90000);
    expect(P(s, "A").flowers).toEqual(["spring"]);
    expect(P(s, "A").discards.map((t) => t.face)).toEqual(["2s"]);
    expect(s.turnSeat).toBe(1);
  });
});

describe("R-23b 冬はリーチ和了時だけ", () => {
  const setup = () => {
    const s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z 8s");
    s.players[0].flowers = ["winter"];
    // 冬は生牌の末尾からめくる：1z（手に無い）→ 2s（手にある）で止まる
    s.live[s.live.length - 1] = { face: "1z", id: 990 };
    s.live[s.live.length - 2] = { face: "2s", id: 991 };
    return s;
  };
  const finish = (s: GameState, riichi: boolean) => {
    s = act(s, "A", { type: "discard", drawn: true, riichi });
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    s = act(s, "A", { type: "tsumo" });
    if (s.result?.kind !== "win") throw new Error("和了していない");
    return s.result;
  };

  it("リーチして和了すると冬がめくれてチップ", () => {
    const r = finish(setup(), true);
    expect(r.winterRevealed).toEqual(["1z"]);
    expect(r.chipDetail.winter).toBe(1);
  });

  it("リーチしていなければ冬はめくらない", () => {
    const r = finish(setup(), false);
    expect(r.winterRevealed).toEqual([]);
    expect(r.chipDetail.winter).toBe(0);
  });
});

describe("C-08 時間超過と供託チップ", () => {
  it("自動ツモ切りでチップ1枚を供託へ。次の和了者が総取り", () => {
    let s = game(JUNK_A, B_RON_HAND, C_RON_HAND, "8p");
    s = handleTimeout(s, 90000);
    expect(P(s, "A").chips).toBe(19);
    expect(s.round.chipPot).toBe(1);
    expect(viewFor(s, "B").round?.chipPot).toBe(1);
    s = act(s, "B", { type: "ron" }, 90500);
    s = act(s, "C", { type: "pass" }, 90500);
    const r = s.result!;
    if (r.kind !== "win") throw new Error("和了していない");
    expect(r.chipDetail.pot).toBe(1);
    expect(r.chipDeltas.B - r.chipDeltas.A - r.chipDeltas.C).toBeGreaterThanOrEqual(1);
    expect(r.chipDeltas.A + r.chipDeltas.B + r.chipDeltas.C).toBe(1); // 供託分だけ増える
    expect(s.round.chipPot).toBe(0);
    expect(s.nextRound?.chipPot).toBe(0);
    expect(s.players.reduce((n, p) => n + p.chips, 0)).toBe(60);
  });

  it("鳴き判断の時間切れは自動パス＋供託", () => {
    let s = act(game(JUNK_A, B_RON_HAND, C_RON_HAND, "8p"), "A", { type: "discard", drawn: true }, 1000);
    expect(s.stage).toBe("claim");
    expect(viewFor(s, "B").you?.overtimeFrom).toBe(31000);
    expect(nextDeadline(s)).toBe(91000);
    s = handleTimeout(s, 91000);
    expect(s.stage).toBe("discard");
    expect(s.turnSeat).toBe(1);
    expect(s.round.chipPot).toBe(2);
    expect(P(s, "B").chips).toBe(19);
    expect(P(s, "C").chips).toBe(19);
  });

  it("流局は繰り越し", () => {
    let s = handleTimeout(game(TENPAI, JUNK_B, JUNK_C, "", 3), 90000);
    s = playOut(s);
    expect(s.result?.kind).toBe("draw");
    expect(s.nextRound?.chipPot).toBe(1);
    for (const id of ["A", "B", "C"]) s = act(s, id, { type: "next_hand" });
    expect(s.round.chipPot).toBe(1);
  });

  it("チップが0になればバイイン（+20）。終局時の残りはトップへ、chipNet合計0", () => {
    let s = game(JUNK_A, TENPAI, JUNK_C, "", 5);
    s.players[0].chips = 1; // A は19枚負けている状態にする（Bへ）
    s.players[1].chips = 39;
    s.players[0].score = 200; // 親ノーテンで500払うとトビ
    s = handleTimeout(s, 90000);
    expect(P(s, "A").chips).toBe(20);
    expect(P(s, "A").buyins).toBe(2);
    expect(s.round.chipPot).toBe(1);
    const before = s.players.map((p) => p.chips);
    s = playOut(s);
    expect(s.stage).toBe("end");
    expect(s.round.chipPot).toBe(0);
    const f = s.final!;
    expect(Object.values(f.chipNet).reduce((a, b) => a + b, 0)).toBe(0);
    const top = Object.entries(f.scores).sort((x, y) => y[1] - x[1])[0][0];
    const ti = s.players.findIndex((p) => p.id === top);
    expect(s.players[ti].chips).toBe(before[ti] + 1);
  });
});

describe("R-46 フリテンリーチ", () => {
  it("フリテンでもリーチでき、ロンはできない", () => {
    // A は 5s/8s 待ち。5s をツモって切る（自分の捨て牌に待ち＝フリテン）
    let s = game(TENPAI, JUNK_B, JUNK_C, "5s 8s 3z");
    expect(viewFor(s, "A").you?.options.riichiDiscards).toContain(-1);
    s = act(s, "A", { type: "discard", drawn: true, riichi: true });
    expect(P(s, "A").riichi).toBe(true);
    expect(viewFor(s, "A").you?.furiten).toBe(true);
    s = act(s, "B", { type: "discard", drawn: true }); // 8s
    expect(s.stage).toBe("discard");
    expect(s.turnSeat).toBe(2);
  });
});

describe("R-47 オープンリーチ", () => {
  it("手牌が全員に公開され、立直に1翻加算", () => {
    let s = game(TENPAI, JUNK_B, JUNK_C, "1z 2z 3z 8s");
    expect(applyAction(s, "A", { type: "discard", drawn: true, open: true }).error).toBeTruthy();
    s = act(s, "A", { type: "discard", drawn: true, riichi: true, open: true });
    const vb = viewFor(s, "B");
    expect(vb.players[0].openHand?.map((t) => t.face)).toEqual(P(s, "A").hand.map((t) => t.face));
    expect(vb.players[1].openHand).toBeNull();
    s = act(s, "B", { type: "discard", drawn: true });
    s = act(s, "C", { type: "discard", drawn: true });
    expect(viewFor(s, "C").players[0].openHand?.length).toBe(13); // ツモ牌は含めない
    s = act(s, "A", { type: "tsumo" });
    const r = s.result!;
    if (r.kind !== "win") throw new Error("和了していない");
    expect(r.yaku).toContainEqual({ name: "ダブル立直", han: 2 });
    expect(r.yaku).toContainEqual({ name: "オープン立直", han: 1 });
  });
});

describe("view の新項目（D-07）", () => {
  it("親マーク・シャンテン・切るとテンパイになる牌", () => {
    const s = game(TENPAI, JUNK_B, JUNK_C, "1z");
    const v = viewFor(s, "A");
    expect(v.players.map((p) => p.isDealer)).toEqual([true, false, false]);
    expect(v.round?.chipPot).toBe(0);
    expect(v.you?.shanten).toBe(0);
    expect(v.you?.furiten).toBe(false);
    expect(v.you?.discardWaits).toContainEqual({ index: -1, waits: ["5s", "8s"] });
    // 9m を切ると 9m 単騎系にならずノーテン → 候補に入らない
    expect(v.you?.discardWaits.some((d) => d.index === 12)).toBe(false);
    expect(viewFor(s, "B").you?.discardWaits).toEqual([]); // 13枚の人は空
  });

  it("和了形は -1", () => {
    const s = game(TENPAI, JUNK_B, JUNK_C, "8s");
    expect(viewFor(s, "A").you?.shanten).toBe(-1);
  });
});
