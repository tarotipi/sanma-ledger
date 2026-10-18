import { useMemo, useState } from "react";
import { navigate, type SessionTab } from "../router";
import { liveGames, useGroup } from "../store";
import { Confirm, Empty, Name, Sheet, Yen, fmtDate, fmtDateTime, type ConfirmSpec } from "../ui";
import { calcGame, fmtPt, fmtScore } from "../../shared/mahjong";
import type { Game } from "../../shared/types";
import { participants, sessionBalances, sessionOf, settledImpact } from "../logic";
import { DiffTable, GameEditor, SettledWarning, isFreeEdit } from "./GameEditor";
import { PhotoStrip } from "./Photos";
import { StatsView } from "./Stats";
import { SettleView } from "./Settle";
import { HistoryView } from "./History";
import { SettingsView } from "./Settings";

const TABS: { id: SessionTab; label: string }[] = [
  { id: "record", label: "記録" },
  { id: "stats", label: "成績" },
  { id: "settle", label: "精算" },
  { id: "history", label: "履歴" },
  { id: "settings", label: "設定" },
];

export function SessionScreen({ sid, tab }: { sid: string; tab: SessionTab }) {
  const { state, gid } = useGroup();
  if (!state) return null;
  const session = sessionOf(state, sid);
  if (!session)
    return (
      <main className="page">
        <Empty>このセッションは見つかりません。</Empty>
      </main>
    );
  return (
    <div className="with-tabs">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="対局の一覧へ">
          ‹
        </button>
        <h1>
          {session.title === session.playedOn ? fmtDate(session.playedOn) : session.title}
          {session.deletedAt && <small className="badge">削除済み</small>}
        </h1>
        <span className="rate">1pt＝{session.rate}円</span>
      </header>
      <main className="page">
        {tab === "record" && <RecordView sid={sid} />}
        {tab === "stats" && <StatsView sid={sid} />}
        {tab === "settle" && <SettleView sid={sid} />}
        {tab === "history" && <HistoryView />}
        {tab === "settings" && <SettingsView sid={sid} />}
      </main>
      <nav className="tabbar" aria-label="画面切り替え">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "on" : ""}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => navigate(`/g/${gid}/s/${sid}/${t.id}`, true)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Scoreboard({ sid }: { sid: string }) {
  const { state } = useGroup();
  const rows = useMemo(() => {
    if (!state) return [];
    const b = sessionBalances(state, sid);
    return participants(state, sid)
      .map((m) => ({ m, total: b[m.id]?.total ?? 0, games: b[m.id]?.games ?? 0 }))
      .sort((a, b) => b.total - a.total);
  }, [state, sid]);
  if (!rows.length) return null;
  return (
    <section className="board" aria-label="現在の収支">
      {rows.map(({ m, total, games }) => (
        <div key={m.id} className="readout">
          <span className="who">
            <i style={{ background: m.color }} />
            {m.name}
          </span>
          <span className={`digits ${total > 0 ? "plus" : total < 0 ? "minus" : ""}`}>
            {total > 0 ? "+" : total < 0 ? "−" : ""}
            {Math.abs(total).toLocaleString()}
          </span>
          <span className="sub">{games}半荘</span>
        </div>
      ))}
    </section>
  );
}

function RecordView({ sid }: { sid: string }) {
  const { state } = useGroup();
  const [editing, setEditing] = useState<{ open: boolean; game: Game | null }>({ open: false, game: null });
  const [detail, setDetail] = useState<Game | null>(null);
  if (!state) return null;
  const games = liveGames(state, sid).sort((a, b) => b.seq - a.seq);
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const photoGames = new Set(state.photos.filter((p) => !p.deletedAt && p.gameId).map((p) => p.gameId));

  return (
    <>
      <Scoreboard sid={sid} />
      <button type="button" className="btn primary wide xl" onClick={() => setEditing({ open: true, game: null })}>
        半荘を記録
      </button>

      {games.length === 0 ? (
        <Empty>まだ半荘がありません。終わったら「半荘を記録」から素点を入れてください。</Empty>
      ) : (
        <ol className="games">
          {games.map((g) => {
            const r = calcGame(g.scores, g.rate);
            const edited = g.updatedAt !== g.createdAt;
            return (
              <li key={g.id}>
                <button type="button" className={`game ${g.id.startsWith("tmp-") ? "pending" : ""}`} onClick={() => setDetail(g)}>
                  <span className="seq">
                    <b>{g.seq}</b>
                    <small>{fmtDateTime(g.createdAt).split(" ")[1]}</small>
                    {edited && <em className="tag">変更</em>}
                    {photoGames.has(g.id) && <em className="tag">写真</em>}
                  </span>
                  <span className="lines">
                    {r.map((x) => (
                      <span key={x.memberId} className="line">
                        <span className={`rank r${x.rank}`}>{x.rank}</span>
                        <Name m={mm.get(x.memberId)} />
                        <span className="num score">{fmtScore(x.score)}</span>
                        <Yen v={x.yen} />
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <section className="block">
        <h2>このセッションの写真</h2>
        <PhotoStrip sessionId={sid} gameId={null} />
      </section>

      <GameEditor
        open={editing.open}
        game={editing.game}
        sessionId={sid}
        onClose={() => setEditing({ open: false, game: null })}
      />
      <GameDetail
        game={detail}
        onClose={() => setDetail(null)}
        onEdit={(g) => {
          setDetail(null);
          setEditing({ open: true, game: g });
        }}
      />
    </>
  );
}

function GameDetail({ game, onClose, onEdit }: { game: Game | null; onClose: () => void; onEdit: (g: Game) => void }) {
  const { state, gid, api, refresh, toast } = useGroup();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  if (!state) return null;
  const g = game ? state.games.find((x) => x.id === game.id) ?? game : null;
  const mm = new Map(state.members.map((m) => [m.id, m]));
  const pending = g?.id.startsWith("tmp-");

  const del = () => {
    if (!g) return;
    const nextState = { ...state, games: state.games.map((x) => (x.id === g.id ? { ...x, deletedAt: "x" } : x)) };
    const impact = settledImpact(state, nextState, g.sessionId);
    setConfirm({
      title: `第${g.seq}半荘を削除しますか`,
      body: (
        <>
          {!isFreeEdit(state, g) && <p>最新ではない半荘です。削除すると次のように金額が変わります。</p>}
          <DiffTable state={state} before={g.scores} after={null} rate={g.rate} />
          <SettledWarning impact={impact} state={state} />
          <p>削除した半荘は変更履歴から元に戻せます。</p>
        </>
      ),
      okLabel: "削除する",
      danger: true,
      onOk: async () => {
        try {
          await api("POST", `/games/${g.id}/delete`);
          onClose();
          toast(`第${g.seq}半荘を削除しました`);
          await refresh();
        } catch (e) {
          toast(e instanceof Error ? e.message : "削除できませんでした。");
        }
      },
    });
  };

  return (
    <>
      <Sheet
        open={!!g}
        onClose={onClose}
        title={g ? `第${g.seq}半荘` : ""}
        footer={
          g &&
          !pending && (
            <>
              <button type="button" className="btn danger ghost" onClick={del}>
                削除
              </button>
              <button type="button" className="btn primary" onClick={() => onEdit(g)}>
                編集
              </button>
            </>
          )
        }
      >
        {g && (
          <>
            <table className="tbl result">
              <thead>
                <tr>
                  <th>順位</th>
                  <th>名前</th>
                  <th>素点</th>
                  <th>pt</th>
                  <th>円</th>
                </tr>
              </thead>
              <tbody>
                {calcGame(g.scores, g.rate).map((r) => (
                  <tr key={r.memberId}>
                    <td className={`rank r${r.rank}`}>{r.rank}</td>
                    <td>
                      <Name m={mm.get(r.memberId)} />
                    </td>
                    <td className="num">{fmtScore(r.score)}</td>
                    <td className="num">{fmtPt(r.pt10)}</td>
                    <td className="num">
                      <Yen v={r.yen} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              記録 {fmtDateTime(g.createdAt)}
              {g.updatedAt !== g.createdAt && `　最終変更 ${fmtDateTime(g.updatedAt)}`}　1pt＝{g.rate}円
            </p>
            {!pending && (
              <>
                <h3>写真</h3>
                <PhotoStrip sessionId={g.sessionId} gameId={g.id} />
                <button
                  type="button"
                  className="btn ghost wide"
                  onClick={() => {
                    onClose();
                    navigate(`/g/${gid}/s/${g.sessionId}/history?entityId=${g.id}`, true);
                  }}
                >
                  この半荘の変更履歴を見る
                </button>
              </>
            )}
          </>
        )}
      </Sheet>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
