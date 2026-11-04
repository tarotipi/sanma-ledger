import { useMemo, useState } from "react";
import { useGroup } from "../store";
import { navigate, usePath } from "../router";
import { Sheet } from "../ui";
import { SpiritArt } from "../gacha/SpiritArt";
import { useGacha } from "../gacha/useGacha";
import "../gacha/gacha.css";
import {
  GACHA,
  SPIRITS,
  SYSTEMS,
  buildCollection,
  itemById,
  pullCost,
  rollPull,
  spiritById,
  type CoinBalance,
  type CoinType,
  type Collection,
  type PullResult,
  type Spirit,
} from "../../shared/gacha";

type Opening = { coin: CoinType; results: PullResult[]; phase: "shake" | "open" };

/** 雀霊カプセル（G-01〜G-09）。点数には影響しないおまけのコレクション */
export function GachaScreen() {
  const { gid, toast, admin } = useGroup();
  const { query } = usePath();
  const { data, setData, error, call } = useGacha(gid);
  // デバッグは全キャラが見えるので、管理者だけが使える
  const [debug, setDebug] = useState(admin && query.get("debug") === "1");
  const [debugPulls, setDebugPulls] = useState<PullResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [detail, setDetail] = useState<Spirit | null>(null);

  const pulls = useMemo(() => (debug ? debugPulls : (data?.pulls.map((p) => p.result) ?? [])), [debug, debugPulls, data]);
  const bond = useMemo(() => (debug ? {} : (data?.bond ?? {})), [debug, data]);
  const col = useMemo(() => buildCollection(pulls, bond), [pulls, bond]);
  const coins: CoinBalance = debug ? { normal: Infinity, yakuman: Infinity, chombo: Infinity } : (data?.coins ?? { normal: 0, yakuman: 0, chombo: 0 });
  const partner = data?.partner;
  const art = useMemo(() => data?.art ?? {}, [data]);

  const pull = async (coin: CoinType, count: number) => {
    if (busy) return;
    let results: PullResult[];
    if (debug) {
      // デバッグ：クライアント内だけで回す（サーバーへ送らない・記録しない）
      const owned = [...col.spirits];
      results = [];
      for (let i = 0; i < count; i++) {
        const r = rollPull(coin, Math.random(), Math.random(), Math.random(), owned, col.items);
        if (r.kind === "spirit") owned.push(r.spiritId);
        results.push(r);
      }
      setDebugPulls((p) => [...p, ...results]);
    } else {
      setBusy(true);
      try {
        const res = await call<{ results: PullResult[]; coins: CoinBalance; art: Record<string, string> }>("POST", "/pull", { coin, count });
        results = res.results;
        const t = new Date().toISOString();
        setData((d) =>
          d
            ? { ...d, coins: res.coins, art: res.art, pulls: [...d.pulls, ...res.results.map((r, i) => ({ id: `new${t}${i}`, coin, result: r, createdAt: t }))] }
            : d,
        );
      } catch (e) {
        toast(e instanceof Error ? e.message : "回せませんでした。");
        return;
      } finally {
        setBusy(false);
      }
    }
    setOpening({ coin, results, phase: "shake" });
    window.setTimeout(() => setOpening((o) => (o && o.results === results ? { ...o, phase: "open" } : o)), coin === "yakuman" ? 2200 : 1200);
  };

  const setPartner = async (spiritId: string) => {
    if (debug) {
      toast("デバッグ中は相棒を保存しません");
      return;
    }
    try {
      await call<{ partner: string }>("PUT", "/partner", { spiritId });
      setData((d) => (d ? { ...d, partner: spiritId } : d));
      toast("相棒にしました");
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存できませんでした。");
    }
  };

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => navigate(`/g/${gid}`)} aria-label="戻る">
          ‹
        </button>
        <h1>雀霊カプセル</h1>
        <span />
      </header>
      {debug && <div className="gacha-debug-banner">デバッグ中（記録されません）</div>}
      <main className="page gacha">
        {error && !debug ? (
          <p className="note">{error}</p>
        ) : !data && !debug ? (
          <div className="loading" aria-label="読み込み中" />
        ) : (
          <>
            <p className="note">半荘ごとに素点1万点につき雀霊コイン1枚（最低1枚）、役満1回で役満コイン1枚、チョンボ1回でチョンボコイン1枚。点数・精算には影響しません。</p>
            <div className="gacha-machines">
              <Machine coin="normal" have={coins.normal} busy={busy} onPull={(n) => void pull("normal", n)} />
              <Machine coin="yakuman" have={coins.yakuman} busy={busy} onPull={(n) => void pull("yakuman", n)} />
              <Machine coin="chombo" have={coins.chombo} busy={busy} onPull={(n) => void pull("chombo", n)} />
            </div>
            <Zukan col={col} reveal={debug} partner={partner} art={art} onOpen={setDetail} />
          </>
        )}
        {admin && (
          <button type="button" className="gacha-debug-toggle" onClick={() => setDebug((d) => !d)}>
            {debug ? "デバッグを終わる" : "デバッグ"}
          </button>
        )}
      </main>

      {opening && <OpeningView o={opening} col={col} art={art} onClose={() => setOpening(null)} onSkip={() => setOpening({ ...opening, phase: "open" })} />}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail && (debug || col.spirits.includes(detail.id)) ? detail.stages[Math.max(0, col.stages[detail.id] ?? 0)] : "？？？"}>
        {detail && (
          <Detail
            sp={detail}
            col={col}
            reveal={debug}
            art={art[detail.id]}
            bondGames={bond[detail.id] ?? 0}
            isPartner={partner === detail.id}
            onPartner={() => void setPartner(detail.id)}
          />
        )}
      </Sheet>
    </>
  );
}

