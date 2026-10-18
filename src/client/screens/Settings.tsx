import { useState } from "react";
import { forgetGroup } from "../api";
import { navigate } from "../router";
import { gamesInOrder, useGroup } from "../store";
import { Confirm, Dot, Sheet, Yen, type ConfirmSpec } from "../ui";
import { RULES, calcGame } from "../../shared/mahjong";
import { downloadCsv, sessionBalances, sessionOf } from "../logic";
import type { Member } from "../../shared/types";

const PALETTE = ["#2F7D5B", "#C0392B", "#2E5E9E", "#B7791F", "#7A4FA0", "#1F8A8A", "#A0466B", "#5C6B2E", "#4A4A4A", "#D35400"];

export function SettingsView({ sid }: { sid?: string }) {
  const { state, saved, setSaved, member, gid } = useGroup();
  if (!state || !saved) return null;
  return (
    <>
      <section className="block">
        <h2>あなた</h2>
        <div className="row-between">
          <span className="name">
            <Dot m={member} />
            {member?.name ?? "未選択"}
          </span>
          <button type="button" className="btn small ghost" onClick={() => setSaved({ ...saved, memberId: null })}>
            名前を選び直す
          </button>
        </div>
      </section>
      {sid && <SessionSettings sid={sid} />}
      <MembersSettings />
      <GroupSettings />
      <section className="block">
        <h2>データ</h2>
        <button
          type="button"
          className="btn ghost wide"
          onClick={() => {
            const mm = new Map(state.members.map((m) => [m.id, m.name]));
            const ss = new Map(state.sessions.map((s) => [s.id, s]));
            downloadCsv("全半荘.csv", [
              ["日付", "対局", "半荘", "レート", "1位", "素点", "円", "2位", "素点", "円", "3位", "素点", "円"],
              ...gamesInOrder(state).map((g) => {
                const s = ss.get(g.sessionId);
                return [
                  s?.playedOn ?? "",
                  s?.title ?? "",
                  g.seq,
                  g.rate,
                  ...calcGame(g.scores, g.rate).flatMap((r) => [mm.get(r.memberId) ?? "", r.score * 100, r.yen]),
                ];
              }),
            ]);
          }}
        >
          全半荘をCSVで保存
        </button>
        <button
          type="button"
          className="btn ghost wide danger"
          onClick={() => {
            forgetGroup(gid);
            navigate("/");
          }}
        >
          この端末からグループを外す
        </button>
        <p className="note">外してもデータは消えません。合言葉を入れればまた入れます。</p>
      </section>
    </>
  );
}

