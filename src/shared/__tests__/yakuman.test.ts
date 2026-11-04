import { describe, expect, it } from "vitest";
import { fitSize, isRetryableStatus, yakumanToLink } from "../yakuman";

describe("yakumanToLink", () => {
  const scores = [{ memberId: "a" }, { memberId: "b" }, { memberId: "c" }];
  it("卓にいる人の役満だけを紐づける", () => {
    const waiting = [
      { id: "y1", memberId: "a" },
      { id: "y2", memberId: "d" },
      { id: "y3", memberId: "c" },
    ];
    expect(yakumanToLink(waiting, scores)).toEqual(["y1", "y3"]);
  });
  it("同じ人の役満が2件あれば両方紐づける", () => {
    const waiting = [
      { id: "y1", memberId: "a" },
      { id: "y2", memberId: "a" },
    ];
    expect(yakumanToLink(waiting, scores)).toEqual(["y1", "y2"]);
  });
  it("待っている役満がなければ空", () => {
    expect(yakumanToLink([], scores)).toEqual([]);
  });
});

describe("fitSize", () => {
  it("長辺を上限にそろえて比率を保つ", () => {
    expect(fitSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3024, 4032, 320)).toEqual({ width: 240, height: 320 });
  });
  it("小さい写真は拡大しない", () => {
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it("大きさが取れない画像でも0にしない", () => {
    expect(fitSize(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe("isRetryableStatus", () => {
  it("通信エラー・サーバー側の失敗・役満の到着待ちは送り直す", () => {
    for (const s of [0, 404, 408, 429, 500, 503]) expect(isRetryableStatus(s)).toBe(true);
  });
  it("内容の問題は送り直さない", () => {
    for (const s of [400, 401, 403, 409, 413]) expect(isRetryableStatus(s)).toBe(false);
  });
});
