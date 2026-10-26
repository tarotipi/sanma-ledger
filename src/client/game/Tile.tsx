// 牌をSVGで描く（D-01〜D-04）。外部画像は使わない。
// 縦 30×40 の座標で描き、横向き（リーチ宣言牌・鳴いた牌）は回転して 40×30 にする。

import type { ReactElement } from "react";
import type { Face, Flower, Tile as TileT } from "../../shared/game/tiles";

export type TileSize = "xs" | "sm" | "md" | "lg" | "fluid";

export interface TileProps {
  /** 物理牌（赤・金・白ポッチの情報つき） */
  tile?: TileT | null;
  /** 面だけ（待ち牌・ドラ表示など） */
  face?: Face;
  flower?: Flower;
  /** 裏向き */
  back?: boolean;
  /** 横向き（リーチ宣言牌など） */
  sideways?: boolean;
  size?: TileSize;
  /** 薄く表示（鳴かれた捨て牌など） */
  dim?: boolean;
  /** ドラの印（右上の金色の点。D-07） */
  dora?: boolean;
  className?: string;
  title?: string;
}

const COLOR = {
  pin: "#1f5fae",
  sou: "#18794a",
  man: "#1b1b1b",
  red: "#d0312d",
  gold: "#c08a0a",
  goldLight: "#f3d27a",
  face: "#fbf8ee",
  edge: "#c9c1a8",
  back: "#1d6b55",
  backEdge: "#0f4a3a",
};

// 数牌は標準配置（D-08）。左上に小さな数字を入れるので、左上の角（x<7, y<9）には絵を置かない。
type PinKey = "b" | "r" | "g";

/** 筒子（2〜9）：中心座標・半径・色 */
const PIN_LAYOUT: Record<number, { r: number; dots: [number, number, PinKey][] }> = {
  2: {
    r: 6,
    dots: [
      [15, 13, "b"],
      [15, 29.5, "g"],
    ],
  },
  3: {
    r: 4.6,
    dots: [
      [9, 12.5, "b"],
      [15, 21, "r"],
      [21, 29.5, "g"],
    ],
  },
  4: {
    r: 5,
    dots: [
      [9.5, 13.5, "b"],
      [20.5, 13.5, "g"],
      [9.5, 28.5, "g"],
      [20.5, 28.5, "b"],
    ],
  },
  5: {
    r: 4.3,
    dots: [
      [9, 12.5, "b"],
      [21, 12.5, "g"],
      [15, 21, "r"],
      [9, 29.5, "g"],
      [21, 29.5, "b"],
    ],
  },
  6: {
    r: 4,
    dots: [
      [10, 11.5, "g"],
      [20, 11.5, "g"],
      [10, 23, "r"],
      [20, 23, "r"],
      [10, 31.5, "r"],
      [20, 31.5, "r"],
    ],
  },
  7: {
    r: 3.5,
    dots: [
      [8.5, 10.5, "g"],
      [15, 13.5, "g"],
      [21.5, 16.5, "g"],
      [10, 25, "r"],
      [20, 25, "r"],
      [10, 33, "r"],
      [20, 33, "r"],
    ],
  },
  8: {
    r: 3.4,
    dots: [
      [10, 10.5, "b"],
      [20, 10.5, "b"],
      [10, 18, "b"],
      [20, 18, "b"],
      [10, 25.5, "b"],
      [20, 25.5, "b"],
      [10, 33, "b"],
      [20, 33, "b"],
    ],
  },
  9: {
    r: 3.4,
    dots: [
      [8, 11.5, "b"],
      [15, 11.5, "b"],
      [22, 11.5, "b"],
      [8, 21, "r"],
      [15, 21, "r"],
      [22, 21, "r"],
      [8, 30.5, "g"],
      [15, 30.5, "g"],
      [22, 30.5, "g"],
    ],
  },
};

type SouKey = "g" | "r";

