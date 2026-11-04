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
  ["tsumori", "tsumo", false, "新人 月森 凛・連荘の 月森 凛・卓の主 月森 凛・ツモの女王 月森 凛", "引きの強さだけで雀荘に居座る新人。ロンされると三日口をきかない。", "念力のハチマキ・月森のリング・勝負の手袋"],
  ["haitei", "tsumo", false, "居眠りの 海堂 蓮・終盤の 海堂 蓮・海底の 海堂 蓮・海底の主 海堂 蓮", "序盤は寝ているのに、山の最後の1枚でだけ目を覚ます男。", "砂時計・海底の貝殻・潮風のカフス"],
  ["rinshan", "tsumo", false, "発掘好きの 花村 詩織・嶺上の 花村 詩織・花開く 花村 詩織・嶺上の女帝 花村 詩織", "カンの音が聞こえると機嫌が良くなる。王牌の下に何かあると信じている。", "小さなスコップ・嶺上の花・探検のランプ"],
  ["tsumogiri", "tsumo", false, "せっかちな 早瀬 隼人・疾風の 早瀬 隼人・音速の 早瀬 隼人・無想の 早瀬 隼人", "考える前に切る。速さだけは誰にも負けないが、当たり牌もよく切る。", "高速グローブ・風切りのゴーグル・秒針の時計"],
  ["yamanozoki", "tsumo", false, "覗き見の 高嶺 美月・山崩しの 高嶺 美月・高嶺の 高嶺 美月・山の女王 高嶺 美月", "山の向こうが気になって仕方ない。よく覗き込んで山を崩す。", "のぞき穴メガネ・崩れ止めテープ・山頂の髪飾り"],
  ["nagakangae", "tsumo", false, "長考の 長谷川 悠・沈思の 長谷川 悠・熟慮の 長谷川 悠・無限長考の 長谷川 悠", "持ち時間をいつも使い切る。本人はいたって真剣で、周りは全員寝ている。", "止まった時計・考える座布団・延長チケット"],
  ["tenhou", "tsumo", true, "天の 天音 麗華・天運の 天音 麗華・天和の 天音 麗華・天和の女神 天音 麗華", "配牌の瞬間にだけ姿を見せる伝説の雀士。会えたら一生自慢できる。", "天の配牌札・金の招き手・雲の玉座"],
  ["riichi", "ron", false, "即リーチの 立花 蒼・一発の 立花 蒼・ダブルの 立花 蒼・立直の王 立花 蒼", "テンパイしたら即リーチ。千点棒がいつも足りない。", "千点棒ケース・宣言のメガホン・勝負のネクタイ"],
  ["furiten", "ron", false, "うっかり 忘野 紗季・忘れんぼの 忘野 紗季・とぼけた 忘野 紗季・振聴の才媛 忘野 紗季", "自分の捨て牌をすぐ忘れる。悪気はないので誰も強く言えない。", "忘れんぼメモ帳・河見張りメガネ・反省のたすき"],
  ["damaten", "ron", false, "静かな 影山 静・潜む 影山 静・忍びの 影山 静・影の女王 影山 静", "黙って待つのが得意。気配を消しすぎて、卓にいることを忘れられる。", "黒いストール・忍び足のヒール・煙の香水"],
  ["hakoware", "ron", false, "びびりの 箱崎 剛・崖っぷちの 箱崎 剛・開き直りの 箱崎 剛・不死身の 箱崎 剛", "点棒が減ると震えだす。追い詰められると開き直って急に強くなる。", "点棒まくら・ふるえ止めマフラー・勇気のバッジ"],
  ["pon", "ron", false, "元気な 鳴海 ぽぷり・鳴きの 鳴海 ぽぷり・速攻の 鳴海 ぽぷり・鳴きの女王 鳴海 ぽぷり", "ポンと言いたいだけ。役があるかは後で考える。", "ポン太鼓・副露トレイ・鳴きのハリセン"],
  ["yomisugi", "ron", false, "読みすぎの 読谷 怜・分析の 読谷 怜・千里の 読谷 怜・読みの仙人 読谷 怜", "相手の待ちを読みすぎて自分が和了れない。読みは8割当たる。", "分厚いメガネ・読み筋ノート・考えすぎ帽子"],
  ["raitei", "ron", true, "雷の 雷堂 迅・轟く 雷堂 迅・雷神の 雷堂 迅・ロン雷帝 雷堂 迅", "ロンの声とともに現れる伝説の雀士。放銃した人はしばらく動けない。", "雷の太鼓・稲妻の角・黄金の雲"],
  ["doranose", "dora", false, "欲張りの 乗松 絢香・満貫の 乗松 絢香・跳満の 乗松 絢香・ドラの大富豪 乗松 絢香", "役より先にドラを数える。とにかく手に乗せたがる。", "ドラ表示ルーペ・のせのせトレイ・ドラ貯金箱"],
  ["akadora", "dora", false, "赤好きの 赤羽 真紅・赤揃えの 赤羽 真紅・真紅の 赤羽 真紅・赤の長者 赤羽 真紅", "赤い牌を見ると目の色が変わる。部屋も服も真っ赤。", "赤いコレクション帳・赤の虫かご・真紅のマント"],
  ["kindora", "dora", false, "ピカピカの 金城 輝・きらめく 金城 輝・輝く 金城 輝・太陽の 金城 輝", "金色に光りたい男。まぶしくて誰も直視できない。", "金ぱくシール・ピカピカ布・金縁サングラス"],
  ["peenuki", "dora", false, "北好きの 北条 冬馬・抜きの 北条 冬馬・北風の 北条 冬馬・北の将軍 北条 冬馬", "北が来たら即抜く。北以外もたまに抜こうとする。", "北の風見鶏・抜き取りピンセット・将軍のかぶと"],
  ["uradora", "dora", false, "のぞき好きの 裏辻 千里・めくりの 裏辻 千里・透視の 裏辻 千里・千里眼の 裏辻 千里", "裏ドラを先に見たがる。めくる前から目を細めている。", "透視メガネ・めくりの手袋・千里眼の水晶"],
  ["kandora", "dora", true, "カンの 神楽 宙・爆ぜる 神楽 宙・星の 神楽 宙・カンドラの覇王 神楽 宙", "カンのたびにドラを増やす伝説の雀士。卓が宇宙のように光りだす。", "爆発の導火線・星くずの袋・宇宙のかんむり"],
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

/** 画像の種類。card＝大きい立ち絵、thumb＝一覧、face＝顔の切り抜き */
export type ArtKind = "card" | "thumb" | "face";

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
  // 回した後で半荘や役満を消すと獲得が減るので、残高がマイナスにならないようにする
  return { normal: Math.max(0, earned.normal - spent.normal), yakuman: Math.max(0, earned.yakuman - spent.yakuman) };
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