function SessionSettings({ sid }: { sid: string }) {
  const { state, api, refresh, toast } = useGroup();
  const s = state ? sessionOf(state, sid) : undefined;
  const [title, setTitle] = useState(s?.title ?? "");
  const [date, setDate] = useState(s?.playedOn ?? "");
  const [rate, setRate] = useState(String(s?.rate ?? RULES.DEFAULT_RATE));
  const [chip, setChip] = useState(String(s?.chipYen ?? RULES.DEFAULT_CHIP));
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [rateScope, setRateScope] = useState<"future" | "all">("future");
  if (!state || !s) return null;
  const mm = new Map(state.members.map((m) => [m.id, m]));

  const save = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api("PATCH", `/sessions/${sid}`, body);
      toast(msg);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした。");
    }
  };

  const ImpactList = ({ next }: { next: typeof state }) => {
    const before = sessionBalances(state, sid);
    const after = sessionBalances(next, sid);
    const ids = Object.keys({ ...before, ...after });
    return (
      <table className="tbl diff">
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <td>{mm.get(id)?.name}</td>
              <td className="num">
                <Yen v={(after[id]?.total ?? 0) - (before[id]?.total ?? 0)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <section className="block">
      <h2>この対局の設定</h2>
      <div className="form">
        <label>
          タイトル
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} />
        </label>
        <label>
          日付
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn"
          disabled={title === s.title && date === s.playedOn}
          onClick={() => void save({ title, playedOn: date }, "保存しました")}
        >
          タイトルと日付を保存
        </button>

        <label>
          レート（1pt＝1,000点あたりの円、{RULES.RATE_STEP}円刻み）
          <input type="number" inputMode="numeric" step={RULES.RATE_STEP} min={RULES.RATE_STEP} value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <div className="seg">
          <button type="button" className={rateScope === "future" ? "on" : ""} onClick={() => setRateScope("future")}>
            これからの半荘だけ
          </button>
          <button type="button" className={rateScope === "all" ? "on" : ""} onClick={() => setRateScope("all")}>
            記録済みも含め全部
          </button>
        </div>
        <button
          type="button"
          className="btn"
          disabled={Number(rate) === s.rate}
          onClick={() => {
            const r = Number(rate);
            const next = {
              ...state,
              games: state.games.map((g) => (g.sessionId === sid && rateScope === "all" ? { ...g, rate: r } : g)),
            };
            setConfirm({
              title: "レートを変更しますか",
              body: (
                <>
                  <p>
                    1pt＝{s.rate}円 → {r}円（{rateScope === "all" ? "記録済みの半荘にも適用" : "これから記録する半荘だけ"}）
                  </p>
                  {rateScope === "all" && <ImpactList next={next} />}
                </>
              ),
              okLabel: "変更する",
              onOk: () => save({ rate: r, rateScope }, "レートを変更しました"),
            });
          }}
        >
          レートを変更
        </button>

        <label>
          チップ1枚の値段（{RULES.CHIP_MIN}円以上、{RULES.CHIP_STEP}円刻み）
          <input type="number" inputMode="numeric" step={RULES.CHIP_STEP} min={RULES.CHIP_MIN} value={chip} onChange={(e) => setChip(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn"
          disabled={Number(chip) === s.chipYen}
          onClick={() => {
            const c = Number(chip);
            const next = { ...state, sessions: state.sessions.map((x) => (x.id === sid ? { ...x, chipYen: c } : x)) };
            setConfirm({
              title: "チップの値段を変更しますか",
              body: (
                <>
                  <p>
                    1枚 {s.chipYen}円 → {c}円。記録済みのチップにも適用されます。
                  </p>
                  <ImpactList next={next} />
                </>
              ),
              okLabel: "変更する",
              onOk: () => save({ chipYen: c }, "チップの値段を変更しました"),
            });
          }}
        >
          チップの値段を変更
        </button>
      </div>
      <Confirm spec={confirm} onClose={() => setConfirm(null)} />
    </section>
  );
}

function MembersSettings() {
  const { state, api, refresh, toast } = useGroup();
  const [edit, setEdit] = useState<Member | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [newName, setNewName] = useState("");
  if (!state) return null;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした。");
    }
  };
  return (
    <section className="block">
      <h2>メンバー</h2>
      <ul className="list">
        {state.members.map((m) => (
          <li key={m.id} className="row-between pad">
            <span className={`name ${m.hidden ? "muted" : ""}`}>
              <Dot m={m} />
              {m.name}
              {m.hidden && <small>（非表示）</small>}
            </span>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                setEdit(m);
                setName(m.name);
                setColor(m.color);
              }}
            >
              編集
            </button>
          </li>
        ))}
      </ul>
      <form
        className="form inline"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api("POST", "/members", { name: newName }), `${newName}さんを追加しました`).then(() => setNewName(""));
        }}
      >
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新しいメンバーの名前" maxLength={20} required />
        <button className="btn">追加</button>
      </form>
      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title="メンバーを編集"
        footer={
          edit && (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  const m = edit;
                  setEdit(null);
                  void run(() => api("PATCH", `/members/${m.id}`, { hidden: !m.hidden }), m.hidden ? "一覧に戻しました" : "一覧から隠しました");
                }}
              >
                {edit.hidden ? "一覧に戻す" : "一覧から隠す"}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const m = edit;
                  setEdit(null);
                  void run(() => api("PATCH", `/members/${m.id}`, { name, color }), "保存しました");
                }}
              >
                保存
              </button>
            </>
          )
        }
      >
        <div className="form">
          <label>
            名前
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          </label>
          <div className="palette" role="radiogroup" aria-label="色">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                className={color === c ? "on" : ""}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
          </div>
          <p className="note">隠したメンバーも成績や履歴には残ります。</p>
        </div>
      </Sheet>
    </section>
  );
}

function GroupSettings() {
  const { state, gid, api, refresh, toast } = useGroup();
  const [name, setName] = useState(state?.group.name ?? "");
  const [code, setCode] = useState("");
  if (!state) return null;
  const url = `${location.origin}/g/${gid}`;
  return (
    <section className="block">
      <h2>グループ</h2>
      <div className="form">
        <label>
          招待URL（合言葉と一緒にメンバーへ送ります）
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </label>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              if (navigator.share) await navigator.share({ title: state.group.name, url });
              else {
                await navigator.clipboard.writeText(url);
                toast("URLをコピーしました");
              }
            } catch {
              /* キャンセル */
            }
          }}
        >
          URLを送る
        </button>
        <label>
          グループ名
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <button
          type="button"
          className="btn"
          disabled={name === state.group.name}
          onClick={async () => {
            try {
              await api("PATCH", "", { name });
              toast("グループ名を変更しました");
              await refresh();
            } catch (e) {
              toast(e instanceof Error ? e.message : "保存できませんでした。");
            }
          }}
        >
          グループ名を変更
        </button>
        <label>
          新しい合言葉（4文字以上）
          <input value={code} onChange={(e) => setCode(e.target.value)} minLength={4} maxLength={64} />
          <small>変えても、すでに入室している端末はそのまま使えます。</small>
        </label>
        <button
          type="button"
          className="btn"
          disabled={code.length < 4}
          onClick={async () => {
            try {
              await api("PATCH", "", { code });
              setCode("");
              toast("合言葉を変更しました");
            } catch (e) {
              toast(e instanceof Error ? e.message : "保存できませんでした。");
            }
          }}
        >
          合言葉を変更
        </button>
      </div>
    </section>
  );
}
