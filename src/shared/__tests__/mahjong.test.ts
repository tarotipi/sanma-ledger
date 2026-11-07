import { describe, expect, it } from "vitest";
import {
  calcBalances,
  calcGame,
  calcStats,
  calcTransfers,
  splitFee,
  splitFeeByResult,
  suggestNext,
  validateGame,
} from "../mahjong";
import type { Adjustment, ChipEntry, ChipEvent, Game, Score } from "../types";

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

describe("チップ（バイイン方式）", () => {
  const ev = (memberId: string, kind: ChipEvent["kind"], amount: number, t: string): ChipEvent => ({
    id: memberId + kind + t,
    sessionId: "s",
    memberId,
    kind,
    amount,
    createdAt: t,
    deletedAt: null,
  });
  it("枚数×単価 − バイイン ＋ 返却。最新の枚数だけが有効", () => {
    const b = calcBalances({
      games: [],
      chips: [],
      adjustments: [],
      chipYen: 100,
      chipEvents: [
        ev("A", "buy", 2000, "1"),
        ev("B", "buy", 2000, "1"),
        ev("A", "buy", 1000, "2"), // Aが追加でバイイン
        ev("B", "return", 1000, "3"), // Bが増えすぎた分を返却
        ev("A", "count", 99, "4"),
        ev("A", "count", 5, "5"),
        ev("B", "count", 35, "5"),
      ],
    });
    expect(b.A.chips).toBe(5 * 100 - 3000);
    expect(b.B.chips).toBe(35 * 100 - 2000 + 1000);
    expect(b.A.chipCount).toBe(5);
    // チップが保存されていれば合計0（買った額−返した額＝最後の枚数の合計）
    expect(b.A.chips + b.B.chips).toBe(0);
  });
  it("枚数未入力は null", () => {
    const b = calcBalances({ games: [], chips: [], adjustments: [], chipYen: 100, chipEvents: [ev("A", "buy", 1000, "1")] });
    expect(b.A.chipCount).toBeNull();
    expect(b.A.chips).toBe(-1000);
  });
});

describe("抜け番の提案", () => {
  const G = (seq: number, ids: string[]): Game => ({
    id: String(seq),
    sessionId: "s",
    seq,
    rate: 60,
    scores: [
      { memberId: ids[0], score: 400 },
      { memberId: ids[1], score: 350 },
      { memberId: ids[2], score: 300 },
    ],
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  });
  const order = ["A", "B", "C", "D", "E"];
  it("3人だけならそのまま", () => {
    expect(suggestNext([G(1, ["A", "B", "C"])], order)?.sitOut).toEqual([]);
  });
  it("Dが途中参加したあと、A→B→C→D→A の順で抜ける回り方を続ける", () => {
    const games = [G(1, ["A", "B", "C"]), G(2, ["A", "B", "C"]), G(3, ["B", "C", "D"])]; // 3半荘目はDが入りAが抜けた
    expect(suggestNext(games, order)?.sitOut).toEqual(["B"]);
    games.push(G(4, ["A", "C", "D"]));
    expect(suggestNext(games, order)?.sitOut).toEqual(["C"]);
    games.push(G(5, ["A", "B", "D"]));
    expect(suggestNext(games, order)?.sitOut).toEqual(["D"]);
    games.push(G(6, ["A", "B", "C"]));
    expect(suggestNext(games, order)?.sitOut).toEqual(["A"]);
  });
  it("別の順番で回っていればその順番を読み取る", () => {
    const games = [G(1, ["A", "B", "D"]), G(2, ["B", "C", "D"]), G(3, ["A", "B", "C"])]; // C→A→D の順で抜けた
    expect(suggestNext(games, order)?.sitOut).toEqual(["B"]);
    games.push(G(4, ["A", "C", "D"]));
    expect(suggestNext(games, order)?.sitOut).toEqual(["C"]);
  });
  it("5人なら2人抜ける。精算済みで帰った人は候補から外す", () => {
    const games = [G(1, ["A", "B", "C"]), G(2, ["C", "D", "E"]), G(3, ["A", "B", "E"])];
    expect(suggestNext(games, order)?.sitOut.length).toBe(2);
    expect(suggestNext(games, order, new Set(["E", "D"]))?.players.sort()).toEqual(["A", "B", "C"]);
  });
});