function Machine({ coin, have, busy, onPull }: { coin: CoinType; have: number; busy: boolean; onPull: (n: number) => void }) {
  const gold = coin === "yakuman";
  const chombo = coin === "chombo";
  const label = gold ? "役満コイン" : chombo ? "チョンボコイン" : "雀霊コイン";
  const reason = (n: number) => (have >= pullCost(coin, n) ? null : `${label}があと${pullCost(coin, n) - have}枚必要`);
  return (
    <section className={`gacha-machine ${gold ? "gold" : ""} ${chombo ? "chombo" : ""}`}>
      <div className="gacha-coin">
        <span className="gacha-coin-icon" aria-hidden>
          {gold ? "役" : chombo ? "チ" : "雀"}
        </span>
        <span>
          {label}
          <strong>{Number.isFinite(have) ? have : "∞"}</strong>枚
        </span>
      </div>
      <p className="gacha-rate">{gold ? "伝説の雀霊 1/2・伝説の装備 1/2" : chombo ? "1枚目で専用の雀霊を解放。その後は3枚で1段階進化" : "雀霊 1/5・装備 4/5"}</p>
      <div className="gacha-btns">
        {(chombo ? [1] : [1, GACHA.MULTI]).map((n) => (
          <div key={n}>
            <button type="button" className={`btn wide ${gold ? "gold-btn" : "primary"}`} disabled={busy || !!reason(n)} onClick={() => onPull(n)}>
              {n === 1 ? "1回" : "10連"}（{pullCost(coin, n)}枚）
            </button>
            {reason(n) && <small className="gacha-why">{reason(n)}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function resultText(r: PullResult, owned: boolean): { title: string; sub: string } {
  const sp = spiritById(r.spiritId);
  if (r.kind === "spirit") return { title: sp?.stages[0] ?? "雀霊", sub: sp?.rarity === "legend" ? "伝説の雀霊！" : "新しい雀霊！" };
  const it = r.itemId ? itemById(r.itemId) : undefined;
  if (r.converted) return { title: it?.name ?? "装備", sub: `${sp?.stages[0]}が重複 → 専属装備に変化` };
  // 装備名は持ち主の雀霊を解放するまで分からない（G-06）
  if (!owned) return { title: "？？？の装備", sub: "まだ出会っていない雀霊の専属装備" };
  return { title: it?.name ?? "装備", sub: `${sp?.stages[0]}の専属装備` };
}

function OpeningView({ o, col, art, onClose, onSkip }: { o: Opening; col: Collection; art: Record<string, string>; onClose: () => void; onSkip: () => void }) {
  const gold = o.coin === "yakuman";
  return (
    <div className={`gacha-overlay ${gold ? "gold" : ""}`} role="dialog" aria-label="カプセルの結果" onClick={o.phase === "shake" ? onSkip : undefined}>
      {o.phase === "shake" ? (
        <div className="capsule-wrap">
          {gold && <div className="capsule-rays" aria-hidden />}
          <div className={`capsule ${gold ? "gold" : ""}`}>
            <div className="capsule-top" />
            <div className="capsule-bottom" />
          </div>
          <p>{gold ? "役満カプセル開封中…" : "カプセルが揺れている…"}</p>
        </div>
      ) : (
        <div className="gacha-results">
          <ul className={o.results.length > 1 ? "multi" : "single"}>
            {o.results.map((r, i) => {
              const t = resultText(r, col.spirits.includes(r.spiritId));
              const legend = spiritById(r.spiritId)?.rarity === "legend";
              return (
                <li key={i} className={`gacha-result ${legend ? "legend" : ""} ${r.kind}`} style={{ animationDelay: `${i * 0.08}s` }}>
                  {r.kind === "spirit" ? (
                    <SpiritArt spiritId={r.spiritId} stage={0} art={art[r.spiritId]} full={o.results.length > 1 ? "thumb" : "card"} size={o.results.length > 1 ? 72 : 220} />
                  ) : (
                    <ItemIcon color={spiritById(r.spiritId)?.color ?? "#888"} legend={legend} size={o.results.length > 1 ? 56 : 120} src={col.spirits.includes(r.spiritId) ? itemArt(art[r.spiritId], r.itemId) : null} />
                  )}
                  <strong>{t.title}</strong>
                  <small>{t.sub}</small>
                </li>
              );
            })}
          </ul>
          <p className="note">所持している雀霊：{col.spirits.length} / {SPIRITS.length}</p>
          <button type="button" className="btn primary wide" onClick={onClose}>
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

/** 装備の画像URL（持ち主の雀霊を持っているときだけ） */
function itemArt(url: string | undefined, itemId: string | null): string | null {
  const n = itemId?.split("-").pop();
  return url && n ? url.replace("{file}", `item-${n}.webp`) : null;
}

function ItemIcon({ color, legend, size, src }: { color: string; legend: boolean; size: number; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img className="item-photo" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path d="M20 3 L35 12 L35 28 L20 37 L5 28 L5 12 Z" fill={color} stroke={legend ? "#E8B931" : "#fff"} strokeWidth={2.5} />
      <path d="M20 10 L28 15 L28 25 L20 30 L12 25 L12 15 Z" fill="#fff" opacity={0.35} />
    </svg>
  );
}

function Zukan({ col, reveal, partner, art, onOpen }: { col: Collection; reveal: boolean; partner?: string; art: Record<string, string>; onOpen: (s: Spirit) => void }) {
  return (
    <section>
      <h2 className="gacha-h2">
        図鑑 <small>{col.spirits.length} / {SPIRITS.length}</small>
      </h2>
      <ul className="zukan">
        {SPIRITS.map((s) => {
          const owned = col.spirits.includes(s.id);
          const show = owned || reveal;
          const stage = Math.max(0, col.stages[s.id] ?? 0);
          return (
            <li key={s.id}>
              <button type="button" className={`zukan-cell ${s.rarity === "legend" ? "legend" : ""} ${owned ? "owned" : ""}`} onClick={() => onOpen(s)}>
                <SpiritArt spiritId={s.id} stage={owned ? stage : 0} size={72} silhouette={!show} art={art[s.id]} full="thumb" />
                <span className="zukan-name">{show ? s.stages[owned ? stage : 0] : "？？？"}</span>
                {owned && <span className="zukan-stage">{stage === 0 ? "基本" : `第${stage}進化`}</span>}
                {partner === s.id && <span className="zukan-partner">相棒</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Detail({ sp, col, reveal, art, bondGames, isPartner, onPartner }: { sp: Spirit; col: Collection; reveal: boolean; art?: string; bondGames: number; isPartner: boolean; onPartner: () => void }) {
  const owned = col.spirits.includes(sp.id);
  const show = owned || reveal;
  const stage = Math.max(0, col.stages[sp.id] ?? 0);
  const next = Math.min(GACHA.MAX_STAGE, stage + 1);
  // 解放した進化段階の中から、見たい姿を選べる
  const [viewStage, setViewStage] = useState<number | null>(null);
  const shown = owned ? Math.min(viewStage ?? stage, stage) : 0;
  return (
    <div className="gacha-detail">
      <div className="gacha-detail-art">
        <SpiritArt spiritId={sp.id} stage={shown} size={260} silhouette={!show} art={art} full="card" />
      </div>
      {owned && art && stage > 0 && (
        <div className="stage-picker">
          {Array.from({ length: stage + 1 }, (_, i) => (
            <button key={i} type="button" className={i === shown ? "on" : ""} aria-label={i === 0 ? "基本の姿" : `第${i}進化の姿`} onClick={() => setViewStage(i)}>
              <SpiritArt spiritId={sp.id} stage={i} size={44} art={art} />
            </button>
          ))}
        </div>
      )}
      <p className="gacha-tags">
        <span style={{ background: show ? sp.color : "#777" }}>{show ? SYSTEMS[sp.system].name : "？？？"}</span>
        {sp.rarity === "legend" && <span className="gold">伝説</span>}
        {owned && <span>{stage === 0 ? "基本" : `第${stage}進化`}</span>}
      </p>
      {show ? (
        <>
          <p>{sp.desc}</p>
          <ol className="gacha-stages">
            {sp.stages.map((n, i) => (
              <li key={n} className={owned && i <= stage ? "done" : ""}>
                {i === 0 ? "基本" : `第${i}進化`}：{n}
              </li>
            ))}
          </ol>
          <h3 className="gacha-h3">専属装備{owned && stage < GACHA.MAX_STAGE ? `（第${next}進化には各${next}個）` : ""}</h3>
          <ul className="gacha-items">
            {sp.itemIds.map((id) => {
              const n = col.items[id] ?? 0;
              return (
                <li key={id}>
                  <ItemIcon color={sp.color} legend={sp.rarity === "legend"} size={32} src={owned ? itemArt(art, id) : null} />
                  <span className="grow">{itemById(id)?.name}</span>
                  <strong className={owned && n >= next ? "ok" : ""}>
                    {n}
                    {owned && stage < GACHA.MAX_STAGE ? ` / ${next}` : ""}
                  </strong>
                </li>
              );
            })}
          </ul>
          {!owned && <p className="note">まだ持っていません。装備だけ先に集めることもできます。</p>}
          {owned && (
            <p className="note">
              相棒にして打った半荘：{bondGames}（あと{GACHA.BOND_GAMES - (bondGames % GACHA.BOND_GAMES)}半荘で専属装備が1個増えます）
            </p>
          )}
          {owned && (
            <button type="button" className="btn primary wide" disabled={isPartner} onClick={onPartner}>
              {isPartner ? "相棒にしています" : "相棒に設定"}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="note">まだ出会っていない雀霊です。カプセルを回すと出会えるかもしれません。</p>
          <ul className="gacha-items">
            {sp.itemIds.map((id) => (
              <li key={id}>
                <ItemIcon color="#777" legend={sp.rarity === "legend"} size={22} />
                <span className="grow">？？？</span>
                <strong>{col.items[id] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
