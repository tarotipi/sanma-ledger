import { useId } from "react";
import { SPIRITS, spiritById } from "../../shared/gacha";

type Props = { spiritId: string; stage: number; size: number; silhouette?: boolean };

const GOLD = "#E8B931";

/** 雀霊ごとの形のパラメータ（IDの並び順から決める。外部画像なし） */
function shapeOf(spiritId: string) {
  const i = Math.max(0, SPIRITS.findIndex((s) => s.id === spiritId));
  return {
    rx: 30 + (i % 4) * 3, // 横幅
    ry: 26 + ((i * 7) % 5) * 2, // 縦幅
    ears: i % 4, // 0=なし 1=とがり 2=まる 3=触角
    eyes: (i >> 1) % 3, // 0=まる 1=にっこり 2=ジト目
    mouth: (i * 5) % 3, // 0=にっこり 1=おー 2=ギザ歯
    spot: i % 3 === 0, // おなかの模様
    tail: i % 2 === 1,
    feet: (i * 3) % 2 === 0,
  };
}

/** 系統色の丸っこいオリジナルの生き物。進化段階で装飾が増える（1=ほっぺと星、2=オーラ、3=王冠） */
export function SpiritArt({ spiritId, stage, size, silhouette }: Props) {
  const uid = useId().replace(/:/g, "");
  const sp = spiritById(spiritId);
  const sh = shapeOf(spiritId);
  const legend = sp?.rarity === "legend";
  const body = silhouette ? "var(--sil, #3a4440)" : (sp?.color ?? "#888");
  const ink = silhouette ? "transparent" : "#1b1f1d";
  const cx = 50;
  const cy = 58;
  const top = cy - sh.ry;
  const st = silhouette ? 0 : Math.max(0, stage);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={silhouette ? "未発見の雀霊" : (sp?.stages[Math.min(3, st)] ?? "雀霊")}>
      <defs>
        <radialGradient id={`g${uid}`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity={silhouette ? 0 : 0.45} />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`a${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor={legend ? GOLD : body} stopOpacity="0" />
          <stop offset="85%" stopColor={legend ? GOLD : body} stopOpacity="0.35" />
          <stop offset="100%" stopColor={legend ? GOLD : body} stopOpacity="0" />
        </radialGradient>
      </defs>
      {st >= 2 && <circle cx={cx} cy={cy - 4} r={48} fill={`url(#a${uid})`} className="spirit-aura" />}
      {sh.tail && <path d={`M${cx + sh.rx - 4} ${cy + 6} q 16 -2 14 -18 q -2 8 -12 8`} fill={body} />}
      {sh.ears === 1 && (
        <>
          <path d={`M${cx - 18} ${top + 8} L${cx - 22} ${top - 12} L${cx - 6} ${top + 2} Z`} fill={body} />
          <path d={`M${cx + 18} ${top + 8} L${cx + 22} ${top - 12} L${cx + 6} ${top + 2} Z`} fill={body} />
        </>
      )}
      {sh.ears === 2 && (
        <>
          <circle cx={cx - 18} cy={top + 4} r={9} fill={body} />
          <circle cx={cx + 18} cy={top + 4} r={9} fill={body} />
        </>
      )}
      {sh.ears === 3 && (
        <>
          <path d={`M${cx - 6} ${top + 2} q -6 -12 -12 -16`} stroke={body} strokeWidth={3} fill="none" strokeLinecap="round" />
          <path d={`M${cx + 6} ${top + 2} q 6 -12 12 -16`} stroke={body} strokeWidth={3} fill="none" strokeLinecap="round" />
          <circle cx={cx - 18} cy={top - 14} r={4} fill={legend && !silhouette ? GOLD : body} />
          <circle cx={cx + 18} cy={top - 14} r={4} fill={legend && !silhouette ? GOLD : body} />
        </>
      )}
      {sh.feet && (
        <>
          <ellipse cx={cx - 14} cy={cy + sh.ry - 2} rx={8} ry={5} fill={body} />
          <ellipse cx={cx + 14} cy={cy + sh.ry - 2} rx={8} ry={5} fill={body} />
        </>
      )}
      <ellipse cx={cx} cy={cy} rx={sh.rx} ry={sh.ry} fill={body} stroke={legend && !silhouette ? GOLD : "none"} strokeWidth={2.5} />
      <ellipse cx={cx} cy={cy} rx={sh.rx} ry={sh.ry} fill={`url(#g${uid})`} />
      {sh.spot && !silhouette && <ellipse cx={cx} cy={cy + sh.ry * 0.45} rx={sh.rx * 0.45} ry={sh.ry * 0.32} fill="#fff" opacity={0.35} />}
      {!silhouette && (
        <g>
          {sh.eyes === 0 && (
            <>
              <circle cx={cx - 10} cy={cy - 4} r={4.2} fill={ink} />
              <circle cx={cx + 10} cy={cy - 4} r={4.2} fill={ink} />
              <circle cx={cx - 8.8} cy={cy - 5.4} r={1.3} fill="#fff" />
              <circle cx={cx + 11.2} cy={cy - 5.4} r={1.3} fill="#fff" />
            </>
          )}
          {sh.eyes === 1 && (
            <>
              <path d={`M${cx - 15} ${cy - 3} q 5 -6 10 0`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
              <path d={`M${cx + 5} ${cy - 3} q 5 -6 10 0`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
            </>
          )}
          {sh.eyes === 2 && (
            <>
              <path d={`M${cx - 15} ${cy - 5} h 10`} stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
              <path d={`M${cx + 5} ${cy - 5} h 10`} stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
              <circle cx={cx - 10} cy={cy - 2.5} r={2.2} fill={ink} />
              <circle cx={cx + 10} cy={cy - 2.5} r={2.2} fill={ink} />
            </>
          )}
          {sh.mouth === 0 && <path d={`M${cx - 6} ${cy + 6} q 6 6 12 0`} stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />}
          {sh.mouth === 1 && <ellipse cx={cx} cy={cy + 8} rx={3.5} ry={4.5} fill={ink} />}
          {sh.mouth === 2 && (
            <path d={`M${cx - 8} ${cy + 6} l 4 4 l 4 -4 l 4 4 l 4 -4`} stroke={ink} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
          )}
          {st >= 1 && (
            <>
              <ellipse cx={cx - 18} cy={cy + 4} rx={4.5} ry={2.8} fill="#ff7a8a" opacity={0.6} />
              <ellipse cx={cx + 18} cy={cy + 4} rx={4.5} ry={2.8} fill="#ff7a8a" opacity={0.6} />
              <path d="M84 22 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" fill={GOLD} className="spirit-twinkle" />
            </>
          )}
          {st >= 2 && <path d="M14 34 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 Z" fill={GOLD} className="spirit-twinkle" />}
          {st >= 3 && (
            <path
              d={`M${cx - 14} ${top - 2} l -2 -14 l 8 7 l 8 -11 l 8 11 l 8 -7 l -2 14 Z`}
              fill={GOLD}
              stroke="#9c7412"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
          )}
        </g>
      )}
      {silhouette && (
        <text x={cx} y={cy + 7} textAnchor="middle" fontSize={22} fontWeight={700} fill={legend ? GOLD : "#9aa8a1"}>
          ？
        </text>
      )}
    </svg>
  );
}
