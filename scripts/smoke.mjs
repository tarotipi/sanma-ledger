// 手元のサーバーに対してAPIを一通り叩く確認用スクリプト: node scripts/smoke.mjs http://127.0.0.1:8787
const base = process.argv[2] ?? "http://127.0.0.1:8787";
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "OK " : "NG "} ${msg}`); if (!cond) fails++; };
async function call(method, path, { token, member, body, raw, type } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (member) headers["x-member"] = member;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type;
  const res = await fetch(base + "/api" + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
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
const p = await call("POST", `/g/${gid}/photos?sessionId=${sid}&gameId=${g1.data.id}&w=1&h=1`, { token: T, member: M, raw: jpg, type: "image/jpeg" });
ok(p.status === 200, "写真アップロード");
const pf = await fetch(`${base}/api/g/${gid}/photos/${p.data.id}/file?t=${encodeURIComponent(T)}`);
ok(pf.status === 200 && (await pf.arrayBuffer()).byteLength === jpg.length, "写真の取得");
ok((await fetch(`${base}/api/g/${gid}/photos/${p.data.id}/file`)).status === 401, "写真はトークンなしで見られない");

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
const yp = await call("POST", `/g/${gid}/photos?sessionId=${sid}&yakumanId=${yk.data.id}&w=1&h=1`, { token: T, member: M, raw: jpg, type: "image/jpeg" });
ok(yp.status === 200 && yp.data.gameId === yk.data.id, "役満の記念写真");
const st3 = (await call("GET", `/g/${gid}/state`, { token: T })).data;
ok(st3.chipEvents.length === 4 && st3.chipEvents.filter((e) => e.deletedAt).length === 1, "stateにチップ記録");
ok(st3.yakuman.length === 1 && st3.yakuman[0].name === "国士無双", "stateに役満");

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
const bgf = await fetch(`${base}/api/g/${open.data.groupId}/background?t=${encodeURIComponent(OT)}`);
ok(bgf.status === 200, "背景写真の取得");
ok((await call("DELETE", `/g/${open.data.groupId}/background`, { token: OT })).status === 200, "背景を消す");
console.log(fails ? `\n${fails}件失敗` : "\nすべて成功");
console.log("GID", gid, "TOKEN", T, "MEMBER", M, "SID", sid);
process.exit(fails ? 1 : 0);
