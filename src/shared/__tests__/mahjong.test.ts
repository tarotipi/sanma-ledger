import { describe, expect, it } from "vitest";
import {
  calcBalances,
  calcGame,
  calcStats,
  calcTransfers,
  splitFee,
  validateGame,
} from "../mahjong";
import type { Adjustment, ChipEntry, Game, Score } from "../types";

const S = (a: number, b: number, c: number, ties?: [number?, number?, number?]): Score[] => [
  { memberId: "A", score: a, tie: ties?.[0] },
  { memberId: "B", score: b, tie: ties?.[1] },
  { memberId: "C", score: c, tie: ties?.[2] },
];

function byMember(scores: Score[], rate = 60) {
  const r = calcGame(scores, rate);
  const m = (id: string) => r.find((x) => x.memberId === id)!;
  return {
    pt: ["A", "B", "C"].map((id) => m(id).pt10 / 10),
    yen: ["A", "B", "C"].map((id) => m(id).yen),
    rank: ["A", "B", "C"].map((id) => m(id).rank),
  };
}

describe("受け入れテスト（要件定義書 §11、Excelと同じ値）", () => {
  it.each([
    [S(320, 780, -50), [-8, 63, -55], [-480, 3780, -3300]],
    [S(460, 180, 410), [31, -32, 1], [1860, -1920, 60]],
    [S(724, 336, -10), [57.4, -6.4, -51], [3444, -384, -3060]],
    [S(-1300, 1700, 650), [-180, 155, 25], [-10800, 9300, 1500]],
    [S(400, 400, 250, [1, 2]), [25, 0, -25], [1500, 0, -1500]],
    [S(400, 400, 250, [2, 1]), [0, 25, -25], [0, 1500, -1500]],
    [S(350, 350, 350, [1, 2, 3]), [20, -5, -15], [1200, -300, -900]],
  ])("%j", (scores, pt, yen) => {
    expect(validateGame(scores)).toEqual({ ok: true });
    const r = byMember(scores);
    expect(r.pt).toEqual(pt);
    expect(r.yen).toEqual(yen);
  });

  it("合計が105,000点でなければ保存できない", () => {
    expect(validateGame(S(320, 780, -40))).toEqual({ ok: false, reason: "total", diff: 10 });
  });

  it("同点で順位を指定していなければ保存できない", () => {
    expect(validateGame(S(400, 400, 250))).toEqual({ ok: false, reason: "tie_unresolved" });
    expect(validateGame(S(400, 400, 250, [1, 1]))).toEqual({ ok: false, reason: "tie_unresolved" });
  });

  it("同じ人を2回入れられない", () => {
    expect(
      validateGame([
        { memberId: "A", score: 350 },
        { memberId: "A", score: 350 },
        { memberId: "C", score: 350 },
      ]).ok,
    ).toBe(false);
  });

  it("ptと円の合計は常に0", () => {
    for (const s of [S(320, 780, -50), S(724, 336, -10), S(-1300, 1700, 650)]) {
      const r = calcGame(s, 50);
      expect(r.reduce((a, x) => a + x.pt10, 0)).toBe(0);
      expect(r.reduce((a, x) => a + x.yen, 0)).toBe(0);
    }
  });
});

const game = (id: string, seq: number, scores: Score[], rate = 60): Game => ({
  id,
  sessionId: "s",
  seq,
  rate,
  scores,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
});

describe("成績", () => {
  it("トップ率・連対率・連続トップ・飛び", () => {
    const games = [
      game("1", 1, S(320, 780, -50)),
      game("2", 2, S(460, 180, 410)),
      game("3", 3, S(724, 336, -10)),
    ];
    const st = calcStats(games);
    expect(st.A.games).toBe(3);
    expect(st.A.ranks).toEqual([2, 1, 0]);
    expect(st.A.topRate).toBeCloseTo(2 / 3);
    expect(st.A.rentaiRate).toBe(1);
    expect(st.A.maxTopStreak).toBe(2);
    expect(st.C.tobi).toBe(2);
    expect(st.C.maxLastStreak).toBe(1);
    expect(st.A.yen).toBe(-480 + 1860 + 3444);
  });
});

describe("精算", () => {
  const games = [game("1", 1, S(320, 780, -50)), game("2", 2, S(460, 180, 410))];
  const chips: ChipEntry[] = [
    {
      id: "c",
      sessionId: "s",
      memo: "",
      createdAt: "",
      deletedAt: null,
      lines: [
        { memberId: "A", count: 3 },
        { memberId: "B", count: -1 },
        { memberId: "C", count: -2 },
      ],
    },
  ];
  const adjustments: Adjustment[] = [
    {
      id: "x",
      sessionId: "s",
      kind: "external",
      memo: "場代",
      createdAt: "",
      deletedAt: null,
      lines: [{ memberId: "B", yen: -3000 }],
    },
  ];
  const b = calcBalances({ games, chips, adjustments, chipYen: 100 });

  it("最終収支＝麻雀＋チップ＋調整", () => {
    expect(b.A.mahjong).toBe(-480 + 1860);
    expect(b.A.chips).toBe(300);
    expect(b.B.total).toBe(3780 - 1920 - 100 - 3000);
  });

  it("送金は人数−1回以内で全員の残りが0。外部の調整は含めない", () => {
    const t = calcTransfers(b);
    expect(t.length).toBeLessThanOrEqual(2);
    const left: Record<string, number> = {};
    for (const x of Object.values(b)) left[x.memberId] = x.mahjong + x.chips + x.internal;
    for (const tr of t) {
      left[tr.from] += tr.yen;
      left[tr.to] -= tr.yen;
    }
    expect(Object.values(left).every((v) => v === 0)).toBe(true);
  });

  it("場代の割り振りは合計が金額と一致する", () => {
    const r = splitFee(1000, [
      { memberId: "A", weight: 1 },
      { memberId: "B", weight: 1 },
      { memberId: "C", weight: 1 },
    ]);
    expect(r.reduce((a, x) => a + x.yen, 0)).toBe(-1000);
    expect(r.map((x) => x.yen).sort()).toEqual([-333, -333, -334]);
    const byGames = splitFee(3000, [
      { memberId: "A", weight: 10 },
      { memberId: "B", weight: 5 },
    ]);
    expect(byGames).toEqual([
      { memberId: "A", yen: -2000 },
      { memberId: "B", yen: -1000 },
    ]);
  });
});
