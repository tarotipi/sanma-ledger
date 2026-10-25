// 複数局を自動で打つ通しテスト。止まらないこと・各局で点数の合計が保たれることを確認する。
// 注意：全員が和了を狙わないと誰も40,000点を超えず、仕様（P-03）どおり西場が続くため、
// ここでは「終局まで」ではなく「一定局数」を打って確認する。
import { describe, it, expect } from "vitest";
import { createGame, applyAction, viewFor, type GameState } from "../engine";
import type { GameAction } from "../protocol";

const PLAYERS = [
  { id: "A", name: "A" },
  { id: "B", name: "B" },
  { id: "C", name: "C" },
];

/** 今できる操作を1つ選ぶ（和了→パス→花を抜く→リーチ→ツモ切り→次局） */
function pickAction(state: GameState, id: string): GameAction | null {
  const v = viewFor(state, id);
  const o = v.you?.options;
  if (!o) return null;
  if (o.tsumo) return { type: "tsumo" };
  if (o.ron) return { type: "ron" };
  if (o.pass) return { type: "pass" };
  if (o.nuki) return { type: "nuki" };
  if (o.riichi && o.riichiDiscards.length) {
    const i = o.riichiDiscards[0];
    return i === -1 ? { type: "discard", drawn: true, riichi: true } : { type: "discard", index: i, riichi: true };
  }
  if (o.discard) return v.you?.drawn ? { type: "discard", drawn: true } : { type: "discard", index: 0 };
  if (o.nextHand) return { type: "next_hand" };
  return null;
}

function totalPoints(s: GameState): number {
  const v = viewFor(s, "A");
  const sum = v.players.reduce((a, p) => a + p.score, 0);
  return sum + (v.round?.riichiSticks ?? 0) * 1000;
}

describe("複数局の通し（自動打ち）", () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`seed ${seed}：8局打っても止まらず、点数合計（供託込み）は常に105,000`, () => {
      let s = createGame(PLAYERS, { seed, now: 0 });
      let hands = 0;
      let wins = 0;
      for (let step = 0; step < 6000 && hands < 8; step++) {
        const v = viewFor(s, "A");
        if (v.phase === "game_end") break;
        let moved = false;
        for (const p of PLAYERS) {
          const a = pickAction(s, p.id);
          if (!a) continue;
          const before = viewFor(s, "A").phase;
          const r = applyAction(s, p.id, a, 0);
          if (r.error) continue;
          s = r.state;
          moved = true;
          const after = viewFor(s, "A");
          if (before === "playing" && (after.phase === "hand_end" || after.phase === "game_end")) {
            hands++;
            if (after.result?.kind === "win") wins++;
            expect(totalPoints(s)).toBe(105000);
          }
          break;
        }
        expect(moved).toBe(true);
      }
      expect(hands).toBeGreaterThan(0);
      void wins;
    }, 60000);
  }

  it("画面用の状態作成（viewFor）が十分速い（1回あたり20ms未満）", () => {
    const s = createGame(PLAYERS, { seed: 5, now: 0 });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) viewFor(s, "A");
    const per = (performance.now() - t0) / 50;
    expect(per).toBeLessThan(20);
  });
});
