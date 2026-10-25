// 三麻の牌の表現。要件 R-01, R-12, R-13, R-30, §2.3。
// ここは「牌とは何か」だけを扱う純粋なモジュール。和了判定や点数は別ファイル。

/** 牌の種類（スート）。m=萬子(1,9のみ), p=筒子, s=索子, z=字牌 */
export type Suit = "m" | "p" | "s" | "z";

/**
 * 字牌の番号：1東 2南 3西 4北 5白 6發 7中
 * 萬子は 1 と 9 のみ。筒子・索子は 1〜9。
 */

/** 面（牌の見た目の種類）。赤・金・白ポッチの違いは含まない＝面子を作るときの等価判定に使う */
export type Face = string; // 例 "1m" "9m" "1p".."9p" "1s".."9s" "1z".."7z"

/** 花の種類。春夏秋冬。手牌には入らず、抜いて公開する（§2.3） */
export type Flower = "spring" | "summer" | "autumn" | "winter";

/** 物理的な1枚の牌。face は見た目、red/gold/pocchi は特性 */
export interface Tile {
  face: Face;
  /** 赤5（R-12） */
  red?: boolean;
  /** 金5（R-13） */
  gold?: boolean;
  /** 白ポッチ（R-30）。face は "5z"（白）として扱う */
  pocchi?: boolean;
  /** 山・配牌で個体を区別するためのID（Phase2で使う）。ロジックの等価判定には使わない */
  id?: number;
}

// ---- 面の定義 ----

export const MAN_FACES: Face[] = ["1m", "9m"];
export const PIN_FACES: Face[] = ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"];
export const SOU_FACES: Face[] = ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s"];
/** 字牌 1東 2南 3西 4北 5白 6發 7中 */
export const HONOR_FACES: Face[] = ["1z", "2z", "3z", "4z", "5z", "6z", "7z"];

/** この三麻で使う全ての面（27種） */
export const ALL_FACES: Face[] = [...MAN_FACES, ...PIN_FACES, ...SOU_FACES, ...HONOR_FACES];

/** 么九牌（1・9・字牌）の面かどうか。流し役満・国士・混老頭などで使う */
export function isTerminalOrHonor(face: Face): boolean {
  if (face[1] === "z") return true;
  const n = Number(face[0]);
  return n === 1 || n === 9;
}

/** 字牌か */
export function isHonor(face: Face): boolean {
  return face[1] === "z";
}

/** 数牌か（m/p/s） */
export function isSuited(face: Face): boolean {
  return face[1] !== "z";
}

/** 風牌か（東南西北） */
export function isWind(face: Face): boolean {
  return face[1] === "z" && Number(face[0]) >= 1 && Number(face[0]) <= 4;
}

/** 三元牌か（白發中） */
export function isDragon(face: Face): boolean {
  return face[1] === "z" && Number(face[0]) >= 5 && Number(face[0]) <= 7;
}

export const HAKU: Face = "5z"; // 白
export const PEI: Face = "4z"; // 北

/** 面の表示名（和了画面・デバッグ用） */
export function faceName(face: Face): string {
  const names: Record<Face, string> = {
    "1z": "東",
    "2z": "南",
    "3z": "西",
    "4z": "北",
    "5z": "白",
    "6z": "發",
    "7z": "中",
  };
  if (face in names) return names[face];
  const suit = face[1] === "m" ? "萬" : face[1] === "p" ? "筒" : "索";
  return `${face[0]}${suit}`;
}

// ---- ドラ表示牌 → ドラの面（R-10） ----

/** ドラ表示牌の「次の牌」を返す。数牌は9の次が1、風は北の次が東、三元は中の次が白 */
export function nextFace(face: Face): Face {
  const n = Number(face[0]);
  const suit = face[1];
  if (suit === "z") {
    if (n <= 4) return `${(n % 4) + 1}z`; // 東→南→西→北→東
    return `${((n - 5 + 1) % 3) + 5}z`; // 白→發→中→白
  }
  // 数牌。ただし萬子は1と9しかないので 1m↔9m を行き来させる
  if (suit === "m") return face === "1m" ? "9m" : "1m";
  return `${(n % 9) + 1}${suit}`;
}

