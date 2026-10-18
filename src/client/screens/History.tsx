import { useCallback, useEffect, useState } from "react";
import { navigate, usePath } from "../router";
import { useGroup } from "../store";
import { Empty, fmtDateTime } from "../ui";
import { fmtScore, fmtYen } from "../../shared/mahjong";
import type { AuditLog, GroupState, Score } from "../../shared/types";

const KINDS: { v: string; label: string }[] = [
  { v: "", label: "すべて" },
  { v: "games", label: "半荘" },
  { v: "chips", label: "チップ" },
  { v: "adjustments", label: "調整" },
  { v: "settlements", label: "精算" },
  { v: "sessions", label: "対局の設定" },
  { v: "members", label: "メンバー" },
  { v: "photos", label: "写真" },
  { v: "group", label: "グループ" },
];

const ACTION: Record<string, string> = { insert: "追加", update: "変更", delete: "削除", restore: "復元" };

type Any = Record<string, unknown>;

function describe(log: AuditLog, state: GroupState): string[] {
  const name = (id: unknown) => state.members.find((m) => m.id === id)?.name ?? "(不明)";
  const b = (log.before ?? {}) as Any;
  const a = (log.after ?? {}) as Any;
  const session = (sid: unknown) => {
    const s = state.sessions.find((x) => x.id === sid);
    return s ? (s.title === s.playedOn ? s.playedOn : s.title) : "";
  };
  switch (log.entity) {
    case "games": {
      const scoresA = (a.scores ?? []) as Score[];
      const scoresB = (b.scores ?? []) as Score[];
      const head = `${session(a.sessionId ?? b.sessionId)} 第${a.seq ?? b.seq}半荘を${ACTION[log.action]}`;
      if (log.action === "insert") return [head, scoresA.map((s) => `${name(s.memberId)} ${fmtScore(s.score)}`).join("　")];
      if (log.action === "update") {
        const ids = [...new Set([...scoresB, ...scoresA].map((s) => s.memberId))];
        const lines = ids
          .map((id) => {
            const x = scoresB.find((s) => s.memberId === id);
            const y = scoresA.find((s) => s.memberId === id);
            if (x?.score === y?.score && x?.tie === y?.tie) return null;
            return `${name(id)} ${x ? fmtScore(x.score) : "—"} → ${y ? fmtScore(y.score) : "—"}`;
          })
          .filter(Boolean) as string[];
        return [head, ...(lines.length ? lines : ["（素点の変更なし）"])];
      }
      return [head];
    }
    case "chips": {
      const lines = ((a.lines ?? b.lines ?? []) as { memberId: string; count: number }[])
        .map((l) => `${name(l.memberId)} ${l.count > 0 ? "+" : "−"}${Math.abs(l.count)}枚`)
        .join("　");
      const out = [`チップの記録を${ACTION[log.action]}`, lines];
      if (log.action === "update") {
        const before = ((b.lines ?? []) as { memberId: string; count: number }[])
          .map((l) => `${name(l.memberId)} ${l.count > 0 ? "+" : "−"}${Math.abs(l.count)}枚`)
          .join("　");
        out.splice(1, 0, `変更前：${before}`);
        out[2] = `変更後：${lines}`;
      }
      if (a.memo) out.push(`メモ：${String(a.memo)}`);
      return out;
    }
    case "adjustments": {
      const fmt = (x: Any) =>
        ((x.lines ?? []) as { memberId: string; yen: number }[]).map((l) => `${name(l.memberId)} ${fmtYen(l.yen)}円`).join("　");
      const out = [`調整（${(a.kind ?? b.kind) === "internal" ? "メンバー間" : "外部"}）を${ACTION[log.action]}`];
      if (log.action === "update") out.push(`変更前：${fmt(b)}`, `変更後：${fmt(a)}`);
      else out.push(fmt(a.lines ? a : b));
      out.push(`メモ：${String(a.memo ?? b.memo ?? "")}`);
      return out;
    }
    case "settlements":
      return [
        log.action === "insert"
          ? `${name(a.memberId)}さんを精算済みにした（${fmtYen(Number(a.yen))}円）`
          : `${name(a.memberId ?? b.memberId)}さんの精算済みを${ACTION[log.action]}`,
      ];
    case "sessions": {
      if (log.action === "insert") return [`対局「${String(a.title)}」を作成（1pt＝${String(a.rate)}円、チップ${String(a.chipYen)}円）`];
      if (log.action !== "update") return [`対局「${String(a.title ?? b.title)}」を${ACTION[log.action]}`];
      const out = [`対局「${String(a.title)}」の設定を変更`];
      if (a.title !== b.title) out.push(`タイトル ${String(b.title)} → ${String(a.title)}`);
      if (a.playedOn !== b.playedOn) out.push(`日付 ${String(b.playedOn)} → ${String(a.playedOn)}`);
      if (a.rate !== b.rate) out.push(`レート ${String(b.rate)}円 → ${String(a.rate)}円${a.rateScope === "all" ? "（記録済みの全半荘に適用）" : "（これからの半荘のみ）"}`);
      if (a.chipYen !== b.chipYen) out.push(`チップ単価 ${String(b.chipYen)}円 → ${String(a.chipYen)}円`);
      return out;
    }
    case "members": {
      if (log.action === "insert") return [`メンバー「${String(a.name)}」を追加`];
      const out = [`メンバー「${String(b.name)}」を変更`];
      if (a.name !== b.name) out.push(`名前 → ${String(a.name)}`);
      if (a.hidden !== b.hidden) out.push(a.hidden ? "一覧から隠した" : "一覧に戻した");
      if (a.color !== b.color) out.push("色を変更");
      return out;
    }
    case "photos":
      return [`写真を${ACTION[log.action]}`];
    case "group":
      if (log.action === "insert") return [`グループ「${String(a.name)}」を作成`];
      if (a.code) return ["合言葉を変更"];
      return [`グループ名 ${String(b.name)} → ${String(a.name)}`];
    default:
      return [`${log.entity}を${ACTION[log.action]}`];
  }
}