/** 索子（2〜9）：竹1本ずつの中心・高さ・色・傾き（度。省略で垂直） */
const SOU_LAYOUT: Record<number, { w: number; sticks: [number, number, number, SouKey, number?][] }> = {
  2: {
    w: 3.4,
    sticks: [
      [15, 14, 10, "g"],
      [15, 29, 10, "g"],
    ],
  },
  3: {
    w: 3.4,
    sticks: [
      [15, 14, 10, "g"],
      [10, 29, 10, "g"],
      [20, 29, 10, "g"],
    ],
  },
  4: {
    w: 3.4,
    sticks: [
      [10, 14, 10, "g"],
      [20, 14, 10, "g"],
      [10, 29, 10, "g"],
      [20, 29, 10, "g"],
    ],
  },
  5: {
    w: 3.4,
    sticks: [
      [9, 14, 10, "g"],
      [21, 14, 10, "g"],
      [15, 21.5, 10, "r"],
      [9, 29, 10, "g"],
      [21, 29, 10, "g"],
    ],
  },
  // 6索：太い竹を縦3本×2段（8索の傾いた形と見分けられるよう、まっすぐ・太め）
  6: {
    w: 4.4,
    sticks: [
      [9, 14.5, 11, "g"],
      [15, 14.5, 11, "g"],
      [21, 14.5, 11, "g"],
      [9, 29.5, 11, "g"],
      [15, 29.5, 11, "g"],
      [21, 29.5, 11, "g"],
    ],
  },
  // 7索：上に赤1本、下に緑3本×2段
  7: {
    w: 3.4,
    sticks: [
      [15, 10.5, 7, "r"],
      [9, 21.5, 8, "g"],
      [15, 21.5, 8, "g"],
      [21, 21.5, 8, "g"],
      [9, 31, 8, "g"],
      [15, 31, 8, "g"],
      [21, 31, 8, "g"],
    ],
  },
  // 8索：実物と同じく上段は山形（M字）、下段は谷形（W字）に傾ける。6索と形で見分けられる
  8: {
    w: 3,
    sticks: [
      [8, 14.5, 11, "g", 22],
      [12.6, 14.5, 11, "g", -22],
      [17.4, 14.5, 11, "g", 22],
      [22, 14.5, 11, "g", -22],
      [8, 29.5, 11, "g", -22],
      [12.6, 29.5, 11, "g", 22],
      [17.4, 29.5, 11, "g", -22],
      [22, 29.5, 11, "g", 22],
    ],
  },
  9: {
    w: 3.4,
    sticks: [
      [9, 12.5, 8, "g"],
      [15, 12.5, 8, "r"],
      [21, 12.5, 8, "g"],
      [9, 22, 8, "g"],
      [15, 22, 8, "r"],
      [21, 22, 8, "g"],
      [9, 31.5, 8, "g"],
      [15, 31.5, 8, "r"],
      [21, 31.5, 8, "g"],
    ],
  },
};

const HONOR_CHAR: Record<string, string> = { "1": "東", "2": "南", "3": "西", "4": "北", "6": "發", "7": "中" };
const FLOWER_CHAR: Record<Flower, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
const FLOWER_COLOR: Record<Flower, string> = { spring: "#c2417a", summer: "#d0602d", autumn: "#a8551c", winter: "#2b5fa8" };
/** 手牌・ツモ牌の花は face が "f1"〜"f4"（engine の表現） */
const FLOWER_OF_FACE: Record<string, Flower> = { f1: "spring", f2: "summer", f3: "autumn", f4: "winter" };

/** 物理牌が花なら花の種類を返す */
export function flowerOfTile(t: TileT | null | undefined): Flower | null {
  if (!t) return null;
  return FLOWER_OF_FACE[t.face] ?? null;
}

const PIN_COLOR: Record<PinKey, string> = { b: COLOR.pin, r: COLOR.red, g: COLOR.sou };
const SOU_COLOR: Record<SouKey, string> = { g: COLOR.sou, r: COLOR.red };

/** 数牌の左上の小さな数字（D-08） */
function cornerNumber(n: number, color: string): ReactElement {
  return (
    <text x={2.3} y={7.9} fontSize={7} fontWeight={800} fontFamily="system-ui,-apple-system,sans-serif" fill={color}>
      {n}
    </text>
  );
}

