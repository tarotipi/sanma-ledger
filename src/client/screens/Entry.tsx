import { useEffect, useMemo, useRef, useState } from "react";
import { loadGroups, request, saveGroup } from "../api";
import { navigate } from "../router";
import { useGroup, useToast } from "../store";
import { Dot, Yen, fmtDate, today } from "../ui";
import { RULES } from "../../shared/mahjong";
import { sessionBalances } from "../logic";

export function Home() {
  const groups = Object.values(loadGroups());
  const toast = useToast();
  const [members, setMembers] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const list = members
        .split(/[\n,、，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await request<{ groupId: string; name: string; token: string }>("POST", "/groups", {
        body: { members: list },
      });
      saveGroup({ id: r.groupId, name: r.name, token: r.token, memberId: null });
      navigate(`/g/${r.groupId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "作成できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <header className="brand">
        <h1>対戦記録</h1>
      </header>

      {groups.length > 0 && (
        <section className="block">
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <button type="button" className="row-link" onClick={() => navigate(`/g/${g.id}`)}>
                  <span>{g.name}</span>
                  <span className="chev" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          打つ人の名前（1行に1人）
          <textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={4} placeholder={"ドナー\n赤堀\n唐司"} required />
        </label>
        <button className="btn primary wide xl" disabled={busy}>
          {busy ? "作成中…" : "始める"}
        </button>
      </form>
    </main>
  );
}

export function Join() {
  const { gid, setSaved } = useGroup();
  const toast = useToast();
  const [info, setInfo] = useState<{ name: string; needsCode: boolean } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const join = async (c: string) => {
    setBusy(true);
    try {
      const r = await request<{ token: string; name: string }>("POST", `/groups/${gid}/join`, { body: { code: c } });
      setSaved({ id: gid, name: r.name, token: r.token, memberId: null });
    } catch (err) {
      toast(err instanceof Error ? err.message : "入室できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    request<{ name: string; needsCode: boolean }>("GET", `/groups/${gid}/public`)
      .then((r) => {
        setInfo(r);
        // 合言葉なしのグループは、URLを開いただけで入れる
        if (!r.needsCode && !tried.current) {
          tried.current = true;
          void join("");
        }
      })
      .catch(() => setNotFound(true));
  }, [gid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound)
    return (
      <main className="page narrow">
        <p className="empty">グループが見つかりません。URLが正しいか確認してください。</p>
        <button type="button" className="btn ghost wide" onClick={() => navigate("/")}>
          最初の画面へ
        </button>
      </main>
    );

  if (!info || !info.needsCode)
    return (
      <main className="page narrow">
        <div className="loading" aria-label="読み込み中" />
      </main>
    );

  return (
    <main className="page narrow">
      <header className="brand">
        <h1>{info.name}</h1>
        <p>合言葉を入れて入室します。</p>
      </header>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void join(code);
        }}
      >
        <label>
          合言葉
          <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
        </label>
        <button className="btn primary wide" disabled={busy}>
          入室する
        </button>
      </form>
    </main>
  );
}

export function PickMember() {
  const { state, saved, setSaved, api, refresh, toast } = useGroup();
  const [newName, setNewName] = useState("");
  if (!state || !saved) return null;
  const visible = state.members.filter((m) => !m.hidden);
  return (
    <main className="page narrow">
      <header className="brand">
        <h1>あなたは？</h1>
        <p>記録は選んだ名前で履歴に残ります。</p>
      </header>
      <div className="pick-grid">
        {visible.map((m) => (
          <button key={m.id} type="button" className="pick" onClick={() => setSaved({ ...saved, memberId: m.id })}>
            <Dot m={m} />
            {m.name}
          </button>
        ))}
      </div>
      <form
        className="form inline"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const m = await api<{ id: string }>("POST", "/members", { name: newName });
            setSaved({ ...saved, memberId: m.id });
            await refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : "追加できませんでした。");
          }
        }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="一覧にいなければ名前を入力" maxLength={20} required />
        <button className="btn">追加</button>
      </form>
    </main>
  );
}

export function GroupHome() {
  const { state, gid, member, api, refresh, toast } = useGroup();
  const [busy, setBusy] = useState(false);
  const sessions = useMemo(() => state?.sessions.filter((s) => !s.deletedAt) ?? [], [state]);
  if (!state) return null;
  const last = sessions[0];

  // 日付・レート・チップは前回と同じ値でそのまま始める（あとで設定タブで直せる）
  const start = async () => {
    setBusy(true);
    try {
      const s = await api<{ id: string }>("POST", "/sessions", {
        playedOn: today(),
        rate: last?.rate ?? RULES.DEFAULT_RATE,
        chipYen: last?.chipYen ?? RULES.DEFAULT_CHIP,
      });
      await refresh();
      navigate(`/g/${gid}/s/${s.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "始められませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate("/")} aria-label="グループ一覧へ">
          ‹
        </button>
        <h1>{state.group.name}</h1>
        <span className="me">
          <Dot m={member} />
          {member?.name}
        </span>
      </header>
      <main className="page">
        <button type="button" className="btn primary wide xl" disabled={busy} onClick={() => void start()}>
          対局を始める
        </button>
        <button type="button" className="btn wide" onClick={() => navigate(`/g/${gid}/table`)}>
          卓に入る（オンライン対局）
        </button>
        <button type="button" className="btn ghost small" onClick={() => navigate(`/g/${gid}/table/local`)}>
          デバッグ卓
        </button>

        {sessions.length > 0 && (
          <ul className="list">
            {sessions.map((s) => {
              const n = state.games.filter((g) => g.sessionId === s.id && !g.deletedAt).length;
              const mine = member ? sessionBalances(state, s.id)[member.id]?.total : undefined;
              return (
                <li key={s.id}>
                  <button type="button" className="row-link session-row" onClick={() => navigate(`/g/${gid}/s/${s.id}`)}>
                    <span className="grow">
                      <strong>{s.title === s.playedOn ? fmtDate(s.playedOn) : s.title}</strong>
                      <small>
                        {n}半荘　1pt＝{s.rate}円
                      </small>
                    </span>
                    {mine !== undefined && <Yen v={mine} />}
                    <span className="chev" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <nav className="link-row">
          <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/stats`)}>
            通算成績
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/yakuman`)}>
            役満の殿堂
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/history`)}>
            履歴
          </button>
          <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/settings`)}>
            設定
          </button>
        </nav>
      </main>
    </>
  );
}
