import { describe, it, expect } from "vitest";
import {
  GACHA,
  SPIRITS,
  ALL_ITEMS,
  STARTER_SPIRIT_ID,
  coinsForGame,
  earnedCoins,
  rollPull,
  buildCollection,
  coinBalance,
  spentCoins,
  pullCost,
  spiritById,
  itemById,
  type PullResult,
} from "../gacha";

describe("データ", () => {
  it("20体・60装備・IDが一意", () => {
    expect(SPIRITS).toHaveLength(20);
    expect(ALL_ITEMS).toHaveLength(60);
    expect(new Set(SPIRITS.map((s) => s.id)).size).toBe(20);
    expect(new Set(ALL_ITEMS.map((i) => i.id)).size).toBe(60);
    expect(new Set([...SPIRITS.map((s) => s.id), ...ALL_ITEMS.map((i) => i.id)]).size).toBe(80);
  });
  it("各雀霊は4段階の名前と専属装備3つ。伝説は各系統1体", () => {
    for (const s of SPIRITS) {
      expect(s.stages.every((n) => n.length > 0)).toBe(true);
      expect(new Set(s.stages).size).toBe(4);
      expect(s.itemIds.map((id) => itemById(id)?.spiritId)).toEqual([s.id, s.id, s.id]);
    }
    const legends = SPIRITS.filter((s) => s.rarity === "legend");
    expect(legends).toHaveLength(3);
    expect(new Set(legends.map((s) => s.system)).size).toBe(3);
    expect(spiritById(STARTER_SPIRIT_ID)?.rarity).toBe("normal");
  });
});

describe("coinsForGame / earnedCoins", () => {
  it("素点1万点につき1枚・最低1枚", () => {
    expect(coinsForGame(0)).toBe(1);
    expect(coinsForGame(-120)).toBe(1);
    expect(coinsForGame(99)).toBe(1);
    expect(coinsForGame(100)).toBe(1);
    expect(coinsForGame(199)).toBe(1);
    expect(coinsForGame(200)).toBe(2);
    expect(coinsForGame(520)).toBe(5);
  });
  it("初期配布を足す", () => {
    expect(earnedCoins([], 0)).toEqual(GACHA.INITIAL);
    expect(earnedCoins([520, 0], 3)).toEqual({ normal: GACHA.INITIAL.normal + 6, yakuman: GACHA.INITIAL.yakuman + 3 });
  });
  it("消費と残高", () => {
    const pulls = [{ coin: "normal" as const }, { coin: "normal" as const }, { coin: "yakuman" as const }];
    expect(spentCoins(pulls)).toEqual({ normal: 20, yakuman: 1 });
    expect(pullCost("normal", GACHA.MULTI)).toBe(100);
    expect(pullCost("yakuman", GACHA.MULTI)).toBe(10);
    expect(coinBalance({ normal: 30, yakuman: 2 }, { normal: 20, yakuman: 1 })).toEqual({ normal: 10, yakuman: 1 });
  });
});

describe("rollPull", () => {
  const none = [STARTER_SPIRIT_ID];
  it("雀霊コイン：r1<0.2 で通常の雀霊、0.2以上で通常の装備", () => {
    const a = rollPull("normal", 0.1999, 0.5, 0, none);
    expect(a.kind).toBe("spirit");
    expect(spiritById(a.spiritId)?.rarity).toBe("normal");
    const b = rollPull("normal", 0.2, 0.5, 0, none);
    expect(b.kind).toBe("item");
    expect(itemById(b.itemId!)?.rarity).toBe("normal");
    expect(b.converted).toBe(false);
  });
  it("雀霊コインでは伝説は出ない（r2の端まで）", () => {
    for (const r2 of [0, 0.3, 0.6, 0.9999]) {
      expect(spiritById(rollPull("normal", 0, r2, 0, none).spiritId)?.rarity).toBe("normal");
      expect(itemById(rollPull("normal", 0.9, r2, 0, none).itemId!)?.rarity).toBe("normal");
    }
  });
  it("役満コイン：r1<0.5 で伝説の雀霊、0.5以上で伝説の装備", () => {
    const a = rollPull("yakuman", 0.4999, 0.9999, 0, none);
    expect(a.kind).toBe("spirit");
    expect(spiritById(a.spiritId)?.rarity).toBe("legend");
    const b = rollPull("yakuman", 0.5, 0, 0, none);
    expect(b.kind).toBe("item");
    expect(itemById(b.itemId!)?.rarity).toBe("legend");
  });
  it("持っている雀霊が出たら、その専属装備のどれかに変わる（r3で選ぶ）", () => {
    const first = rollPull("normal", 0, 0, 0, none);
    expect(first.spiritId).toBe(STARTER_SPIRIT_ID); // 先頭は初期キャラ＝重複
    expect(first.kind).toBe("item");
    expect(first.converted).toBe(true);
    expect(first.itemId).toBe(`${STARTER_SPIRIT_ID}-1`);
    expect(rollPull("normal", 0, 0, 0.9999, none).itemId).toBe(`${STARTER_SPIRIT_ID}-3`);
    const leg = rollPull("yakuman", 0, 0, 0.5, none);
    const again = rollPull("yakuman", 0, 0, 0.5, [...none, leg.spiritId]);
    expect(again.converted).toBe(true);
    expect(itemById(again.itemId!)?.spiritId).toBe(leg.spiritId);
  });
});

describe("buildCollection（進化段階）", () => {
  const item = (id: string): PullResult => ({ coin: "normal", kind: "item", spiritId: id.split("-")[0], itemId: id, converted: false });
  it("初期キャラだけを所持・段階0", () => {
    const c = buildCollection([]);
    expect(c.spirits).toEqual([STARTER_SPIRIT_ID]);
    expect(c.stages[STARTER_SPIRIT_ID]).toBe(0);
  });
  it("専属装備3つをそれぞれ n 個以上で第 n 進化、最大3", () => {
    const s = STARTER_SPIRIT_ID;
    const one = [item(`${s}-1`), item(`${s}-2`), item(`${s}-3`)];
    expect(buildCollection(one.slice(0, 2)).stages[s]).toBe(0);
    expect(buildCollection(one).stages[s]).toBe(1);
    expect(buildCollection([...one, ...one, item(`${s}-1`)]).stages[s]).toBe(2);
    expect(buildCollection([...one, ...one, ...one, ...one, ...one]).stages[s]).toBe(GACHA.MAX_STAGE);
  });
  it("雀霊を持っていなければ装備がそろっても進化しない", () => {
    const c = buildCollection([item("raitei-1"), item("raitei-2"), item("raitei-3")]);
    expect(c.stages.raitei).toBeUndefined();
    expect(c.items["raitei-1"]).toBe(1);
    const got = buildCollection([{ coin: "yakuman", kind: "spirit", spiritId: "raitei", itemId: null, converted: false }, item("raitei-1"), item("raitei-2"), item("raitei-3")]);
    expect(got.stages.raitei).toBe(1);
  });
});