/** 1筒：大きな多重円（緑・青・赤の同心円＋花びら）。白ポッチ（白地に小さな点）と見間違えないように */
function pinOne(tint: string | null): ReactElement {
  const outer = tint ?? COLOR.sou;
  const mid = tint ?? COLOR.pin;
  const core = tint ?? COLOR.red;
  const petals = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i;
    return <circle key={i} cx={15 + Math.cos(a) * 8.4} cy={21 + Math.sin(a) * 8.4} r={1.7} fill={core} />;
  });
  return (
    <g>
      <circle cx={15} cy={21} r={11.2} fill="none" stroke={outer} strokeWidth={1.8} />
      {petals}
      <circle cx={15} cy={21} r={6.2} fill="none" stroke={mid} strokeWidth={1.8} />
      <circle cx={15} cy={21} r={3.8} fill={core} />
      <circle cx={15} cy={21} r={1.3} fill={COLOR.face} />
    </g>
  );
}

function pinFace(n: number, tint: string | null): ReactElement {
  if (n === 1) return pinOne(tint);
  const { r, dots } = PIN_LAYOUT[n];
  return (
    <g>
      {dots.map(([x, y, k], i) => {
        const c = tint ?? PIN_COLOR[k];
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill="none" stroke={c} strokeWidth={1.3} />
            <circle cx={x} cy={y} r={r * 0.5} fill={c} />
          </g>
        );
      })}
    </g>
  );
}

/** 1索の尾羽：付け根（B）からの角度（度。0=右、負=上）と長さ */
const SOU1_TAIL_BASE: [number, number] = [17.2, 25];
const SOU1_FEATHERS: [number, number][] = [
  [-86, 15.5],
  [-62, 16.5],
  [-38, 13.6],
  [-14, 11.2],
  [10, 10],
];