// ---- パーサ（テスト・デバッグ用） ----
// 記法：<rank><suit>。先頭に特性フラグ r=赤, g=金, w=白ポッチ を付けられる。
//   "5p" 普通の5筒 / "r5p" 赤5筒 / "g5s" 金5索 / "w5z" 白ポッチ / "1z" 東 ...
// 空白区切りで複数。

/** 1トークンを Tile に。不正なら例外 */
export function parseTile(token: string): Tile {
  let t = token.trim();
  const tile: Tile = { face: "" };
  while (t.length && (t[0] === "r" || t[0] === "g" || t[0] === "w")) {
    if (t[0] === "r") tile.red = true;
    else if (t[0] === "g") tile.gold = true;
    else if (t[0] === "w") tile.pocchi = true;
    t = t.slice(1);
  }
  if (t.length !== 2) throw new Error(`牌の記法が不正: "${token}"`);
  const rank = Number(t[0]);
  const suit = t[1];
  if (!["m", "p", "s", "z"].includes(suit)) throw new Error(`スートが不正: "${token}"`);
  if (suit === "z" && (rank < 1 || rank > 7)) throw new Error(`字牌が不正: "${token}"`);
  if (suit === "m" && rank !== 1 && rank !== 9) throw new Error(`萬子は1と9のみ: "${token}"`);
  if ((suit === "p" || suit === "s") && (rank < 1 || rank > 9)) throw new Error(`数牌が不正: "${token}"`);
  tile.face = `${rank}${suit}`;
  if (tile.pocchi && tile.face !== HAKU) throw new Error(`白ポッチは白(5z)のみ: "${token}"`);
  if ((tile.red || tile.gold) && !(tile.face === "5p" || tile.face === "5s")) {
    throw new Error(`赤・金は5筒/5索のみ: "${token}"`);
  }
  return tile;
}

/** 空白区切りの文字列を Tile[] に */
export function parseTiles(str: string): Tile[] {
  return str
    .split(/\s+/)
    .filter((s) => s.length)
    .map(parseTile);
}

/** Tile[] を面ごとの枚数マップに（赤金白ポッチの別は無視）。和了判定で使う */
export function toFaceCounts(tiles: Tile[]): Map<Face, number> {
  const m = new Map<Face, number>();
  for (const t of tiles) m.set(t.face, (m.get(t.face) ?? 0) + 1);
  return m;
}

// ---- 山の構成（R-01, R-12, R-13, R-30, §2.3） ----

export interface WallBuild {
  /** 手牌・山に入る牌（花を除く）。計108枚 */
  tiles: Tile[];
  /** 花牌。計4枚 */
  flowers: Flower[];
}

/**
 * この三麻の全牌を作る（シャッフル前）。
 * - 萬子 1,9 ×4、筒子・索子 1〜9 ×4（5p/5sは赤3・金1）、字牌 ×4（白は通常3・白ポッチ1）
 * - 計108枚＋花4枚＝112枚。白ポッチは白の置き換えなので総数は増えない（R-30）
 */
export function buildWall(): WallBuild {
  const tiles: Tile[] = [];
  const push = (face: Face, attr?: Partial<Tile>) => tiles.push({ face, ...attr });

  for (const f of MAN_FACES) for (let i = 0; i < 4; i++) push(f);

  for (const suit of ["p", "s"] as const) {
    for (let n = 1; n <= 9; n++) {
      const face = `${n}${suit}`;
      if (n === 5) {
        // 5は赤3・金1（R-12, R-13）
        push(face, { red: true });
        push(face, { red: true });
        push(face, { red: true });
        push(face, { gold: true });
      } else {
        for (let i = 0; i < 4; i++) push(face);
      }
    }
  }

  for (const f of HONOR_FACES) {
    if (f === HAKU) {
      // 白は通常3枚＋白ポッチ1枚（R-30）
      push(HAKU);
      push(HAKU);
      push(HAKU);
      push(HAKU, { pocchi: true });
    } else {
      for (let i = 0; i < 4; i++) push(f);
    }
  }

  const flowers: Flower[] = ["spring", "summer", "autumn", "winter"];
  return { tiles, flowers };
}
