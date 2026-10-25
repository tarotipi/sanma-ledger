import { describe, it, expect } from "vitest";
import {
  buildWall,
  parseTiles,
  parseTile,
  toFaceCounts,
  nextFace,
  isTerminalOrHonor,
  ALL_FACES,
  HAKU,
} from "../tiles";
import { rankFromHan, bumpRank, dealerPay, childPay } from "../rules";

describe("牌セットの構成（R-01, R-12, R-13, R-30）", () => {
  const { tiles, flowers } = buildWall();

  it("牌は108枚＋花4枚＝112枚", () => {
    expect(tiles.length).toBe(108);
    expect(flowers.length).toBe(4);
  });

  it("面は27種そろう", () => {
    const faces = new Set(tiles.map((t) => t.face));
    expect(faces.size).toBe(ALL_FACES.length);
    for (const f of ALL_FACES) expect(faces.has(f)).toBe(true);
  });

  it("萬子は1と9だけ、各4枚", () => {
    const c = toFaceCounts(tiles);
    expect(c.get("1m")).toBe(4);
    expect(c.get("9m")).toBe(4);
    // 2m〜8mは存在しない
    for (let n = 2; n <= 8; n++) expect(c.get(`${n}m`)).toBeUndefined();
  });

  it("各面はちょうど4枚ずつ", () => {
    const c = toFaceCounts(tiles);
    for (const f of ALL_FACES) expect(c.get(f)).toBe(4);
  });

  it("赤5は6枚（筒索 各3）、金5は2枚（各1）", () => {
    const red = tiles.filter((t) => t.red);
    const gold = tiles.filter((t) => t.gold);
    expect(red.length).toBe(6);
    expect(gold.length).toBe(2);
    expect(red.every((t) => t.face === "5p" || t.face === "5s")).toBe(true);
    expect(gold.every((t) => t.face === "5p" || t.face === "5s")).toBe(true);
    // 5p/5sはすべて赤か金（普通の5は無い）
    for (const face of ["5p", "5s"]) {
      const fives = tiles.filter((t) => t.face === face);
      expect(fives.length).toBe(4);
      expect(fives.filter((t) => t.red).length).toBe(3);
      expect(fives.filter((t) => t.gold).length).toBe(1);
    }
  });

  it("白ポッチは1枚、通常の白は3枚", () => {
    const whites = tiles.filter((t) => t.face === HAKU);
    expect(whites.length).toBe(4);
    expect(whites.filter((t) => t.pocchi).length).toBe(1);
    expect(whites.filter((t) => !t.pocchi).length).toBe(3);
  });
});

describe("パーサ", () => {
  it("特性フラグを読む", () => {
    expect(parseTile("r5p")).toMatchObject({ face: "5p", red: true });
    expect(parseTile("g5s")).toMatchObject({ face: "5s", gold: true });
    expect(parseTile("w5z")).toMatchObject({ face: "5z", pocchi: true });
    expect(parseTile("1z")).toMatchObject({ face: "1z" });
  });
  it("不正な記法は例外", () => {
    expect(() => parseTile("5m")).toThrow(); // 萬子5は無い
    expect(() => parseTile("w1z")).toThrow(); // 白ポッチは白のみ
    expect(() => parseTile("r5m")).toThrow(); // 赤は筒索5のみ
    expect(() => parseTile("8z")).toThrow();
  });
  it("複数牌を配列に", () => {
    expect(parseTiles("1m 9m r5p").length).toBe(3);
  });
});

describe("ドラの次の牌（R-10）", () => {
  it("数牌は9の次が1、萬子は1↔9", () => {
    expect(nextFace("1p")).toBe("2p");
    expect(nextFace("9p")).toBe("1p");
    expect(nextFace("1m")).toBe("9m");
    expect(nextFace("9m")).toBe("1m");
  });
  it("風は北の次が東、三元は中の次が白", () => {
    expect(nextFace("4z")).toBe("1z"); // 北→東
    expect(nextFace("7z")).toBe("5z"); // 中→白
    expect(nextFace("5z")).toBe("6z"); // 白→發
  });
});

describe("么九判定", () => {
  it("1・9・字牌が么九", () => {
    expect(isTerminalOrHonor("1p")).toBe(true);
    expect(isTerminalOrHonor("9s")).toBe(true);
    expect(isTerminalOrHonor("1z")).toBe(true);
    expect(isTerminalOrHonor("5p")).toBe(false);
  });
});

describe("翻→ランク（R-41）と夏のランクアップ（R-21）", () => {
  it("境界", () => {
    expect(rankFromHan(1)).toBe("1han");
    expect(rankFromHan(3)).toBe("3han");
    expect(rankFromHan(4)).toBe("mangan");
    expect(rankFromHan(5)).toBe("mangan");
    expect(rankFromHan(6)).toBe("haneman");
    expect(rankFromHan(8)).toBe("baiman");
    expect(rankFromHan(11)).toBe("sanbaiman");
    expect(rankFromHan(13)).toBe("sanbaiman");
    expect(rankFromHan(14)).toBe("yakuman"); // 数え役満
  });
  it("夏は1段上げ、3翻以下は満貫へ", () => {
    expect(bumpRank("2han")).toBe("mangan");
    expect(bumpRank("mangan")).toBe("haneman");
    expect(bumpRank("sanbaiman")).toBe("yakuman");
    expect(bumpRank("yakuman")).toBe("yakuman");
  });
});

describe("点数表（R-42。画像の値と一致）", () => {
  it("親", () => {
    expect(dealerPay("1han")).toEqual({ ron: 2000, tsumoEach: 1000 });
    expect(dealerPay("3han")).toEqual({ ron: 6000, tsumoEach: 3000 });
    expect(dealerPay("mangan")).toEqual({ ron: 12000, tsumoEach: 6000 });
    expect(dealerPay("yakuman")).toEqual({ ron: 48000, tsumoEach: 24000 });
  });
  it("子", () => {
    expect(childPay("3han")).toEqual({ ron: 4000, tsumoFromChild: 1000, tsumoFromDealer: 3000 });
    expect(childPay("mangan")).toEqual({ ron: 8000, tsumoFromChild: 3000, tsumoFromDealer: 5000 });
    expect(childPay("yakuman")).toEqual({ ron: 32000, tsumoFromChild: 12000, tsumoFromDealer: 20000 });
  });
});
