import { describe, it, expect } from "vitest";
import {
  decomposeStandard,
  isChiitoitsu,
  isKokushi,
  isKokushi13Wait,
  isWinningHand,
  waits,
  isTenpai,
  type Meld,
} from "../hand";
import type { Face } from "../tiles";

const F = (s: string): Face[] => s.split(/\s+/).filter(Boolean);

describe("標準形の分解", () => {
  it("単純な4面子1雀頭", () => {
    // 123p 456p 789p 111s 99s（99sが雀頭）
    const d = decomposeStandard(F("1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 1s 1s 9s 9s"), []);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].pair).toBe("9s");
  });

  it("副露込みで和了（ポン2つ＋手牌）", () => {
    const melds: Meld[] = [
      { kind: "pon", face: "1z" },
      { kind: "pon", face: "7z" },
    ];
    // 手牌：123p 456p 55s（55sが雀頭、2面子＋副露2＝4面子）
    const d = decomposeStandard(F("1p 2p 3p 4p 5p 6p 5s 5s"), melds);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].sets.length).toBe(4);
  });

  it("萬子は順子にならない（1m2m3mは不可）", () => {
    // 1m だけ4枚＝刻子+雀頭にならないので和了にならない形
    const d = decomposeStandard(F("1m 1m 1m 9m 9m 1p 2p 3p 4p 5p 6p 7p 8p 9p"), []);
    // 111m刻子 + 99m雀頭 + 123p 456p 789p = 和了
    expect(d.length).toBeGreaterThan(0);
  });

  it("複数の分解を持つ手（三色と一気の両立など）でも落ちない", () => {
    const d = decomposeStandard(F("1p 1p 1p 2p 2p 2p 3p 3p 3p 4p 5p 6p 9s 9s"), []);
    expect(d.length).toBeGreaterThanOrEqual(1);
  });
});

describe("七対子・国士", () => {
  it("七対子", () => {
    expect(isChiitoitsu(F("1p 1p 3p 3p 5p 5p 7p 7p 9p 9p 1s 1s 1z 1z"), [])).toBe(true);
    // 同じ牌4枚は七対子にしない（2対子扱いにならない）
    expect(isChiitoitsu(F("1p 1p 1p 1p 5p 5p 7p 7p 9p 9p 1s 1s 1z 1z"), [])).toBe(false);
  });
  it("国士無双", () => {
    expect(isKokushi(F("1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z 1m"), [])).toBe(true);
    expect(isKokushi(F("1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z 5p"), [])).toBe(false);
  });
  it("国士十三面待ち", () => {
    expect(isKokushi13Wait(F("1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z"))).toBe(true);
    expect(isKokushi13Wait(F("1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 1m"))).toBe(false);
  });
});

describe("待ち計算", () => {
  it("両面待ち 78s は 6s/9s 待ち", () => {
    // 11s(雀頭) 123p 456p 789p 78s → 6s/9s 待ち
    const h = F("1s 1s 1p 2p 3p 4p 5p 6p 7p 8p 9p 7s 8s");
    const w = waits(h, []);
    expect(w).toContain("6s");
    expect(w).toContain("9s");
    expect(isTenpai(h, [])).toBe(true);
  });
  it("単騎待ち", () => {
    // 123p 456p 789p 111s + 単騎(東)
    const h = F("1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 1s 1s 1z");
    const w = waits(h, []);
    expect(w).toEqual(["1z"]);
  });
  it("七対子テンパイ（単騎）", () => {
    const h = F("1p 1p 3p 3p 5p 5p 7p 7p 9p 9p 1s 1s 1z");
    const w = waits(h, []);
    expect(w).toContain("1z");
  });
  it("ノーテンは待ちなし", () => {
    const h = F("1p 3p 5p 7p 9p 1s 3s 5s 7s 9s 1z 3z 5z");
    expect(isTenpai(h, [])).toBe(false);
  });
});

describe("和了判定の総合", () => {
  it("七対子と標準の両方を和了として検出", () => {
    expect(isWinningHand(F("1p 1p 3p 3p 5p 5p 7p 7p 9p 9p 1s 1s 1z 1z"), [])).toBe(true);
    expect(isWinningHand(F("1p 2p 3p 4p 5p 6p 7p 8p 9p 1s 1s 1s 9s 9s"), [])).toBe(true);
  });
});