/** 尾羽1枚（付け根から先へ細長い葉の形）と、先の目玉模様の位置 */
function featherPath(angleDeg: number, len: number): { d: string; spot: [number, number] } {
  const [bx, by] = SOU1_TAIL_BASE;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy;
  const ny = dx;
  const tip: [number, number] = [bx + dx * len, by + dy * len];
  const half = 2.3;
  const mid = 0.62;
  const c1: [number, number] = [bx + dx * len * mid + nx * half, by + dy * len * mid + ny * half];
  const c2: [number, number] = [bx + dx * len * mid - nx * half, by + dy * len * mid - ny * half];
  const f = (p: [number, number]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  const d = `M${f(SOU1_TAIL_BASE)} Q${f(c1)} ${f(tip)} Q${f(c2)} ${f(SOU1_TAIL_BASE)} Z`;
  return { d, spot: [bx + dx * len * 0.72, by + dy * len * 0.72] };
}

/** 1索：竹にとまる鳥（緑の体・赤い冠と胸・扇のように広がる尾羽）。赤牌・金牌の tint なら単色で描く */
function souOne(tint: string | null): ReactElement {
  const body = tint ?? COLOR.sou;
  const light = tint ?? "#2f9d63";
  const red = tint ?? COLOR.red;
  const beak = tint ?? COLOR.gold;
  const leg = tint ?? "#8a5a2b";
  // 単色のときは翼や目玉模様を地の色の線で描き分ける
  const detail = tint ? COLOR.face : "#0e5233";
  return (
    <g>
      {/* 尾羽（体の後ろ） */}
      {SOU1_FEATHERS.map(([ang, len], i) => {
        const { d, spot } = featherPath(ang, len);
        return (
          <g key={i}>
            <path d={d} fill={i % 2 === 0 ? body : light} />
            <circle cx={spot[0]} cy={spot[1]} r={1.15} fill={tint ? COLOR.face : red} />
            {tint && <circle cx={spot[0]} cy={spot[1]} r={0.55} fill={tint} />}
          </g>
        );
      })}
      {/* とまり木の竹 */}
      <rect x={8.5} y={35.2} width={14} height={1.8} rx={0.9} fill={body} />
      <line x1={15.5} y1={35.2} x2={15.5} y2={37} stroke={COLOR.face} strokeWidth={0.6} />
      {/* 脚 */}
      <path d="M13.6 30 L12.9 35.4 M16.2 30 L16.7 35.4" stroke={leg} strokeWidth={0.9} strokeLinecap="round" fill="none" />
      {/* 体・首・頭 */}
      <ellipse cx={14.6} cy={25.4} rx={5.3} ry={5.2} transform="rotate(-18 14.6 25.4)" fill={body} />
      <path d="M8.2 16.2 C8 19.5 9 21.6 10.6 22.6 L13.6 20.6 C12.6 19 12.6 17.2 12.8 15.6 Z" fill={body} />
      <circle cx={10.4} cy={14.6} r={3.3} fill={body} />
      {/* 赤い胸 */}
      <path d="M9.4 19.6 C9 23.4 10.6 27.4 13.2 29.2 C11.6 26.2 11.4 22.6 12.4 20.4 Z" fill={red} />
      {/* 翼 */}
      <path
        d="M12.4 23.2 C15.4 21.2 18.8 22.6 20 25.2 C17.6 28.6 14.2 28.8 12.6 27.4"
        fill={tint ? "none" : detail}
        stroke={tint ? detail : "none"}
        strokeWidth={0.7}
      />
      <path d="M14 25.6 C15.6 25 17.2 25.4 18.4 26.2" fill="none" stroke={tint ? detail : light} strokeWidth={0.6} />
      {/* 冠（赤） */}
      <path d="M9.6 11.6 C8.6 10.6 8 9.6 7.6 8.6 C8.8 9 9.8 9.9 10.4 11.2 Z" fill={red} />
      <path d="M10.6 11.3 C10.4 10 10.6 8.8 11.2 7.8 C11.8 8.9 11.8 10.2 11.4 11.4 Z" fill={red} />
      <path d="M11.8 11.7 C12.4 10.6 13.2 9.8 14.2 9.4 C14 10.6 13.4 11.6 12.6 12.2 Z" fill={red} />
      {/* くちばし */}
      <path d="M7.4 13.8 L4.4 15.2 L7.5 16.3 Z" fill={beak} />
      {/* 目 */}
      <circle cx={9.7} cy={13.9} r={1} fill={COLOR.face} />
      <circle cx={9.55} cy={13.95} r={0.5} fill={tint ?? COLOR.man} />
    </g>
  );
}

function souFace(n: number, tint: string | null): ReactElement {
  if (n === 1) return souOne(tint);
  const { w, sticks } = SOU_LAYOUT[n];
  return (
    <g>
      {sticks.map(([x, y, h, k, angle], i) => {
        const c = tint ?? SOU_COLOR[k];
        return (
          <g key={i} transform={angle ? `rotate(${angle} ${x} ${y})` : undefined}>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} fill={c} />
            <line x1={x - w / 2} y1={y} x2={x + w / 2} y2={y} stroke={COLOR.face} strokeWidth={0.8} />
          </g>
        );
      })}
    </g>
  );
}

function manFace(n: number): ReactElement {
  return (
    <g fontFamily='"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif' textAnchor="middle" fontWeight={700}>
      <text x={15} y={19} fontSize={13} fill={COLOR.man}>
        {n === 1 ? "一" : "九"}
      </text>
      <text x={15} y={35} fontSize={13} fill={COLOR.red}>
        萬
      </text>
    </g>
  );
}

/** どの牌か分からないとき（空白の牌を出さない。空白は白と見間違えるため） */
function unknownFace(): ReactElement {
  return (
    <text x={15} y={26} fontSize={16} textAnchor="middle" fontWeight={700} fill="#9a9a9a">
      ?
    </text>
  );
}

function honorFace(n: number, pocchi: boolean): ReactElement {
  if (n === 5) {
    // 白：青い四角の枠。白ポッチは同じ枠＋中央に大きな金の点（R-30）
    return (
      <g>
        <rect x={6} y={7} width={18} height={26} rx={2} fill="none" stroke={COLOR.pin} strokeWidth={1.8} />
        {pocchi && <circle cx={15} cy={20} r={4.6} fill={COLOR.gold} stroke="#7a5a00" strokeWidth={0.8} />}
      </g>
    );
  }
  const ch = HONOR_CHAR[String(n)];
  if (!ch) return unknownFace();
  const color = n === 6 ? COLOR.sou : n === 7 ? COLOR.red : COLOR.man;
  return (
    <text
      x={15}
      y={27}
      fontSize={17}
      textAnchor="middle"
      fontWeight={700}
      fontFamily='"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'
      fill={color}
    >
      {ch}
    </text>
  );
}

