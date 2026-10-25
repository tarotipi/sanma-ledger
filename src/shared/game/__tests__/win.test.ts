import { describe, it, expect } from "vitest";
import { analyzeWin, type WinContext, type WinAnalysis } from "../yaku";
import { settleWin, settleDraw, rankOf } from "../score";
import { chipBreakdown, settleChips } from "../chips";
import { resolveWin } from "../win";
import { parseTiles } from "../tiles";
import type { Meld } from "../hand";

const P: [string, string, string] = ["A", "B", "C"];

function baseCtx(over: Partial<WinContext>): WinContext {
  return {
    hand: [],
    melds: [],
    winTile: "1p",
    winBy: "tsumo",
    seatWind: "1z",
    roundWind: "1z",
    doraIndicators: [],
    ...over,
  };
}

describe("通常役の集計", () => {
  it("リーチ＋ツモ＋平和＝3翻", () => {
    const ctx = baseCtx({
      hand: parseTiles("1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 8s 9m 9m"),
      winTile: "4s",
      winBy: "tsumo",
      riichi: true,
    });
    const a = analyzeWin(ctx);
    expect(a.valid).toBe(true);
    expect(a.yakuman).toBe(0);
    const names = a.yaku.map((y) => y.name);
    expect(names).toContain("立直");
    expect(names).toContain("門前清自摸和");
    expect(names).toContain("平和");
    expect(a.han).toBe(3);
  });

  it("北は全員の役牌（R-06）", () => {
    const ctx = baseCtx({
      hand: parseTiles("4z 4z 4z 1p 2p 3p 4p 5p 6p 2s 3s 4s 9m 9m"),
      winTile: "9m",
      winBy: "ron",
      seatWind: "2z",
      roundWind: "1z",
    });
    const a = analyzeWin(ctx);
    expect(a.valid).toBe(true);
    expect(a.yaku.map((y) => y.name)).toContain("北");
  });

  it("北をポンしていても北の役牌で和了れる（R-06）", () => {
    const melds: Meld[] = [{ kind: "pon", face: "4z" }];
    const ctx = baseCtx({
      hand: parseTiles("1p 2p 3p 7p 8p 9p 2s 3s 4s 9m 9m"),
      melds,
      winTile: "9m",
      winBy: "ron",
      seatWind: "2z",
    });
    const a = analyzeWin(ctx);
    expect(a.valid).toBe(true);
    expect(a.yaku.map((y) => y.name)).toContain("北");
  });

  it("喰いタンは有効（R-07）", () => {
    const melds: Meld[] = [{ kind: "pon", face: "4p" }];
    const ctx = baseCtx({
      hand: parseTiles("2s 3s 4s 6s 7s 8s 2p 3p 4p 5s 5s"),
      melds,
      winTile: "4p",
      winBy: "ron",
    });
    const a = analyzeWin(ctx);
    expect(a.valid).toBe(true);
    expect(a.yaku.map((y) => y.name)).toContain("断么九");
  });

  it("ドラだけで役が無ければ無効（和了不可）", () => {
    const melds: Meld[] = [{ kind: "pon", face: "1m" }];
    const ctx = baseCtx({
      hand: parseTiles("2p 3p 4p 4p 5p 6p 6p 7p 8p 9s 9s"),
      melds,
      winTile: "4p",
      winBy: "ron",
      doraIndicators: ["1p"], // 2pがドラ
    });
    const a = analyzeWin(ctx);
    expect(a.valid).toBe(false);
  });
});

