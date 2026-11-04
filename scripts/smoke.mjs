// 手元のサーバーに対してAPIを一通り叩く確認用スクリプト: node scripts/smoke.mjs http://127.0.0.1:8787
const base = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "OK " : "NG "} ${msg}`); if (!cond) fails++; };
const uuid = () => crypto.randomUUID();
// 役満の写真は本体とサムネイルを1回で送る
function photoForm(id, sessionId, yakumanId, img) {
  const f = new FormData();
  f.set("id", id);
  f.set("sessionId", sessionId);
  f.set("yakumanId", yakumanId);
  f.set("width", "1");
  f.set("height", "1");
  f.set("full", new File([img], "full.jpg", { type: "image/jpeg" }));
  f.set("thumb", new File([img], "thumb.jpg", { type: "image/jpeg" }));
  return f;
}
async function call(method, path, { token, member, body, raw, type, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (member) headers["x-member"] = member;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type;
  const res = await fetch(base + "/api" + path, { method, headers, body: form ?? raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, data: ct.includes("json") ? await res.json() : await res.arrayBuffer() };
}

const g = await call("POST", "/groups", { body: { name: "テスト卓", code: "pass1234", members: ["ドナー", "赤堀", "唐司", "力"] } });
ok(g.status === 200 && g.data.token, "グループ作成");
const gid = g.data.groupId;
ok((await call("POST", `/groups/${gid}/join`, { body: { code: "wrong" } })).status === 401, "合言葉違いは401");
const j = await call("POST", `/groups/${gid}/join`, { body: { code: "pass1234" } });
ok(j.status === 200, "合言葉で入室");
const T = j.data.token;
ok((await call("GET", `/g/${gid}/state`)).status === 401, "トークンなしは401");
ok((await call("GET", `/g/${gid}/state`, { token: T.replace(/.$/, "x") })).status === 401, "改ざんトークンは401");
let st = (await call("GET", `/g/${gid}/state`, { token: T })).data;
ok(st.members.length === 4, "メンバー4人");
const [A, B, C, D] = st.members.map((m) => m.id);
const M = A;
const s = await call("POST", `/g/${gid}/sessions`, { token: T, member: M, body: { playedOn: "2026-10-18", rate: 60, chipYen: 100 } });
ok(s.status === 200, "セッション作成");
const sid = s.data.id;
ok((await call("POST", `/g/${gid}/sessions`, { token: T, member: M, body: { playedOn: "2026-10-18", rate: 65, chipYen: 100 } })).status === 400, "レート10円刻み以外は400");
ok((await call("POST", `/g/${gid}/sessions`, { token: T, member: M, body: { playedOn: "2026-10-18", rate: 60, chipYen: 120 } })).status === 400, "チップ50円刻み以外は400");

const g1 = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { sessionId: sid, scores: [{ memberId: A, score: 320 }, { memberId: B, score: 780 }, { memberId: C, score: -50 }] } });
ok(g1.status === 200 && g1.data.seq === 1, "半荘1を記録");
const bad = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { sessionId: sid, scores: [{ memberId: A, score: 320 }, { memberId: B, score: 780 }, { memberId: C, score: -40 }] } });
ok(bad.status === 400 && /1000点/.test(bad.data.error), "合計違いは400：" + bad.data.error);
const tie = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { sessionId: sid, scores: [{ memberId: A, score: 400 }, { memberId: B, score: 400 }, { memberId: D, score: 250 }] } });
ok(tie.status === 400, "同点未指定は400");
const g2 = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { sessionId: sid, scores: [{ memberId: A, score: 400, tie: 2 }, { memberId: B, score: 400, tie: 1 }, { memberId: D, score: 250 }] } });
ok(g2.status === 200 && g2.data.seq === 2, "同点指定ありで半荘2（Dが途中参加）");
const e1 = await call("PATCH", `/g/${gid}/games/${g1.data.id}`, { token: T, member: M, body: { scores: [{ memberId: A, score: 330 }, { memberId: B, score: 770 }, { memberId: C, score: -50 }] } });
ok(e1.status === 200, "半荘1を編集");
ok((await call("POST", `/g/${gid}/games/${g2.data.id}/delete`, { token: T, member: M })).status === 200, "半荘2を削除");
ok((await call("POST", `/g/${gid}/games/${g2.data.id}/restore`, { token: T, member: M })).status === 200, "半荘2を復元");
ok((await call("POST", `/g/${gid}/chips`, { token: T, member: M, body: { sessionId: sid, lines: [{ memberId: A, count: 3 }, { memberId: B, count: -2 }], memo: "" } })).status === 400, "チップ合計≠0は400");
ok((await call("POST", `/g/${gid}/chips`, { token: T, member: M, body: { sessionId: sid, lines: [{ memberId: A, count: 3 }, { memberId: B, count: -3 }], memo: "途中" } })).status === 200, "チップ記録");
ok((await call("POST", `/g/${gid}/adjustments`, { token: T, member: M, body: { sessionId: sid, kind: "external", lines: [{ memberId: B, yen: -3000 }], memo: "場代 1位負担" } })).status === 200, "調整（外部）");
ok((await call("POST", `/g/${gid}/adjustments`, { token: T, member: M, body: { sessionId: sid, kind: "internal", lines: [{ memberId: B, yen: -100 }], memo: "x" } })).status === 400, "メンバー間で合計≠0は400");
ok((await call("POST", `/g/${gid}/settlements`, { token: T, member: M, body: { sessionId: sid, memberId: C, yen: -3300 } })).status === 200, "精算済み");
const rateAll = await call("PATCH", `/g/${gid}/sessions/${sid}`, { token: T, member: M, body: { rate: 50, rateScope: "all" } });
ok(rateAll.status === 200, "レートを全半荘に適用");
// 写真（1x1 JPEG）
const jpg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
st = (await call("GET", `/g/${gid}/state`, { token: T })).data;
ok(st.games.length === 2 && st.games.every((x) => x.rate === 50), "全半荘のレートが50");
ok(st.games.find((x) => x.id === g2.data.id).scores.find((x) => x.memberId === B).tie === 1, "同点指定が保存されている");
const logs = (await call("GET", `/g/${gid}/logs?limit=100`, { token: T })).data.logs;
ok(logs.length >= 14, `履歴 ${logs.length}件`);
ok(logs.some((l) => l.entity === "games" && l.action === "update" && l.actorName === "ドナー"), "編集の履歴に操作者名");
ok(logs.some((l) => l.action === "restore"), "復元の履歴");
const v = (await call("GET", `/g/${gid}/version`, { token: T })).data.version;
ok(v === logs[0].id, "versionは最新の履歴ID");
// 他グループのトークンでは見えない
const g9 = await call("POST", "/groups", { body: { name: "別卓", code: "zzzz9999", members: ["a", "b", "c"] } });
ok((await call("GET", `/g/${gid}/state`, { token: g9.data.token })).status === 401, "別グループのトークンは401");
ok((await call("GET", `/g/${g9.data.groupId}/games/${g1.data.id}/delete`, { token: g9.data.token })).status === 404, "他グループの行は触れない");
ok((await call("POST", `/g/${g9.data.groupId}/games/${g1.data.id}/delete`, { token: g9.data.token })).status === 404, "他グループの半荘は削除できない");
for (let i = 0; i < 10; i++) await call("POST", `/groups/${g9.data.groupId}/join`, { body: { code: "bad" } });
ok((await call("POST", `/groups/${g9.data.groupId}/join`, { body: { code: "zzzz9999" } })).status === 429, "10回失敗で入室を一時停止");
// バイイン・返却・枚数
const ce = await call("POST", `/g/${gid}/chip-events`, { token: T, member: M, body: { sessionId: sid, memberIds: [A, B], kind: "buy", amount: 2000 } });
ok(ce.status === 200 && ce.data.length === 2, "2人同時にバイイン");
ok((await call("POST", `/g/${gid}/chip-events`, { token: T, member: M, body: { sessionId: sid, memberIds: [B], kind: "return", amount: 500 } })).status === 200, "返却");
ok((await call("POST", `/g/${gid}/chip-events`, { token: T, member: M, body: { sessionId: sid, memberIds: [A], kind: "count", amount: 12 } })).status === 200, "枚数を入力");
ok((await call("POST", `/g/${gid}/chip-events`, { token: T, member: M, body: { sessionId: sid, memberIds: [A, B], kind: "count", amount: 1 } })).status === 400, "枚数は1人ずつ");
ok((await call("POST", `/g/${gid}/chip-events`, { token: T, member: M, body: { sessionId: sid, memberIds: [A], kind: "buy", amount: 0 } })).status === 400, "0円のバイインは400");
ok((await call("POST", `/g/${gid}/chip_events/${ce.data[0].id}/delete`, { token: T, member: M })).status === 200, "バイインを削除");
const yk = await call("POST", `/g/${gid}/yakuman`, { token: T, member: M, body: { sessionId: sid, gameId: g1.data.id, memberId: B, name: "国士無双" } });
ok(yk.status === 200, "役満を記録");
// 同じ半荘に2件目の役満
const yk2 = await call("POST", `/g/${gid}/yakuman`, { token: T, member: M, body: { sessionId: sid, gameId: g1.data.id, memberId: A, name: "大三元" } });
ok(yk2.status === 200, "同じ半荘に2件目の役満");
ok((await call("POST", `/g/${gid}/yakuman`, { token: T, member: M, body: { sessionId: sid, gameId: g1.data.id, memberId: D } })).status === 400, "卓にいない人の役満は400");
// 再送しても二重にならない
const yid = uuid();
const yr1 = await call("POST", `/g/${gid}/yakuman`, { token: T, member: M, body: { clientId: yid, sessionId: sid, memberId: D, name: "四暗刻" } });
const yr2 = await call("POST", `/g/${gid}/yakuman`, { token: T, member: M, body: { clientId: yid, sessionId: sid, memberId: D, name: "四暗刻" } });
ok(yr1.status === 200 && yr2.status === 200 && yr1.data.id === yid && yr2.data.id === yid && yr1.data.gameId === null, "役満の再送は同じ記録を返す（半荘なしでも記録できる）");
// 次の半荘へ自動で紐づく
const gid3 = uuid();
const g3 = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { clientId: gid3, sessionId: sid, scores: [{ memberId: A, score: 500 }, { memberId: B, score: 300 }, { memberId: D, score: 250 }] } });
ok(g3.status === 200 && g3.data.id === gid3, "端末のIDで半荘を記録");
const g3b = await call("POST", `/g/${gid}/games`, { token: T, member: M, body: { clientId: gid3, sessionId: sid, scores: [{ memberId: A, score: 500 }, { memberId: B, score: 300 }, { memberId: D, score: 250 }] } });
ok(g3b.status === 200 && g3b.data.seq === g3.data.seq, "半荘の再送は同じ半荘を返す");
const stY = (await call("GET", `/g/${gid}/state`, { token: T })).data;
ok(stY.games.filter((x) => x.id === gid3).length === 1, "半荘が二重にならない");
ok(stY.yakuman.find((y) => y.id === yid)?.gameId === gid3, "待っていた役満が次の半荘へ自動で紐づく");
const unl = await call("PATCH", `/g/${gid}/yakuman/${yid}`, { token: T, member: M, body: { gameId: null } });
ok(unl.status === 200 && unl.data.gameId === null, "紐づけを外す");
ok((await call("PATCH", `/g/${gid}/yakuman/${yid}`, { token: T, member: M, body: { gameId: g1.data.id } })).status === 400, "その人がいない半荘へは紐づけられない");
// 写真
const photoId = uuid();
const yp = await call("POST", `/g/${gid}/photos`, { token: T, member: M, form: photoForm(photoId, sid, yk.data.id, jpg) });
ok(yp.status === 200 && yp.data.yakumanId === yk.data.id && yp.data.gameId === null, "役満の記念写真");
const ypAgain = await call("POST", `/g/${gid}/photos`, { token: T, member: M, form: photoForm(photoId, sid, yk.data.id, jpg) });
ok(ypAgain.status === 200, "写真の再送も成功");
const stP = (await call("GET", `/g/${gid}/state`, { token: T })).data;
const ph = stP.photos.filter((x) => x.id === photoId);
ok(ph.length === 1, "写真が二重にならない");
const thumbRes = await fetch(base + ph[0].thumbUrl);
ok(thumbRes.status === 200 && (await thumbRes.arrayBuffer()).byteLength === jpg.length, "署名付きURLでサムネイルを取得");
const fullRes = await fetch(base + ph[0].url);
ok(fullRes.status === 200, "署名付きURLで本体を取得");
ok(/public/.test(fullRes.headers.get("cache-control") ?? ""), "画像はキャッシュできる");
ok((await fetch(base + ph[0].url.replace(/s=[^&]+/, "s=bad"))).status === 403, "署名が違えば403");
ok((await fetch(base + ph[0].url.replace("/full", "/thumb"))).status === 403, "別の画像に署名は使い回せない");
ok((await call("POST", `/g/${gid}/photos`, { token: T, member: M, form: photoForm(uuid(), sid, uuid(), jpg) })).status === 404, "役満が届く前の写真は404（送り直す）");
// トークンのURLは WebSocket 以外で受け付けない
ok((await fetch(`${base}/api/g/${gid}/state?t=${encodeURIComponent(T)}`)).status === 401, "?t= では読めない");
// 管理者パスワード（node scripts/smoke.mjs <URL> <管理者パスワード>）
const adminPw = process.argv[3];
ok((await call("POST", `/g/${gid}/admin/verify`, { token: T, body: { password: "wrong" } })).status === 403, "違う管理者パスワードは403");
if (adminPw) ok((await call("POST", `/g/${gid}/admin/verify`, { token: T, body: { password: adminPw } })).status === 200, "管理者パスワードの確認");
// 半荘を消すと役満コインも減る
if (M) {
  const gachaBefore = (await call("GET", `/g/${gid}/gacha`, { token: T, member: B })).data;
  ok((await call("POST", `/g/${gid}/games/${g1.data.id}/delete`, { token: T, member: M })).status === 200, "半荘1を一時的に削除");
  const gachaAfter = (await call("GET", `/g/${gid}/gacha`, { token: T, member: B })).data;
  ok(gachaAfter.earned.yakuman === gachaBefore.earned.yakuman - 1, "削除した半荘の役満はコインに数えない");
  ok((await call("POST", `/g/${gid}/games/${g1.data.id}/restore`, { token: T, member: M })).status === 200, "半荘1を復元");
}
const st3 = (await call("GET", `/g/${gid}/state`, { token: T })).data;
ok(st3.chipEvents.length === 4 && st3.chipEvents.filter((e) => e.deletedAt).length === 1, "stateにチップ記録");
ok(st3.yakuman.length === 3 && st3.yakuman[0].name === "国士無双", "stateに役満");

// チョンボ：点数は変わらず、コインが入る
const chId = uuid();
const beforeCh = (await call("GET", `/g/${gid}/gacha`, { token: T, member: C })).data;
const ch1 = await call("POST", `/g/${gid}/chombo`, { token: T, member: M, body: { clientId: chId, sessionId: sid, memberId: C, memo: "誤ロン" } });
const ch2 = await call("POST", `/g/${gid}/chombo`, { token: T, member: M, body: { clientId: chId, sessionId: sid, memberId: C, memo: "誤ロン" } });
ok(ch1.status === 200 && ch2.data.id === chId, "チョンボの記録（再送で二重にならない）");
const afterCh = (await call("GET", `/g/${gid}/gacha`, { token: T, member: C })).data;
ok(afterCh.coins.chombo === beforeCh.coins.chombo + 1, "チョンボコインが1枚入る");
const pullCh = await call("POST", `/g/${gid}/gacha/pull`, { token: T, member: C, body: { coin: "chombo", count: 1 } });
ok(pullCh.status === 200 && pullCh.data.results[0].spiritId === "drake" && pullCh.data.art.drake, "チョンボコインでドレイクを解放");
ok((await call("POST", `/g/${gid}/gacha/pull`, { token: T, member: C, body: { coin: "chombo", count: 1 } })).status === 400, "コインがなければ回せない");
ok((await call("POST", `/g/${gid}/chombo/${chId}/delete`, { token: T, member: M })).status === 200, "チョンボの記録を削除");

// ホーム画面に追加したアプリの設定
const mf = await fetch(`${base}/api/manifest/${gid}`);
const mfj = await mf.json();
ok(mf.status === 200 && mfj.start_url === `/g/${gid}`, "アプリの開始ページがグループになる");
ok(!JSON.stringify(mfj).includes(T), "アプリの設定に入室の鍵を含めない");
ok((await fetch(`${base}/api/manifest/not-found`)).status === 404, "ないグループは404");

const gpage = await (await fetch(`${base}/g/${gid}/settings`)).text();
ok(gpage.includes(`/api/manifest/${gid}`), "グループのページは最初からそのグループの設定を指す");
ok((await (await fetch(`${base}/`)).text()).includes("/manifest.webmanifest"), "最初の画面は共通の設定のまま");

// 合言葉なしのグループ：名前だけで作成でき、URLだけで入れる
const open = await call("POST", "/groups", { body: { members: ["x"] } });
ok(open.status === 200 && open.data.name === "サンマ帳", "名前だけでグループ作成（グループ名は既定値）");
const pub = await call("GET", `/groups/${open.data.groupId}/public`);
ok(pub.data.needsCode === false, "合言葉なしと判定");
const oj = await call("POST", `/groups/${open.data.groupId}/join`, { body: {} });
ok(oj.status === 200 && oj.data.token, "合言葉なしで入室");
const OT = oj.data.token;
ok((await call("PATCH", `/g/${open.data.groupId}`, { token: OT, body: { code: "abcd" } })).status === 200, "あとから合言葉を設定");
ok((await call("GET", `/groups/${open.data.groupId}/public`)).data.needsCode === true, "合言葉ありに変わる");
ok((await call("POST", `/groups/${open.data.groupId}/join`, { body: { code: "" } })).status === 401, "合言葉なしでは入れなくなる");
ok((await call("PATCH", `/g/${open.data.groupId}`, { token: OT, body: { code: "" } })).status === 200, "合言葉をなしに戻す");
const bg = await call("PUT", `/g/${open.data.groupId}/background`, { token: OT, raw: jpg, type: "image/jpeg" });
ok(bg.status === 200 && bg.data.bg, "背景写真を設定");
const st2 = (await call("GET", `/g/${open.data.groupId}/state`, { token: OT })).data;
ok(st2.group.bg === bg.data.bg && st2.group.hasCode === false, "stateに背景と合言葉の有無");
const bgf = await fetch(base + st2.group.bgUrl);
ok(bgf.status === 200, "署名付きURLで背景写真を取得");
const bg2 = await call("PUT", `/g/${open.data.groupId}/background`, { token: OT, raw: jpg, type: "image/jpeg" });
ok(bg2.data.bg !== bg.data.bg, "背景を変えると版が変わる");
ok((await fetch(base + (await call("GET", `/g/${open.data.groupId}/state`, { token: OT })).data.group.bgUrl)).status === 200, "新しい背景を直後に取得できる");
ok((await call("DELETE", `/g/${open.data.groupId}/background`, { token: OT })).status === 200, "背景を消す");
console.log(fails ? `\n${fails}件失敗` : "\nすべて成功");
console.log("GID", gid, "MEMBER", M, "SID", sid);
process.exit(fails ? 1 : 0);