function isDeletedNow(log: AuditLog, state: GroupState): boolean {
  const table = {
    games: state.games,
    chips: state.chips,
    adjustments: state.adjustments,
    settlements: state.settlements,
    photos: state.photos,
    sessions: state.sessions,
  }[log.entity as string] as { id: string; deletedAt: string | null }[] | undefined;
  return !!table?.find((x) => x.id === log.entityId)?.deletedAt;
}

export function HistoryView() {
  const { state, api, refresh, toast } = useGroup();
  const { query } = usePath();
  const entityId = query.get("entityId") ?? "";
  const [kind, setKind] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const q: Record<string, string> = { limit: "50" };
        if (kind) q.entity = kind;
        if (entityId) q.entityId = entityId;
        if (!reset && logs.length) q.before = String(logs[logs.length - 1].id);
        const r = await api<{ logs: AuditLog[] }>("GET", "/logs", undefined, { query: q });
        setLogs((cur) => (reset ? r.logs : [...cur, ...r.logs]));
        setMore(r.logs.length === 50);
      } catch (e) {
        toast(e instanceof Error ? e.message : "読み込めませんでした。");
      } finally {
        setLoading(false);
      }
    },
    [api, kind, entityId, logs, toast],
  );

  useEffect(() => {
    void load(true);
  }, [kind, entityId, state?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  return (
    <>
      <p className="note">すべての記録と変更がここに残ります。この履歴は誰も消したり書き換えたりできません。</p>
      {entityId ? (
        <p className="filter-note">
          1件の記録に絞り込み中
          <button type="button" className="btn small ghost" onClick={() => navigate(location.pathname, true)}>
            解除
          </button>
        </p>
      ) : (
        <div className="chips scroll-x">
          {KINDS.map((k) => (
            <button key={k.v} type="button" className={`chip ${kind === k.v ? "on" : ""}`} onClick={() => setKind(k.v)}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      {logs.length === 0 && !loading && <Empty>該当する履歴はありません。</Empty>}
      <ol className="logs">
        {logs.map((l) => {
          const [head, ...rest] = describe(l, state);
          return (
            <li key={l.id} className={`log ${l.action}`}>
              <div className="log-head">
                <span className="act">{ACTION[l.action]}</span>
                <time>{fmtDateTime(l.createdAt)}</time>
                <span className="who">
                  {l.actorName}
                  <small>（端末 {l.actorDevice}）</small>
                </span>
              </div>
              <p>{head}</p>
              {rest.filter(Boolean).map((r, i) => (
                <p key={i} className="detail">
                  {r}
                </p>
              ))}
              {l.action === "delete" && isDeletedNow(l, state) && (
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    try {
                      await api("POST", `/${l.entity}/${l.entityId}/restore`);
                      toast("元に戻しました");
                      await refresh();
                    } catch (e) {
                      toast(e instanceof Error ? e.message : "元に戻せませんでした。");
                    }
                  }}
                >
                  元に戻す
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {more && logs.length > 0 && (
        <button type="button" className="btn ghost wide" disabled={loading} onClick={() => void load(false)}>
          さらに読み込む
        </button>
      )}
    </>
  );
}