describe("役満", () => {
  it("大三元", () => {
    const ctx = baseCtx({
      hand: parseTiles("5z 5z 5z 6z 6z 6z 7z 7z 7z 2p 3p 4p 9m 9m"),
      winTile: "2p",
      winBy: "tsumo",
    });
    const a = analyzeWin(ctx);
    expect(a.yakuman).toBeGreaterThanOrEqual(1);
    expect(a.yakumanNames).toContain("大三元");
  });

  it("国士無双十三面＝ダブル役満（S-08）", () => {
    const ctx = baseCtx({
      hand: parseTiles("1m 1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z"),
      winTile: "1m",
      winBy: "ron",
    });
    const a = analyzeWin(ctx);
    expect(a.yakuman).toBe(2);
    expect(a.yakumanNames).toContain("国士無双十三面");
  });

  it("四暗刻単騎＝ダブル役満（S-08）", () => {
    // 111p 333p 555s 777s + 東単騎、ロンで雀頭完成
    const ctx = baseCtx({
      hand: parseTiles("1p 1p 1p 3p 3p 3p 5s 5s 5s 7s 7s 7s 1z 1z"),
      winTile: "1z",
      winBy: "ron",
    });
    const a = analyzeWin(ctx);
    expect(a.yakuman).toBe(2);
    expect(a.yakumanNames).toContain("四暗刻単騎");
  });

  it("清一色七対子＝役満（R-07b）", () => {
    const ctx = baseCtx({
      hand: parseTiles("1p 1p 2p 2p 3p 3p 4p 4p 6p 6p 7p 7p 9p 9p"),
      winTile: "9p",
      winBy: "tsumo",
    });
    const a = analyzeWin(ctx);
    expect(a.yakuman).toBe(1);
    expect(a.yakumanNames).toContain("清一色七対子");
  });
});

describe("夏のランクアップ（R-21）と翻→ランク", () => {
  const mkA = (over: Partial<WinAnalysis>): WinAnalysis => ({
    valid: true,
    yakuman: 0,
    yakumanNames: [],
    han: 0,
    yaku: [],
    dora: { aka: 0, gold: 0, omote: 0, ura: 0, autumn: 0 },
    chips: { ura: 0, gold: 0, spring: 0, winter: 0, ippatsu: false, pocchi: false },
    summer: false,
    ...over,
  });
  it("満貫(5翻)＋夏→跳満", () => {
    expect(rankOf(mkA({ han: 5, summer: true })).rank).toBe("haneman");
  });
  it("3翻＋夏→満貫", () => {
    expect(rankOf(mkA({ han: 3, summer: true })).rank).toBe("mangan");
  });
  it("三倍満(13翻)＋夏→役満扱い", () => {
    expect(rankOf(mkA({ han: 13, summer: true })).rank).toBe("yakuman");
  });
  it("ダブル役満は倍数2", () => {
    const r = rankOf(mkA({ yakuman: 2 }));
    expect(r.rank).toBe("yakuman");
    expect(r.multiplier).toBe(2);
  });
});

describe("点数表どおりの支払い（R-42）", () => {
  const mkA = (han: number): WinAnalysis => ({
    valid: true,
    yakuman: 0,
    yakumanNames: [],
    han,
    yaku: [],
    dora: { aka: 0, gold: 0, omote: 0, ura: 0, autumn: 0 },
    chips: { ura: 0, gold: 0, spring: 0, winter: 0, ippatsu: false, pocchi: false },
    summer: false,
  });

  it("子の満貫ロン＝放銃者が8000", () => {
    const r = settleWin({
      analysis: mkA(5),
      winBy: "ron",
      honba: 0,
      riichiSticks: 0,
      dealerId: "C",
      winnerId: "A",
      discarderId: "B",
      players: P,
    });
    expect(r.deltas.A).toBe(8000);
    expect(r.deltas.B).toBe(-8000);
    expect(r.deltas.C).toBe(0);
  });

  it("親の満貫ツモ＝子が各6000", () => {
    const r = settleWin({
      analysis: mkA(5),
      winBy: "tsumo",
      honba: 0,
      riichiSticks: 0,
      dealerId: "A",
      winnerId: "A",
      players: P,
    });
    expect(r.deltas.A).toBe(12000);
    expect(r.deltas.B).toBe(-6000);
    expect(r.deltas.C).toBe(-6000);
  });

  it("子の満貫ツモ＝親5000・子3000", () => {
    const r = settleWin({
      analysis: mkA(5),
      winBy: "tsumo",
      honba: 0,
      riichiSticks: 0,
      dealerId: "B",
      winnerId: "A",
      players: P,
    });
    expect(r.deltas.A).toBe(8000);
    expect(r.deltas.B).toBe(-5000); // 親
    expect(r.deltas.C).toBe(-3000); // 子
  });

  it("本場と供託（子ロン・1本場・リーチ棒1）", () => {
    const r = settleWin({
      analysis: mkA(1),
      winBy: "ron",
      honba: 1,
      riichiSticks: 1,
      dealerId: "C",
      winnerId: "A",
      discarderId: "B",
      players: P,
    });
    // 1翻子ロン1000 + 本場300…ではなく本場1000（R-45）＝放銃者が+1000
    expect(r.deltas.B).toBe(-2000); // 1000 + 1000(本場)
    expect(r.deltas.A).toBe(3000); // 2000 + 供託1000
  });

  it("合計は常に0", () => {
    const r = settleWin({
      analysis: mkA(3),
      winBy: "tsumo",
      honba: 2,
      riichiSticks: 0,
      dealerId: "B",
      winnerId: "A",
      players: P,
    });
    expect(r.deltas.A + r.deltas.B + r.deltas.C).toBe(0);
  });
});

