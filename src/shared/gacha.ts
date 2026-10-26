// 雀霊カプセル（おまけのガチャ）。点数・精算には一切影響しないコレクション。要件 G-01〜G-09。
// データと純粋関数だけを置く（画面とサーバーで共用）。乱数は呼び出し側が渡す。

export const GACHA = {
  COST_NORMAL: 10, // 1回に使う雀霊コイン
  COST_YAKUMAN: 1, // 1回に使う役満コイン
  SPIRIT_RATE: 0.2, // 雀霊コイン：雀霊が出る確率（残りは装備）
  LEGEND_SPIRIT_RATE: 0.5, // 役満コイン：伝説の雀霊が出る確率（残りは伝説の装備）
  MAX_STAGE: 3, // 最大の進化段階
  SCORE_PER_COIN: 100, // 素点（百点単位）100＝1万点ごとに雀霊コイン1枚
  MIN_COIN_PER_GAME: 1, // 半荘ごとの最低枚数
  START: "2026-10-26T07:00:00.000Z", // これ以降に作られた半荘・役満だけ数える（既存DBの created_at と同じISO形式）
  INITIAL: { normal: 30, yakuman: 2 }, // 初期配布
  MULTI: 10, // 10連
} as const;

export type CoinType = "normal" | "yakuman";
export type CoinBalance = { normal: number; yakuman: number };
export type Rarity = "normal" | "legend";
export type SystemId = "tsumo" | "ron" | "dora";

export type GachaSystem = { id: SystemId; name: string; color: string };
export const SYSTEMS: Record<SystemId, GachaSystem> = {
  tsumo: { id: "tsumo", name: "ツモ系", color: "#2F9E6B" },
  ron: { id: "ron", name: "ロン系", color: "#D9534F" },
  dora: { id: "dora", name: "ドラ系", color: "#7A5AF0" },
};

export type Spirit = {
  id: string;
  system: SystemId;
  rarity: Rarity;
  /** [基本, 第1進化, 第2進化, 第3進化] */
  stages: [string, string, string, string];
  desc: string;
  color: string;
  itemIds: [string, string, string];
};

export type GachaItem = { id: string; spiritId: string; name: string; rarity: Rarity };