describe("場代を収支に応じて分ける（F-40）", () => {
  type Row = [string, number, number, number?, boolean?];
  const R = (...rows: Row[]) => rows.map(([memberId, day, lifetime, games = 10, settled = false]) => ({ memberId, day, lifetime, games, settled }));
  const yen = (x: ReturnType<typeof splitFeeByResult>) => x.map((r) => r.yen);
  it.each([
    ["10/19 1回目", R(["ド", 26200, 0, 36], ["赤", 3050, 0, 32], ["太", 3050, 0, 39], ["亀", -32300, 0, 46]), [4000, 1000, 1000, 0]],
    ["10/19 2回目", R(["赤", 18350, 3050, 44], ["亀", -9100, -32300, 44], ["太", -9250, 3050, 44]), [6000, 0, 0]],
    ["10/25", R(["赤", 28350, 21400, 31], ["亀", -4100, -41400, 31], ["ド", -24250, 26200, 31]), [6000, 0, 0]],
    ["10/28", R(["太", 13800, -6200, 12], ["ド", 13550, 1950, 28], ["赤", -4950, 49750, 40], ["亀", -22400, -45500, 40]), [1800, 2400, 1800, 0]],
    ["11/01", R(["太", 27900, 7600, 66], ["赤", 7850, 44800, 66], ["亀", -35750, -67900, 66]), [3500, 2500, 0]],
    ["11/04", R(["太", 12150, 35500, 45], ["赤", -800, 52650, 45], ["ド", -3250, 15500, 24], ["亀", -8100, -103650, 45]), [3300, 2200, 500, 0]],
  ])("過去の対局の試算どおり：%s", (_, rows, want) => {
    expect(yen(splitFeeByResult(6000, rows))).toEqual(want);
  });
  it("当日30,000円以上の人がいれば、その人だけが払う", () => {
    expect(yen(splitFeeByResult(6000, R(["A", 30000, 0], ["B", 2000, 100000], ["C", -32000, 0])))).toEqual([6000, 0, 0]);
  });
  it("30,000円以上が2人なら、その2人で分ける", () => {
    const r = splitFeeByResult(6000, R(["A", 35000, 0], ["B", 30000, 0], ["C", -65000, 0]));
    expect(r[2].yen).toBe(0);
    expect(r[0].yen + r[1].yen).toBe(6000);
    expect(r[0].yen).toBeGreaterThan(r[1].yen);
  });
  it("通算の補正は、勝ちが25%で上限+15,000円、負けが5%で上限−5,000円", () => {
    const big = splitFeeByResult(1000, R(["A", 0, 10000000], ["B", 0, 0]));
    expect(big[0].weight).toBe(20000);
    expect(big[1].weight).toBe(5000);
    expect(splitFeeByResult(1000, R(["A", 0, 50000], ["B", 0, 0]))[0].weight).toBe(17500);
    expect(splitFeeByResult(1000, R(["A", 0, -50000], ["B", 0, 0]))[0].weight).toBe(2500);
    expect(splitFeeByResult(1000, R(["A", 1000, -10000000], ["B", 1000, 0]))[0].weight).toBe(1000);
  });
  it("通算+50,000なら当日−15,000でも数百円払う。上限を超えて負けた日は払わない", () => {
    expect(yen(splitFeeByResult(6000, R(["A", -15000, 50000], ["B", 10000, 0], ["C", 5000, 0])))).toEqual([500, 3300, 2200]);
    expect(yen(splitFeeByResult(6000, R(["A", -25000, 200000], ["B", 15000, 0], ["C", 10000, 0])))).toEqual([0, 3400, 2600]);
  });
  it("打った半荘が少ない人は軽い（一番多い人が1倍、半分の人が0.75倍）", () => {
    const r = splitFeeByResult(1000, R(["A", 5000, 0, 40], ["B", 5000, 0, 20]));
    expect(r[0].weight).toBe(10000);
    expect(r[1].weight).toBe(7500);
  });
  it("前回の精算を済ませた人は重みが2割軽い", () => {
    const r = splitFeeByResult(1000, R(["A", 5000, 0, 10, true], ["B", 5000, 0, 10, false]));
    expect(r[0].weight).toBe(8000);
    expect(r[1].weight).toBe(10000);
  });
  it("全員の重みが0なら均等に分ける", () => {
    expect(yen(splitFeeByResult(3000, R(["A", -6000, 0], ["B", -6000, 0], ["C", -6000, 0])))).toEqual([1000, 1000, 1000]);
  });
  it("100円単位で分け、余りは一番勝っている人に足す。合計は場代と一致する", () => {
    const r = splitFeeByResult(6050, R(["A", 10000, 0], ["B", 5000, 0], ["C", -15000, 0]));
    expect(r.reduce((a, x) => a + x.yen, 0)).toBe(6050);
    expect(r[1].yen % 100).toBe(0);
    expect(r[0].yen % 100).toBe(50);
  });
  it("金額が0か対象者がいなければ空", () => {
    expect(splitFeeByResult(0, R(["A", 1, 0]))).toEqual([]);
    expect(splitFeeByResult(1000, [])).toEqual([]);
  });
});