describe("流局のテンパイ料（R-45）", () => {
  it("1人聴牌＝他2人から合計1000", () => {
    const d = settleDraw({ tenpai: ["A"], players: P });
    expect(d.A).toBe(1000);
    expect(d.B).toBe(-500);
    expect(d.C).toBe(-500);
  });
  it("全員聴牌は授受なし", () => {
    const d = settleDraw({ tenpai: ["A", "B", "C"], players: P });
    expect(d.A + d.B + d.C).toBe(0);
    expect(d.A).toBe(0);
  });
});

describe("チップ（祝儀）C-03, C-04", () => {
  it("内訳の合計", () => {
    const b = chipBreakdown({ ura: 2, gold: 1, spring: 0, winter: 0, ippatsu: true, pocchi: false });
    expect(b.total).toBe(4); // 裏2 + 金1 + 一発1
  });
  it("ロンは放銃者が全額、ツモは他家が各全額", () => {
    const chips = { ura: 2, gold: 1, spring: 0, winter: 0, ippatsu: true, pocchi: false };
    const ron = settleChips({ chips, winBy: "ron", winnerId: "A", discarderId: "B", players: P });
    expect(ron.A).toBe(4);
    expect(ron.B).toBe(-4);
    expect(ron.C).toBe(0);
    const tsumo = settleChips({ chips, winBy: "tsumo", winnerId: "A", players: P });
    expect(tsumo.A).toBe(8);
    expect(tsumo.B).toBe(-4);
    expect(tsumo.C).toBe(-4);
  });
});

describe("白ポッチはドラ対象外（R-35）", () => {
  it("万能で和了牌(4s)として使っても、4sドラに数えない", () => {
    const hand = parseTiles("1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 8s 9m 9m");
    const common = { hand, winTile: "4s", winBy: "tsumo" as const, riichi: true, doraIndicators: ["3s"] };
    const normal = analyzeWin(baseCtx(common)); // 4sがドラ1枚
    const pocchi = analyzeWin(baseCtx({ ...common, pocchiWin: true }));
    expect(normal.dora.omote).toBe(1);
    expect(pocchi.dora.omote).toBe(0);
  });
});

describe("resolveWin 総合", () => {
  it("点数もチップも合計0、白ポッチ和了でチップ1", () => {
    const ctx = baseCtx({
      hand: parseTiles("1p 2p 3p 7p 8p 9p 2s 3s 4s 6s 7s 8s 9m 9m"),
      winTile: "4s",
      winBy: "tsumo",
      riichi: true,
      pocchiWin: true,
    });
    const r = resolveWin(ctx, {
      honba: 0,
      riichiSticks: 0,
      dealerId: "A",
      winnerId: "A",
      players: P,
    });
    expect(r.valid).toBe(true);
    expect(r.score.deltas.A + r.score.deltas.B + r.score.deltas.C).toBe(0);
    expect(r.chips.A).toBe(2); // 白ポッチ1 × 他家2人（ツモ）
    expect(r.chips.A + r.chips.B + r.chips.C).toBe(0);
  });
});
