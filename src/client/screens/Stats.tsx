import { useMemo, useState } from "react";
import { gamesInOrder, useGroup } from "../store";
import { Empty, Name, Yen, pct } from "../ui";
import { calcGame, calcStats, fmtPt, fmtScore, type PlayerStats } from "../../shared/mahjong";
import type { Game, Member } from "../../shared/types";
import { downloadCsv } from "../logic";

type Col = {
  key: string;
  label: string;
  get: (s: PlayerStats) => number;
  show: (s: PlayerStats) => React.ReactNode;
  asc?: boolean;
};

const COLS: Col[] = [
  { key: "yen", label: "収支", get: (s) => s.yen, show: (s) => <Yen v={s.yen} /> },
  { key: "games", label: "半荘", get: (s) => s.games, show: (s) => s.games },
  { key: "pt", label: "合計pt", get: (s) => s.totalPt10, show: (s) => fmtPt(s.totalPt10) },
  { key: "avgRank", label: "平均着順", get: (s) => s.avgRank, show: (s) => s.avgRank.toFixed(2), asc: true },
  { key: "top", label: "トップ率", get: (s) => s.topRate, show: (s) => pct(s.topRate) },
  { key: "rentai", label: "連対率", get: (s) => s.rentaiRate, show: (s) => pct(s.rentaiRate) },
  { key: "last", label: "ラス率", get: (s) => s.lastRate, show: (s) => pct(s.lastRate), asc: true },
  { key: "tobi", label: "飛び率", get: (s) => s.tobiRate, show: (s) => pct(s.tobiRate), asc: true },
  { key: "ranks", label: "1-2-3位", get: (s) => s.ranks[0], show: (s) => s.ranks.join("-") },
  { key: "avgScore", label: "平均素点", get: (s) => s.avgScore, show: (s) => fmtScore(Math.round(s.avgScore)) },
  { key: "maxScore", label: "最高素点", get: (s) => s.maxScore, show: (s) => fmtScore(s.maxScore) },
  { key: "minScore", label: "最低素点", get: (s) => s.minScore, show: (s) => fmtScore(s.minScore) },
  { key: "maxWin", label: "最大勝ち", get: (s) => s.maxWin, show: (s) => <Yen v={s.maxWin} /> },
  { key: "maxLoss", label: "最大負け", get: (s) => s.maxLoss, show: (s) => <Yen v={s.maxLoss} />, asc: true },
  { key: "topStreak", label: "連続トップ", get: (s) => s.maxTopStreak, show: (s) => s.maxTopStreak },
  { key: "lastStreak", label: "連続ラス", get: (s) => s.maxLastStreak, show: (s) => s.maxLastStreak, asc: true },
];

export function StatsView({ sid }: { sid?: string }) {
  const { state } = useGroup();
  const [scope, setScope] = useState<"session" | "all">(sid ? "session" : "all");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "yen", desc: true });
  const games = useMemo(
    () => (state ? gamesInOrder(state, scope === "session" ? sid : undefined) : []),
    [state, scope, sid],
  );
  if (!state) return null;
  const stats = calcStats(games);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const col = COLS.find((c) => c.key === sort.key) ?? COLS[0];
  const rows = Object.values(stats).sort((a, b) => (sort.desc ? col.get(b) - col.get(a) : col.get(a) - col.get(b)));

  return (
    <>
      {sid && (
        <div className="seg" role="tablist">
          <button type="button" className={scope === "session" ? "on" : ""} onClick={() => setScope("session")}>
            このセッション
          </button>
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            通算
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>半荘を記録すると、ここに成績が出ます。</Empty>
      ) : (
        <>
          <div className="tbl-scroll">
            <table className="tbl stats">
              <thead>
                <tr>
                  <th className="sticky">名前</th>
                  {COLS.map((c) => (
                    <th key={c.key}>
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : !c.asc }))
                        }
                        aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}
                      >
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? "▼" : "▲") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.memberId}>
                    <td className="sticky">
                      <Name m={mm.get(s.memberId)} />
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="num">
                        {c.show(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">列の名前を押すと並べ替えます。飛び率は素点が0点未満で終わった割合です。</p>
          <h2 className="h2">収支の推移</h2>
          <TrendChart games={games} members={state.members} />
          <button
            type="button"
            className="btn ghost wide"
            onClick={() =>
              downloadCsv(`成績_${scope === "session" ? "セッション" : "通算"}.csv`, [
                ["名前", ...COLS.map((c) => c.label)],
                ...rows.map((s) => [
                  mm.get(s.memberId)?.name ?? "",
                  s.yen,
                  s.games,
                  s.totalPt10 / 10,
                  s.avgRank.toFixed(2),
                  pct(s.topRate),
                  pct(s.rentaiRate),
                  pct(s.lastRate),
                  pct(s.tobiRate),
                  s.ranks.join("-"),
                  Math.round(s.avgScore * 100),
                  s.maxScore * 100,
                  s.minScore * 100,
                  s.maxWin,
                  s.maxLoss,
                  s.maxTopStreak,
                  s.maxLastStreak,
                ]),
              ])
            }
          >
            成績をCSVで保存
          </button>
        </>
      )}
    </>
  );
}

function TrendChart({ games, members }: { games: Game[]; members: Member[] }) {
  const series = useMemo(() => {
    const acc = new Map<string, number>();
    const pts = new Map<string, { x: number; y: number }[]>();
    // 打っていない半荘は前の値のまま横ばいにする
    games.forEach((g, i) => {
      for (const r of calcGame(g.scores, g.rate)) {
        if (!acc.has(r.memberId)) pts.set(r.memberId, [{ x: i, y: 0 }]);
        acc.set(r.memberId, (acc.get(r.memberId) ?? 0) + r.yen);
      }
      for (const [id, v] of acc) pts.get(id)!.push({ x: i + 1, y: v });
    });
    return members.filter((m) => pts.has(m.id)).map((m) => ({ m, pts: pts.get(m.id)!, last: acc.get(m.id) ?? 0 }));
  }, [games, members]);
  if (!games.length) return null;
  const W = 340;
  const H = 200;
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const ys = series.flatMap((s) => s.pts.map((p) => p.y));
  const yMax = Math.max(0, ...ys);
  const yMin = Math.min(0, ...ys);
  const span = yMax - yMin || 1;
  const xN = games.length;
  const X = (x: number) => pad.l + (x / xN) * (W - pad.l - pad.r);
  const Y = (y: number) => pad.t + ((yMax - y) / span) * (H - pad.t - pad.b);
  const ticks = [yMax, 0, yMin].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="累計収支の推移">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} className={t === 0 ? "axis0" : "grid"} />
            <text x={pad.l - 4} y={Y(t) + 4} textAnchor="end" className="tick">
              {t === 0 ? "0" : `${t > 0 ? "+" : "−"}${Math.abs(t).toLocaleString()}`}
            </text>
          </g>
        ))}
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="tick">
          {xN}半荘
        </text>
        {series.map((s) => (
          <polyline
            key={s.m.id}
            fill="none"
            stroke={s.m.color}
            strokeWidth={2}
            strokeLinejoin="round"
            points={s.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
          />
        ))}
      </svg>
      <figcaption className="legend">
        {series
          .sort((a, b) => b.last - a.last)
          .map((s) => (
            <span key={s.m.id}>
              <i style={{ background: s.m.color }} />
              {s.m.name} <Yen v={s.last} />
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