type Def = [id: string, system: SystemId, legend: boolean, stages: string, desc: string, items: string];
// stages / items は「・」区切り
const DEFS: Def[] = [
  ["tsumori", "tsumo", false, "ツモリタガリ・ツモリタガリ改・ツモリスギ・ツモリタガリ大王", "とにかく自分でツモりたい。ロンされると三日すねる。", "念力ハチマキ・ツモ指サック・気合いの手袋"],
  ["haitei", "tsumo", false, "ハイテイネライ・ハイテイマチ・ハイテイマニア・ハイテイノヌシ", "山の最後の1枚が大好物。序盤はずっと寝ている。", "砂時計・最後の一枚ルーペ・海底の貝殻"],
  ["rinshan", "tsumo", false, "リンシャンサガシ・リンシャンホリ・リンシャンモグラ・リンシャンハカセ", "王牌の下を掘りたがる。カンの音で目を覚ます。", "小さなスコップ・嶺上の花・ヘッドライト"],
  ["tsumogiri", "tsumo", false, "ツモギリマン・ツモギリマン2号・ツモギリマンZ・ツモギリマンΩ", "考える前に切る。速さだけは誰にも負けない。", "高速グローブ・風切りマント・ゴーグル"],
  ["yamanozoki", "tsumo", false, "ヤマノゾキ・ヤマクズシ・ヤマアラシ・ヤマノオヤブン", "山の向こうが気になって仕方ない。よく山を崩す。", "のぞき穴メガネ・山盛り帽子・崩れ止めテープ"],
  ["nagakangae", "tsumo", false, "ジカンギレ・ナガカンガエ・チョウコウシ・ムゲンチョウコウ", "持ち時間をいつも使い切る。本人は真剣。", "止まった時計・考える座布団・延長チケット"],
  ["tenhou", "tsumo", true, "テンホーミタガリ・テンホーネガイ・テンホーマネキ・テンホー大明神", "配牌の瞬間にだけ現れる伝説の雀霊。会えたら一生自慢できる。", "天の配牌札・金の招き手・雲の玉座"],
  ["riichi", "ron", false, "リーチカケタガリ・リーチカケスギ・ダブリーカケタガリ・リーチノオウ", "テンパイしたら即リーチ。千点棒がいつも足りない。", "千点棒ケース・リーチ宣言メガホン・横向き座布団"],
  ["furiten", "ron", false, "フリテンワスレ・フリテンウッカリ・フリテンゴマカシ・フリテンハクシ", "自分の捨て牌をすぐ忘れる。悪気はない。", "忘れんぼメモ帳・河見張りメガネ・反省のたすき"],
  ["damaten", "ron", false, "ダマテンヒソミ・ダマテンシノビ・ダマテンニンジャ・ダマテンカゲ", "黙って待つのが得意。気配を消しすぎて忘れられる。", "黒ずきん・忍び足ソックス・けむり玉"],
  ["hakoware", "ron", false, "ハコワレビビリ・ハコワレコワガリ・ハコワレオソレズ・ハコワレシラズ", "点棒が減ると震えだす。でも最後は開き直る。", "点棒まくら・ふるえ止めマフラー・勇気のバッジ"],
  ["pon", "ron", false, "ポンシタガリ・ポンポンポン・ポンダイショウ・ポンノジョウオウ", "ポンと言いたいだけ。役があるかは後で考える。", "ポン太鼓・副露トレイ・鳴きのハリセン"],
  ["yomisugi", "ron", false, "ヨミスギ・ヨミスギメガネ・ヨミスギハカセ・ヨミスギ仙人", "相手の待ちを読みすぎて自分が和了れない。", "分厚いメガネ・読み筋ノート・考えすぎ帽子"],
  ["raitei", "ron", true, "ロンノカミナリ・ロンノイカズチ・ロンノライジン・ロン雷帝", "ロンの声とともに落ちてくる伝説の雀霊。放銃した人はしびれる。", "雷の太鼓・稲妻の角・黄金の雲"],
  ["doranose", "dora", false, "ドラノセタガリ・ドラノセスギ・ドラマミレ・ドラノダイフゴウ", "ドラを乗せたがる。役より先にドラを数える。", "ドラ表示ルーペ・のせのせトレイ・ドラ貯金箱"],
  ["akadora", "dora", false, "アカドラアツメ・アカドラコレクター・アカドラマニア・アカドラ長者", "赤い牌を見ると目の色が変わる。部屋も真っ赤。", "赤い虫かご・コレクション帳・赤いマント"],
  ["kindora", "dora", false, "キンドラピカリ・キンドラキラリ・キンドラギラリ・キンドラ太陽", "金色に光りたい。まぶしくて誰も直視できない。", "金ぱくシール・ピカピカ布・サングラス"],
  ["peenuki", "dora", false, "ペーヌキタガリ・ペーヌキ・ペーヌキマスター・ペーヌキ将軍", "北が来たら即抜く。北以外もたまに抜こうとする。", "北の風見鶏・抜き取りピンセット・将軍のかぶと"],
  ["uradora", "dora", false, "ウラドラノゾキ・ウラドラミエル・ウラドラシンガン・ウラドラ千里眼", "裏ドラを先に見たがる。めくる前から目を細める。", "透視メガネ・めくり手袋・千里眼の水晶"],
  ["kandora", "dora", true, "カンドラフヤシ・カンドラバクハツ・カンドラビッグバン・カンドラ宇宙", "カンのたびにドラを増やす伝説の雀霊。卓が宇宙になる。", "爆発の導火線・星くずの袋・宇宙のかんむり"],
];

export const SPIRITS: Spirit[] = DEFS.map(([id, system, legend, stages, desc]) => ({
  id,
  system,
  rarity: legend ? "legend" : "normal",
  stages: stages.split("・") as Spirit["stages"],
  desc,
  color: SYSTEMS[system].color,
  itemIds: [0, 1, 2].map((i) => `${id}-${i + 1}`) as Spirit["itemIds"],
}));

export const ALL_ITEMS: GachaItem[] = DEFS.flatMap(([id, , legend, , , items]) =>
  items.split("・").map((name, i) => ({ id: `${id}-${i + 1}`, spiritId: id, name, rarity: (legend ? "legend" : "normal") as Rarity })),
);

export const STARTER_SPIRIT_ID = "tsumori";

const SPIRIT_BY_ID = new Map(SPIRITS.map((s) => [s.id, s]));
const ITEM_BY_ID = new Map(ALL_ITEMS.map((i) => [i.id, i]));
export const spiritById = (id: string): Spirit | undefined => SPIRIT_BY_ID.get(id);
export const itemById = (id: string): GachaItem | undefined => ITEM_BY_ID.get(id);

const NORMAL_SPIRITS = SPIRITS.filter((s) => s.rarity === "normal");
const LEGEND_SPIRITS = SPIRITS.filter((s) => s.rarity === "legend");
const NORMAL_ITEMS = ALL_ITEMS.filter((i) => i.rarity === "normal");
const LEGEND_ITEMS = ALL_ITEMS.filter((i) => i.rarity === "legend");