function flowerFace(f: Flower): ReactElement {
  return (
    <g>
      <circle cx={15} cy={20} r={11} fill="none" stroke={FLOWER_COLOR[f]} strokeWidth={1} strokeDasharray="2 1.5" />
      <text
        x={15}
        y={26}
        fontSize={15}
        textAnchor="middle"
        fontWeight={700}
        fontFamily='"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'
        fill={FLOWER_COLOR[f]}
      >
        {FLOWER_CHAR[f]}
      </text>
    </g>
  );
}

function label(face: Face | undefined, flower: Flower | undefined, t: TileT | null | undefined): string {
  if (flower) return FLOWER_CHAR[flower];
  if (!face) return "牌";
  const n = face[0];
  const s = face[1];
  let base: string;
  if (s === "z") base = n === "5" ? "白" : HONOR_CHAR[n];
  else base = `${n}${s === "m" ? "萬" : s === "p" ? "筒" : "索"}`;
  if (t?.red) base = `赤${base}`;
  if (t?.gold) base = `金${base}`;
  if (t?.pocchi) base = "白ポッチ";
  return base;
}

/** 1枚の牌 */
export function Tile(props: TileProps): ReactElement {
  const { tile, back, sideways, size = "md", dim, dora, className, title } = props;
  const flower: Flower | undefined = props.flower ?? flowerOfTile(tile) ?? FLOWER_OF_FACE[props.face ?? ""];
  const face = tile?.face ?? props.face;
  const gold = !!tile?.gold;
  const red = !!tile?.red;
  const tint = gold ? COLOR.gold : red ? COLOR.red : null;

  let inner: ReactElement | null = null;
  if (!back) {
    if (flower) inner = flowerFace(flower);
    else if (face) {
      const n = Number(face[0]);
      const s = face[1];
      const num = (c: string) => cornerNumber(n, tint ?? c);
      if (s === "p")
        inner = (
          <g>
            {pinFace(n, tint)}
            {num(COLOR.pin)}
          </g>
        );
      else if (s === "s")
        inner = (
          <g>
            {souFace(n, tint)}
            {num(COLOR.sou)}
          </g>
        );
      else if (s === "m")
        inner = (
          <g>
            {manFace(n)}
            {num(COLOR.man)}
          </g>
        );
      else if (s === "z") inner = honorFace(n, !!tile?.pocchi);
      else inner = unknownFace();
    } else inner = unknownFace();
  }

  const body = (
    <g>
      <rect
        x={0.75}
        y={0.75}
        width={28.5}
        height={38.5}
        rx={3.5}
        fill={back ? COLOR.back : gold ? "#fff6d9" : COLOR.face}
        stroke={back ? COLOR.backEdge : gold ? COLOR.gold : COLOR.edge}
        strokeWidth={gold ? 1.6 : 1.2}
      />
      {back && <rect x={4} y={4} width={22} height={32} rx={2} fill="none" stroke="#2f8a6f" strokeWidth={1} />}
      {inner}
      {gold && !back && <path d="M26.8 36.8 h-5 l5 -5 z" fill={COLOR.goldLight} />}
      {dora && !back && <circle cx={26} cy={4.6} r={2.7} fill="#f5c518" stroke="#7a5a00" strokeWidth={0.6} />}
    </g>
  );

  const name = back ? "伏せ牌" : `${label(face, flower, tile)}${dora && !flower ? "（ドラ）" : ""}`;
  const cls = `tile tile-${size}${sideways ? " tile-side" : ""}${dim ? " tile-dim" : ""}${className ? ` ${className}` : ""}`;

  return (
    <svg
      className={cls}
      viewBox={sideways ? "0 0 40 30" : "0 0 30 40"}
      role="img"
      aria-label={title ?? name}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title ?? name}</title>
      {sideways ? <g transform="translate(0,30) rotate(-90)">{body}</g> : body}
    </svg>
  );
}

/** 面の短い表示名（ボタン文言用） */
export function faceLabel(face: Face): string {
  return label(face, undefined, null);
}
