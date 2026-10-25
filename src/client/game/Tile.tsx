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

const PIN_POS: Record<number, [number, number][]> = {
  1: [[15, 20]],
  2: [
    [15, 11],
    [15, 29],
  ],
  3: [
    [8, 9],
    [15, 20],
    [22, 31],
  ],
  4: [
    [9, 12],
    [21, 12],
    [9, 28],
    [21, 28],
  ],
  5: [
    [8.5, 10],
    [21.5, 10],
    [15, 20],
    [8.5, 30],
    [21.5, 30],
  ],
  6: [
    [9, 9],
    [21, 9],
    [9, 20],
    [21, 20],
    [9, 31],
    [21, 31],
  ],
  7: [
    [7, 7],
    [15, 10],
    [23, 13],
    [9, 23],
    [21, 23],
    [9, 33],
    [21, 33],
  ],
  8: [
    [9, 7],
    [21, 7],
    [9, 15.5],
    [21, 15.5],
    [9, 24.5],
    [21, 24.5],
    [9, 33],
    [21, 33],
  ],
  9: [
    [7, 9],
    [15, 9],
    [23, 9],
    [7, 20],
    [15, 20],
    [23, 20],
    [7, 31],
    [15, 31],
    [23, 31],
  ],
};
const PIN_R: Record<number, number> = { 1: 9, 2: 5.5, 3: 4.6, 4: 5, 5: 4.4, 6: 4.2, 7: 3.6, 8: 3.6, 9: 3.6 };

const SOU_POS: Record<number, [number, number][]> = {
  2: [
    [15, 11],
    [15, 29],
  ],
  3: [
    [15, 11],
    [9, 29],
    [21, 29],
  ],
  4: [
    [9, 11],
    [21, 11],
    [9, 29],
    [21, 29],
  ],
  5: [
    [8, 11],
    [22, 11],
    [15, 20],
    [8, 29],
    [22, 29],
  ],
  6: [
    [7, 11],
    [15, 11],
    [23, 11],
    [7, 29],
    [15, 29],
    [23, 29],
  ],
  7: [
    [15, 8],
    [7, 20],
    [15, 20],
    [23, 20],
    [7, 32],
    [15, 32],
    [23, 32],
  ],
  8: [
    [6, 12],
    [12, 12],
    [18, 12],
    [24, 12],
    [6, 28],
    [12, 28],
    [18, 28],
    [24, 28],
  ],
  9: [
    [7, 8],
    [15, 8],
    [23, 8],
    [7, 20],
    [15, 20],
    [23, 20],
    [7, 32],
    [15, 32],
    [23, 32],
  ],
};

const HONOR_CHAR: Record<string, string> = { "1": "東", "2": "南", "3": "西", "4": "北", "6": "發", "7": "中" };
const FLOWER_CHAR: Record<Flower, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" };
const FLOWER_COLOR: Record<Flower, string> = { spring: "#c2417a", summer: "#d0602d", autumn: "#a8551c", winter: "#2b5fa8" };

function pinFace(n: number, tint: string | null): ReactElement {
  const r = PIN_R[n];
  return (
    <g>
      {PIN_POS[n].map(([x, y], i) => {
        const c = tint ?? (n === 1 ? COLOR.red : i % 2 === 0 ? COLOR.pin : COLOR.sou);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill="none" stroke={c} strokeWidth={r > 6 ? 2.2 : 1.4} />
            <circle cx={x} cy={y} r={r * 0.45} fill={c} />
          </g>
        );
      })}
    </g>
  );
}

function souFace(n: number, tint: string | null): ReactElement {
  if (n === 1) {
    const c = tint ?? COLOR.sou;
    // 一索：1本の大きな竹と頭
    return (
      <g>
        <rect x={12.5} y={10} width={5} height={22} rx={2.5} fill={c} />
        <circle cx={15} cy={9} r={4} fill={tint ?? COLOR.red} />
        <line x1={12.5} y1={21} x2={17.5} y2={21} stroke={COLOR.face} strokeWidth={1} />
      </g>
    );
  }
  const h = n >= 7 ? 8.5 : 10;
  return (
    <g>
      {SOU_POS[n].map(([x, y], i) => {
        const c = tint ?? (n === 9 && i % 3 === 1 ? COLOR.red : COLOR.sou);
        return (
          <g key={i}>
            <rect x={x - 1.8} y={y - h / 2} width={3.6} height={h} rx={1.6} fill={c} />
            <line x1={x - 1.8} y1={y} x2={x + 1.8} y2={y} stroke={COLOR.face} strokeWidth={0.8} />
          </g>
        );
      })}
    </g>
  );
}

function manFace(n: number): ReactElement {
  return (
    <g fontFamily='"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif' textAnchor="middle" fontWeight={700}>
      <text x={15} y={17} fontSize={13} fill={COLOR.man}>
        {n === 1 ? "一" : "九"}
      </text>
      <text x={15} y={34} fontSize={13} fill={COLOR.red}>
        萬
      </text>
    </g>
  );
}

function honorFace(n: number, pocchi: boolean): ReactElement {
  if (n === 5) {
    // 白：枠だけ。白ポッチは中央に点（R-30）
    return (
      <g>
        <rect x={6} y={7} width={18} height={26} rx={2} fill="none" stroke={COLOR.pin} strokeWidth={1.6} />
        {pocchi && <circle cx={15} cy={20} r={3.2} fill={COLOR.gold} stroke="#7a5a00" strokeWidth={0.6} />}
      </g>
    );
  }
  const ch = HONOR_CHAR[String(n)];
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
  const { tile, flower, back, sideways, size = "md", dim, className, title } = props;
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
      if (s === "p") inner = pinFace(n, tint);
      else if (s === "s") inner = souFace(n, tint);
      else if (s === "m") inner = manFace(n);
      else inner = honorFace(n, !!tile?.pocchi);
    }
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
      {gold && !back && <path d="M3 3 l4 0 l-4 4 z" fill={COLOR.goldLight} />}
    </g>
  );

  const name = back ? "伏せ牌" : label(face, flower, tile);
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