/**
 * 1回分の結果。kind=spirit は新しく雀霊を得た。kind=item は装備を得た
 * （converted=true は、すでに持っている雀霊が出たので専属装備に変わったもの）。
 */
export type PullResult = {
  coin: CoinType;
  kind: "spirit" | "item";
  spiritId: string;
  itemId: string | null;
  converted: boolean;
};

/** 半荘1回で得る雀霊コイン：素点（百点単位）1万点につき1枚・最低1枚 */
export function coinsForGame(scoreHundreds: number): number {
  return Math.max(GACHA.MIN_COIN_PER_GAME, Math.floor(scoreHundreds / GACHA.SCORE_PER_COIN));
}

/** 獲得コインの合計（初期配布＋半荘ごと＋役満ごと） */
export function earnedCoins(myScoresHundreds: number[], yakumanCount: number): CoinBalance {
  return {
    normal: GACHA.INITIAL.normal + myScoresHundreds.reduce((a, s) => a + coinsForGame(s), 0),
    yakuman: GACHA.INITIAL.yakuman + yakumanCount,
  };
}

/** 1回あたりの消費枚数 */
export function costPerPull(coin: CoinType): number {
  return coin === "normal" ? GACHA.COST_NORMAL : GACHA.COST_YAKUMAN;
}

/** 回数分の消費枚数 */
export function pullCost(coin: CoinType, count: number): number {
  return costPerPull(coin) * count;
}

/** これまでの結果から消費枚数を出す */
export function spentCoins(pulls: { coin: CoinType }[]): CoinBalance {
  const out: CoinBalance = { normal: 0, yakuman: 0 };
  for (const p of pulls) out[p.coin] += costPerPull(p.coin);
  return out;
}

export function coinBalance(earned: CoinBalance, spent: CoinBalance): CoinBalance {
  return { normal: earned.normal - spent.normal, yakuman: earned.yakuman - spent.yakuman };
}

const pick = <T>(list: T[], r: number): T => list[Math.min(list.length - 1, Math.max(0, Math.floor(r * list.length)))];

/**
 * 1回引く。r1=雀霊か装備か、r2=どれが出るか、r3=重複時に変える装備（いずれも 0以上1未満）。
 * ownedSpiritIds には初期キャラも含めること（buildCollection の spirits をそのまま渡せばよい）。
 */
export function rollPull(coin: CoinType, r1: number, r2: number, r3: number, ownedSpiritIds: readonly string[]): PullResult {
  const legend = coin === "yakuman";
  const spiritRate = legend ? GACHA.LEGEND_SPIRIT_RATE : GACHA.SPIRIT_RATE;
  if (r1 < spiritRate) {
    const s = pick(legend ? LEGEND_SPIRITS : NORMAL_SPIRITS, r2);
    if (ownedSpiritIds.includes(s.id)) return { coin, kind: "item", spiritId: s.id, itemId: pick(s.itemIds, r3), converted: true };
    return { coin, kind: "spirit", spiritId: s.id, itemId: null, converted: false };
  }
  const it = pick(legend ? LEGEND_ITEMS : NORMAL_ITEMS, r2);
  return { coin, kind: "item", spiritId: it.spiritId, itemId: it.id, converted: false };
}

/** 進化段階：雀霊を持っていて、専属装備3つをそれぞれ n 個以上持てば第 n 進化（最大 MAX_STAGE）。未所持は -1 */
export function spiritStage(spiritId: string, owned: readonly string[], items: Record<string, number>): number {
  const s = SPIRIT_BY_ID.get(spiritId);
  if (!s || !owned.includes(spiritId)) return -1;
  return Math.min(GACHA.MAX_STAGE, ...s.itemIds.map((id) => items[id] ?? 0));
}

export type Collection = {
  /** 所持している雀霊（初期キャラを含む・入手順） */
  spirits: string[];
  /** 装備ID → 所持数 */
  items: Record<string, number>;
  /** 所持している雀霊ID → 進化段階（0〜MAX_STAGE） */
  stages: Record<string, number>;
};

export function buildCollection(pulls: readonly PullResult[]): Collection {
  const spirits: string[] = [STARTER_SPIRIT_ID];
  const items: Record<string, number> = {};
  for (const p of pulls) {
    if (p.kind === "spirit") {
      if (!spirits.includes(p.spiritId)) spirits.push(p.spiritId);
    } else if (p.itemId) items[p.itemId] = (items[p.itemId] ?? 0) + 1;
  }
  const stages: Record<string, number> = {};
  for (const id of spirits) stages[id] = spiritStage(id, spirits, items);
  return { spirits, items, stages };
}
