import { useEffect, useMemo, useState } from "react";
import { loadGroups, request, saveGroup } from "../api";
import { navigate } from "../router";
import { useGroup, useToast } from "../store";
import { Dot, Sheet, Yen, fmtDate, today } from "../ui";
import { RULES } from "../../shared/mahjong";
import { sessionBalances } from "../logic";

export function Home() {
  const groups = Object.values(loadGroups());
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
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
        body: { name, code, members: list },
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
        <h1>サンマ帳</h1>
        <p>三人麻雀の点数から、精算と成績を自動で出します。</p>
      </header>

      {groups.length > 0 && (
        <section className="block">
          <h2>あなたのグループ</h2>
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

      <section className="block">
        <h2>グループを作る</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            グループ名
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：木曜サンマ" maxLength={40} required />
          </label>
          <label>
            合言葉（4文字以上）
            <input value={code} onChange={(e) => setCode(e.target.value)} minLength={4} maxLength={64} required />
            <small>メンバーに伝えて、入室のときに入れてもらいます。</small>
          </label>
          <label>
            メンバー（1行に1人、3人以上）
            <textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={4} placeholder={"ドナー\n赤堀\n唐司\n力"} required />
          </label>
          <button className="btn primary wide" disabled={busy}>
            {busy ? "作成中…" : "グループを作る"}
          </button>
        </form>
      </section>
      <p className="note center">招待された人は、送られてきたURLを開いてください。</p>
    </main>
  );
}

export function Join() {
  const { gid, setSaved } = useGroup();
  const toast = useToast();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ name: string }>("GET", `/groups/${gid}/public`)
      .then((r) => setGroupName(r.name))
      .catch(() => setNotFound(true));
  }, [gid]);

  if (notFound)
    return (
      <main className="page narrow">
        <p className="empty">グループが見つかりません。URLが正しいか確認してください。</p>
        <button type="button" className="btn ghost wide" onClick={() => navigate("/")}>
          最初の画面へ
        </button>
      </main>
    );

  return (
    <main className="page narrow">
      <header className="brand">
        <h1>{groupName ?? "　"}</h1>
        <p>合言葉を入れて入室します。</p>
      </header>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await request<{ token: string; name: string }>("POST", `/groups/${gid}/join`, { body: { code } });
            setSaved({ id: gid, name: r.name, token: r.token, memberId: null });
          } catch (err) {
            toast(err instanceof Error ? err.message : "入室できませんでした。");
          } finally {
            setBusy(false);
          }
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
        <h1>あなたはどなたですか</h1>
        <p>この端末で記録した操作は、選んだ名前で履歴に残ります。</p>
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
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="一覧にいない場合は名前を入力" maxLength={20} required />
        <button className="btn">追加して選ぶ</button>
      </form>
    </main>
  );
}

export function GroupHome() {
  const { state, gid, member, api, refresh, toast } = useGroup();
  const [open, setOpen] = useState(false);
  const last = state?.sessions.find((s) => !s.deletedAt);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState<number>(last?.rate ?? RULES.DEFAULT_RATE);
  const [chip, setChip] = useState<number>(last?.chipYen ?? RULES.DEFAULT_CHIP);

  const sessions = useMemo(() => state?.sessions.filter((s) => !s.deletedAt) ?? [], [state]);
  if (!state) return null;

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
      <button
        type="button"
        className="btn primary wide xl"
        onClick={() => {
          setTitle("");
          setDate(today());
          setRate(last?.rate ?? RULES.DEFAULT_RATE);
          setChip(last?.chipYen ?? RULES.DEFAULT_CHIP);
          setOpen(true);
        }}
      >
        今日の対局を始める
      </button>

      <section className="block">
        <h2>対局の記録</h2>
        {sessions.length === 0 && <p className="empty">まだ記録がありません。「今日の対局を始める」から作ってください。</p>}
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
                      {s.title === s.playedOn ? "" : `${fmtDate(s.playedOn)}　`}
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
      </section>

      <nav className="link-row">
        <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/stats`)}>
          通算成績
        </button>
        <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/history`)}>
          変更履歴
        </button>
        <button type="button" className="btn ghost" onClick={() => navigate(`/g/${gid}/settings`)}>
          設定
        </button>
      </nav>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="対局を始める"
        footer={
          <button
            type="button"
            className="btn primary wide"
            onClick={async () => {
              try {
                const s = await api<{ id: string }>("POST", "/sessions", { title, playedOn: date, rate, chipYen: chip });
                setOpen(false);
                await refresh();
                navigate(`/g/${gid}/s/${s.id}`);
              } catch (e) {
                toast(e instanceof Error ? e.message : "作成できませんでした。");
              }
            }}
          >
            始める
          </button>
        }
      >
        <div className="form">
          <label>
            日付
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            タイトル（省略すると日付）
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
          </label>
          <label>
            レート（1pt＝1,000点あたりの円、10円刻み）
            <input type="number" inputMode="numeric" step={RULES.RATE_STEP} min={RULES.RATE_STEP} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </label>
          <label>
            チップ1枚の値段（50円刻み）
            <input type="number" inputMode="numeric" step={RULES.CHIP_STEP} min={RULES.CHIP_MIN} value={chip} onChange={(e) => setChip(Number(e.target.value))} />
          </label>
        </div>
      </Sheet>
      </main>
    </>
  );
}
