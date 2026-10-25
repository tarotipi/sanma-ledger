import { Hono, type Context } from "hono";
import { BASE_SCHEMA } from "./schema";
import { RULES, sumIsZero, validateGame } from "../src/shared/mahjong";
import type { Score } from "../src/shared/types";

type Env = {
  DB: D1Database;
  PHOTOS: KVNamespace;
  ASSETS: Fetcher;
  /** オンライン卓（Durable Object。1グループ＝1卓） */
  TABLE: DurableObjectNamespace;
};

// オンライン卓の Durable Object クラス（wrangler.jsonc の durable_objects で参照）
export { MahjongTable } from "./table";

type Actor = { groupId: string; device: string; memberId: string | null; name: string };
type Vars = { actor: Actor };
type C = Context<{ Bindings: Env; Variables: Vars }>;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const COLORS = ["#2F7D5B", "#C0392B", "#2E5E9E", "#B7791F", "#7A4FA0", "#1F8A8A", "#A0466B", "#5C6B2E"];

// ---------- 初期化 ----------

let ready: Promise<string> | null = null;
function init(env: Env): Promise<string> {
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(BASE_SCHEMA.map((q) => env.DB.prepare(q)));
      const secret = toB64(crypto.getRandomValues(new Uint8Array(32)));
      await env.DB.prepare(`INSERT OR IGNORE INTO meta(key, value) VALUES ('secret', ?)`).bind(secret).run();
      const row = await env.DB.prepare(`SELECT value FROM meta WHERE key='secret'`).first<{ value: string }>();
      return row!.value;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// ---------- 暗号まわり ----------

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

async function hashCode(code: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 10000 },
    key,
    256,
  );
  return toB64(bits);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function issueToken(secret: string, groupId: string): Promise<string> {
  const device = uid();
  return `${groupId}.${device}.${await hmac(secret, `${groupId}.${device}`)}`;
}

// ---------- 共通 ----------

class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
  ) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "サーバーでエラーが起きました。少し待ってからやり直してください。" }, 500);
});

app.use("/api/*", async (c, next) => {
  await init(c.env);
  await next();
});

function audit(
  c: C,
  entity: string,
  entityId: string,
  action: "insert" | "update" | "delete" | "restore" | "admin_update" | "admin_delete" | "admin_restore",
  before: unknown,
  after: unknown,
  actor?: Actor,
): D1PreparedStatement {
  const a = actor ?? c.get("actor");
  return c.env.DB.prepare(
    `INSERT INTO audit_logs(group_id, entity, entity_id, action, before, after, actor_member_id, actor_name, actor_device, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    a.groupId,
    entity,
    entityId,
    action,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    a.memberId,
    a.name,
    a.device,
    now(),
  );
}

async function body<T>(c: C): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, "送信内容を読み取れませんでした。");
  }
}

function str(v: unknown, field: string, max = 60, allowEmpty = false): string {
  if (typeof v !== "string") throw new HttpError(400, `${field}を入力してください。`);
  const s = v.trim();
  if (!allowEmpty && !s) throw new HttpError(400, `${field}を入力してください。`);
  if (s.length > max) throw new HttpError(400, `${field}は${max}文字以内にしてください。`);
  return s;
}

function int(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${field}は整数で入力してください。`);
  return v;
}

function checkRate(v: unknown): number {
  const r = int(v, "レート");
  if (r <= 0 || r % RULES.RATE_STEP !== 0 || r > 100000)
    throw new HttpError(400, `レートは${RULES.RATE_STEP}円刻みで入力してください。`);
  return r;
}

function checkChip(v: unknown): number {
  const r = int(v, "チップ単価");
  if (r < RULES.CHIP_MIN || r % RULES.CHIP_STEP !== 0 || r > 100000)
    throw new HttpError(400, `チップ単価は${RULES.CHIP_MIN}円以上、${RULES.CHIP_STEP}円刻みで入力してください。`);
  return r;
}

// ---------- 行 → JSON ----------

type Row = Record<string, unknown>;
const j = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const mapMember = (r: Row) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  sort: r.sort,
  hidden: r.hidden === 1,
});
const mapSession = (r: Row) => ({
  id: r.id,
  title: r.title,
  playedOn: r.played_on,
  rate: r.rate,
  chipYen: r.chip_yen,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const mapGame = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  seq: r.seq,
  rate: r.rate,
  scores: j<Score[]>(r.scores),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});
const mapChip = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  lines: j(r.lines),
  memo: r.memo,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const mapAdj = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  kind: r.kind,
  lines: j(r.lines),
  memo: r.memo,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const mapSettle = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  memberId: r.member_id,
  yen: r.yen,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const mapPhoto = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  gameId: r.game_id,
  width: r.width,
  height: r.height,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});

const mapChipEvent = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  memberId: r.member_id,
  kind: r.kind,
  amount: r.amount,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});
const mapYakuman = (r: Row) => ({
  id: r.id,
  sessionId: r.session_id,
  gameId: r.game_id,
  memberId: r.member_id,
  name: r.name,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});

const TABLES = {
  chip_events: mapChipEvent,
  yakuman: mapYakuman,
  sessions: mapSession,
  games: mapGame,
  chips: mapChip,
  adjustments: mapAdj,
  settlements: mapSettle,
  photos: mapPhoto,
} as const;
type SoftTable = keyof typeof TABLES;

async function getRow(c: C, table: string, id: string): Promise<Row> {
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=? AND group_id=?`)
    .bind(id, c.get("actor").groupId)
    .first<Row>();
  if (!row) throw new HttpError(404, "対象が見つかりません。ほかの人が先に操作した可能性があります。");
  return row;
}

async function requireSession(c: C, sessionId: unknown): Promise<Row> {
  if (typeof sessionId !== "string") throw new HttpError(400, "セッションが指定されていません。");
  const s = await getRow(c, "sessions", sessionId);
  if (s.deleted_at) throw new HttpError(400, "このセッションは削除されています。");
  return s;
}

async function memberIds(c: C): Promise<Set<string>> {
  const r = await c.env.DB.prepare(`SELECT id FROM members WHERE group_id=?`).bind(c.get("actor").groupId).all<Row>();
  return new Set(r.results.map((x) => String(x.id)));
}

// ---------- グループ作成・入室（認証不要） ----------

app.post("/api/groups", async (c) => {
  const secret = await init(c.env);
  const b = await body<{ name: unknown; code: unknown; members: unknown }>(c);
  // グループ名と合言葉は省略可（あとで設定画面から変えられる）
  const name = typeof b.name === "string" && b.name.trim() ? str(b.name, "グループ名", 40) : "対戦記録";
  const code = typeof b.code === "string" ? b.code.trim() : "";
  if (code && code.length < 4) throw new HttpError(400, "合言葉は4文字以上にしてください。");
  const names = Array.isArray(b.members)
    ? [...new Set(b.members.map((m) => str(m, "メンバー名", 20)).filter(Boolean))]
    : [];
  if (names.length < 1) throw new HttpError(400, "名前を1人以上入力してください。");
  if (names.length > 30) throw new HttpError(400, "メンバーは30人までです。");
  const id = uid();
  const salt = uid();
  const t = now();
  const actor: Actor = { groupId: id, device: "-", memberId: null, name: "(作成者)" };
  const token = await issueToken(secret, id);
  actor.device = token.split(".")[1];
  const fake = { get: () => actor, env: c.env } as unknown as C;
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO groups(id,name,join_salt,join_hash,created_at) VALUES (?,?,?,?,?)`).bind(
      id,
      name,
      salt,
      code ? await hashCode(code, salt) : "",
      t,
    ),
    audit(fake, "group", id, "insert", null, { name }, actor),
  ];
  names.forEach((n, i) => {
    const m = { id: uid(), name: n, color: COLORS[i % COLORS.length], sort: i, hidden: false };
    stmts.push(
      c.env.DB.prepare(`INSERT INTO members(id,group_id,name,color,sort,hidden,created_at) VALUES (?,?,?,?,?,0,?)`).bind(
        m.id,
        id,
        m.name,
        m.color,
        m.sort,
        t,
      ),
      audit(fake, "members", m.id, "insert", null, m, actor),
    );
  });
  await c.env.DB.batch(stmts);
  return c.json({ groupId: id, name, token });
});

app.get("/api/groups/:gid/public", async (c) => {
  const g = await c.env.DB.prepare(`SELECT name, join_hash FROM groups WHERE id=?`).bind(c.req.param("gid")).first<Row>();
  if (!g) throw new HttpError(404, "グループが見つかりません。URLを確認してください。");
  return c.json({ name: g.name, needsCode: !!g.join_hash });
});

app.post("/api/groups/:gid/join", async (c) => {
  const secret = await init(c.env);
  const gid = c.req.param("gid");
  const g = await c.env.DB.prepare(`SELECT * FROM groups WHERE id=?`).bind(gid).first<Row>();
  if (!g) throw new HttpError(404, "グループが見つかりません。URLを確認してください。");
  const att = await c.env.DB.prepare(`SELECT * FROM join_attempts WHERE group_id=?`).bind(gid).first<Row>();
  const nowSec = Math.floor(Date.now() / 1000);
  const inWindow = att && nowSec - Number(att.window_start) < 600;
  if (inWindow && Number(att.failures) >= 10)
    throw new HttpError(429, "合言葉を10回間違えたため、10分間入室できません。");
  if (!g.join_hash) return c.json({ token: await issueToken(secret, gid), name: g.name });
  const b = await body<{ code: unknown }>(c);
  const code = typeof b.code === "string" ? b.code.trim() : "";
  const ok = safeEqual(await hashCode(code, String(g.join_salt)), String(g.join_hash));
  if (!ok) {
    await c.env.DB.prepare(
      `INSERT INTO join_attempts(group_id, window_start, failures) VALUES (?,?,1)
       ON CONFLICT(group_id) DO UPDATE SET
         failures = CASE WHEN ? - window_start < 600 THEN failures + 1 ELSE 1 END,
         window_start = CASE WHEN ? - window_start < 600 THEN window_start ELSE ? END`,
    )
      .bind(gid, nowSec, nowSec, nowSec, nowSec)
      .run();
    throw new HttpError(401, "合言葉が違います。");
  }
  return c.json({ token: await issueToken(secret, gid), name: g.name });
});

// ---------- ここから認証が必要 ----------

const requireAuth = async (c: C, next: () => Promise<void>) => {
  const secret = await init(c.env);
  const gid = c.req.param("gid");
  const auth = c.req.header("authorization")?.replace(/^Bearer /, "") ?? c.req.query("t") ?? "";
  const [tg, device, sig] = auth.split(".");
  if (!tg || tg !== gid || !device || !sig || !safeEqual(sig, await hmac(secret, `${tg}.${device}`)))
    throw new HttpError(401, "入室し直してください。");
  let memberId: string | null = c.req.header("x-member") ?? null;
  let name = "(名前未選択)";
  if (memberId) {
    const m = await c.env.DB.prepare(`SELECT name FROM members WHERE id=? AND group_id=?`).bind(memberId, gid).first<Row>();
    if (m) name = String(m.name);
    else memberId = null;
  }
  c.set("actor", { groupId: gid, device, memberId, name });
  await next();
};
app.use("/api/g/:gid", requireAuth);
app.use("/api/g/:gid/*", requireAuth);

async function version(c: C): Promise<number> {
  const r = await c.env.DB.prepare(`SELECT COALESCE(MAX(id),0) AS v FROM audit_logs WHERE group_id=?`)
    .bind(c.get("actor").groupId)
    .first<{ v: number }>();
  return r?.v ?? 0;
}

app.get("/api/g/:gid/version", async (c) => c.json({ version: await version(c) }));

app.get("/api/g/:gid/state", async (c) => {
  const gid = c.get("actor").groupId;
  const q = (sql: string) => c.env.DB.prepare(sql).bind(gid);
  const [g, members, sessions, games, chips, adj, settle, photos, v, chipEv, yaku] = await c.env.DB.batch<Row>([
    c.env.DB.prepare(
      `SELECT g.id, g.name, g.join_hash != '' AS has_code, (SELECT value FROM meta WHERE key = 'bg:' || g.id) AS bg
       FROM groups g WHERE g.id=?`,
    ).bind(gid),
    q(`SELECT * FROM members WHERE group_id=? ORDER BY sort, created_at`),
    q(`SELECT * FROM sessions WHERE group_id=? ORDER BY played_on DESC, created_at DESC`),
    q(`SELECT * FROM games WHERE group_id=? ORDER BY session_id, seq`),
    q(`SELECT * FROM chips WHERE group_id=? ORDER BY created_at`),
    q(`SELECT * FROM adjustments WHERE group_id=? ORDER BY created_at`),
    q(`SELECT * FROM settlements WHERE group_id=? ORDER BY created_at`),
    q(`SELECT * FROM photos WHERE group_id=? ORDER BY created_at`),
    q(`SELECT COALESCE(MAX(id),0) AS v FROM audit_logs WHERE group_id=?`),
    q(`SELECT * FROM chip_events WHERE group_id=? ORDER BY created_at`),
    q(`SELECT * FROM yakuman WHERE group_id=? ORDER BY created_at`),
  ]);
  const gr = g.results[0];
  if (!gr) throw new HttpError(404, "グループが見つかりません。");
  return c.json({
    group: { id: gr.id, name: gr.name, hasCode: gr.has_code === 1, bg: gr.bg ? String(gr.bg) : null },
    members: members.results.map(mapMember),
    sessions: sessions.results.map(mapSession),
    games: games.results.map(mapGame),
    chips: chips.results.map(mapChip),
    adjustments: adj.results.map(mapAdj),
    settlements: settle.results.map(mapSettle),
    photos: photos.results.map(mapPhoto),
    chipEvents: chipEv.results.map(mapChipEvent),
    yakuman: yaku.results.map(mapYakuman),
    version: Number(v.results[0]?.v ?? 0),
  });
});

app.get("/api/g/:gid/logs", async (c) => {
  const gid = c.get("actor").groupId;
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const before = Number(c.req.query("before") ?? 0) || Number.MAX_SAFE_INTEGER;
  const entity = c.req.query("entity");
  const entityId = c.req.query("entityId");
  // プレイヤー向けの履歴。半荘の訂正・削除（記録係・通常どちらも）はここには出さない。
  // 半荘は「追加(insert)」だけ見せる。訂正・削除は管理者が /admin/logs で見る。
  let sql = `SELECT * FROM audit_logs WHERE group_id=? AND id<?
    AND NOT (entity='games' AND action IN ('update','delete','restore','admin_update','admin_delete','admin_restore'))`;
  const params: unknown[] = [gid, before];
  if (entity) {
    sql += ` AND entity=?`;
    params.push(entity);
  }
  if (entityId) {
    sql += ` AND entity_id=?`;
    params.push(entityId);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  const r = await c.env.DB.prepare(sql).bind(...params).all<Row>();
  return c.json({
    logs: r.results.map((x) => ({
      id: x.id,
      entity: x.entity,
      entityId: x.entity_id,
      action: x.action,
      before: x.before ? JSON.parse(String(x.before)) : null,
      after: x.after ? JSON.parse(String(x.after)) : null,
      actorName: x.actor_name,
      actorDevice: String(x.actor_device).slice(0, 6),
      createdAt: x.created_at,
    })),
  });
});

// ---------- グループ設定 ----------

app.patch("/api/g/:gid", async (c) => {
  const gid = c.get("actor").groupId;
  const b = await body<{ name?: unknown; code?: unknown }>(c);
  const g = await getRowGroup(c, gid);
  const stmts: D1PreparedStatement[] = [];
  if (b.name !== undefined) {
    const name = str(b.name, "グループ名", 40);
    stmts.push(
      c.env.DB.prepare(`UPDATE groups SET name=? WHERE id=?`).bind(name, gid),
      audit(c, "group", gid, "update", { name: g.name }, { name }),
    );
  }
  if (b.code !== undefined) {
    const code = str(b.code, "合言葉", 64, true);
    if (code && code.length < 4) throw new HttpError(400, "合言葉は4文字以上にしてください。");
    const salt = uid();
    stmts.push(
      c.env.DB.prepare(`UPDATE groups SET join_salt=?, join_hash=? WHERE id=?`).bind(
        salt,
        code ? await hashCode(code, salt) : "",
        gid,
      ),
      audit(c, "group", gid, "update", { code: "(変更前)" }, { code: code ? "(合言葉を変更)" : "(合言葉をなしに)" }),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// 背景写真（グループごとに1枚。画像はKV、版番号は meta テーブル）
app.put("/api/g/:gid/background", async (c) => {
  const gid = c.get("actor").groupId;
  const type = c.req.header("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(400, "画像ファイルを選んでください。");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) throw new HttpError(400, "画像が空です。");
  if (buf.byteLength > 4 * 1024 * 1024) throw new HttpError(413, "画像が大きすぎます（4MBまで）。");
  const v = uid().slice(0, 8);
  await c.env.PHOTOS.put(`${gid}/background`, buf, { metadata: { type } });
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(
      `bg:${gid}`,
      v,
    ),
    audit(c, "group", gid, "update", { background: "(変更前)" }, { background: "(背景写真を変更)" }),
  ]);
  return c.json({ bg: v });
});

app.delete("/api/g/:gid/background", async (c) => {
  const gid = c.get("actor").groupId;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO meta(key, value) VALUES (?, '') ON CONFLICT(key) DO UPDATE SET value=''`).bind(`bg:${gid}`),
    audit(c, "group", gid, "update", { background: "(変更前)" }, { background: "(背景写真を消した)" }),
  ]);
  return c.json({ bg: null });
});

app.get("/api/g/:gid/background", async (c) => {
  const obj = await c.env.PHOTOS.getWithMetadata<{ type: string }>(`${c.get("actor").groupId}/background`, "arrayBuffer");
  if (!obj.value) throw new HttpError(404, "背景写真はありません。");
  return new Response(obj.value, {
    headers: { "content-type": obj.metadata?.type ?? "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
  });
});

async function getRowGroup(c: C, gid: string): Promise<Row> {
  const g = await c.env.DB.prepare(`SELECT * FROM groups WHERE id=?`).bind(gid).first<Row>();
  if (!g) throw new HttpError(404, "グループが見つかりません。");
  return g;
}

// ---------- メンバー ----------

app.post("/api/g/:gid/members", async (c) => {
  const gid = c.get("actor").groupId;
  const b = await body<{ name: unknown; color?: unknown }>(c);
  const name = str(b.name, "名前", 20);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE group_id=?`).bind(gid).first<{ n: number }>();
  const n = count?.n ?? 0;
  const dup = await c.env.DB.prepare(`SELECT id FROM members WHERE group_id=? AND name=?`).bind(gid, name).first();
  if (dup) throw new HttpError(409, "同じ名前のメンバーがすでにいます。");
  const color = typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : COLORS[n % COLORS.length];
  const m = { id: uid(), name, color, sort: n, hidden: false };
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO members(id,group_id,name,color,sort,hidden,created_at) VALUES (?,?,?,?,?,0,?)`).bind(
      m.id,
      gid,
      name,
      color,
      n,
      now(),
    ),
    audit(c, "members", m.id, "insert", null, m),
  ]);
  return c.json(m);
});

app.patch("/api/g/:gid/members/:id", async (c) => {
  const row = await getRow(c, "members", c.req.param("id"));
  const before = mapMember(row);
  const b = await body<{ name?: unknown; color?: unknown; hidden?: unknown }>(c);
  const after = { ...before };
  if (b.name !== undefined) after.name = str(b.name, "名前", 20);
  if (typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color)) after.color = b.color;
  if (typeof b.hidden === "boolean") after.hidden = b.hidden;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE members SET name=?, color=?, hidden=? WHERE id=?`).bind(
      after.name,
      after.color,
      after.hidden ? 1 : 0,
      row.id,
    ),
    audit(c, "members", String(row.id), "update", before, after),
  ]);
  return c.json(after);
});

// ---------- セッション ----------

app.post("/api/g/:gid/sessions", async (c) => {
  const gid = c.get("actor").groupId;
  const b = await body<{ title?: unknown; playedOn: unknown; rate: unknown; chipYen: unknown }>(c);
  const playedOn = str(b.playedOn, "日付", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn)) throw new HttpError(400, "日付の形式が正しくありません。");
  const title = typeof b.title === "string" && b.title.trim() ? str(b.title, "タイトル", 40) : playedOn;
  const s = {
    id: uid(),
    title,
    playedOn,
    rate: checkRate(b.rate),
    chipYen: checkChip(b.chipYen),
    createdAt: now(),
    deletedAt: null,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sessions(id,group_id,title,played_on,rate,chip_yen,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(s.id, gid, s.title, s.playedOn, s.rate, s.chipYen, s.createdAt),
    audit(c, "sessions", s.id, "insert", null, s),
  ]);
  return c.json(s);
});

app.patch("/api/g/:gid/sessions/:id", async (c) => {
  const row = await getRow(c, "sessions", c.req.param("id"));
  const before = mapSession(row);
  const b = await body<{ title?: unknown; playedOn?: unknown; rate?: unknown; rateScope?: unknown; chipYen?: unknown }>(c);
  const after = { ...before } as ReturnType<typeof mapSession> & { rateScope?: string };
  if (b.title !== undefined) after.title = str(b.title, "タイトル", 40);
  if (b.playedOn !== undefined) {
    const d = str(b.playedOn, "日付", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, "日付の形式が正しくありません。");
    after.playedOn = d;
  }
  if (b.rate !== undefined) after.rate = checkRate(b.rate);
  if (b.chipYen !== undefined) after.chipYen = checkChip(b.chipYen);
  const stmts = [
    c.env.DB.prepare(`UPDATE sessions SET title=?, played_on=?, rate=?, chip_yen=? WHERE id=?`).bind(
      after.title,
      after.playedOn,
      after.rate,
      after.chipYen,
      row.id,
    ),
  ];
  if (b.rate !== undefined && b.rateScope === "all" && after.rate !== before.rate) {
    after.rateScope = "all";
    stmts.push(
      c.env.DB.prepare(`UPDATE games SET rate=?, updated_at=? WHERE session_id=? AND group_id=?`).bind(
        after.rate,
        now(),
        row.id,
        c.get("actor").groupId,
      ),
    );
  }
  stmts.push(audit(c, "sessions", String(row.id), "update", before, after));
  await c.env.DB.batch(stmts);
  return c.json(after);
});

// ---------- 半荘 ----------

async function checkScores(c: C, raw: unknown): Promise<Score[]> {
  if (!Array.isArray(raw)) throw new HttpError(400, "素点が送られていません。");
  const scores: Score[] = raw.map((x: Row) => {
    const s: Score = { memberId: String(x.memberId), score: Number(x.score) };
    if (x.tie !== undefined && x.tie !== null) s.tie = Number(x.tie);
    return s;
  });
  const v = validateGame(scores);
  if (!v.ok) {
    const msg = {
      not_three: "3人分の素点を入れてください。",
      duplicate: "同じ人が2回入っています。",
      invalid: "素点は百点単位の整数で入れてください。",
      total: `3人の合計が105,000点になっていません（${(v.diff ?? 0) * 100}点ずれています）。`,
      tie_unresolved: "同点の人の順位を選んでください。",
    }[v.reason];
    throw new HttpError(400, msg);
  }
  const ids = await memberIds(c);
  if (scores.some((s) => !ids.has(s.memberId))) throw new HttpError(400, "メンバーが見つかりません。");
  // 同点でない人の tie は保存しない
  const counts = new Map<number, number>();
  scores.forEach((s) => counts.set(s.score, (counts.get(s.score) ?? 0) + 1));
  return scores.map((s) => ((counts.get(s.score) ?? 0) > 1 ? s : { memberId: s.memberId, score: s.score }));
}

app.post("/api/g/:gid/games", async (c) => {
  const gid = c.get("actor").groupId;
  const b = await body<{ sessionId: unknown; scores: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const scores = await checkScores(c, b.scores);
  const id = uid();
  const t = now();
  const seqRow = await c.env.DB.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS n FROM games WHERE session_id=?`)
    .bind(s.id)
    .first<{ n: number }>();
  const g = {
    id,
    sessionId: String(s.id),
    seq: seqRow?.n ?? 1,
    rate: Number(s.rate),
    scores,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO games(id,group_id,session_id,seq,rate,scores,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(id, gid, g.sessionId, g.seq, g.rate, JSON.stringify(scores), t, t),
    audit(c, "games", id, "insert", null, g),
  ]);
  return c.json(g);
});

app.patch("/api/g/:gid/games/:id", async (c) => {
  const row = await getRow(c, "games", c.req.param("id"));
  if (row.deleted_at) throw new HttpError(400, "削除された半荘は編集できません。先に復元してください。");
  const before = mapGame(row);
  const b = await body<{ scores: unknown }>(c);
  const scores = await checkScores(c, b.scores);
  const after = { ...before, scores, updatedAt: now() };
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE games SET scores=?, updated_at=? WHERE id=?`).bind(JSON.stringify(scores), after.updatedAt, row.id),
    audit(c, "games", String(row.id), "update", before, after),
  ]);
  return c.json(after);
});

// ---------- 記録係による訂正 ----------
// 対局に参加しない記録係が、言い間違い・打ち間違いを直すための経路。パスワードで保護する。
// 訂正の中身は audit_logs に必ず記録する（記録は消さない）。action を admin_* にして、
// 閲覧は管理者（パスワード保持者）だけに絞る。プレイヤーには見せない。
const ADMIN_PW = "taro0813";

app.post("/api/g/:gid/admin/games/:id", async (c) => {
  const b = await body<{ password: unknown; scores?: unknown; action?: unknown }>(c);
  if (b.password !== ADMIN_PW) throw new HttpError(403, "管理者パスワードが違います。");
  const row = await getRow(c, "games", c.req.param("id"));
  const before = mapGame(row);
  if (b.action === "delete") {
    const t = now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE games SET deleted_at=? WHERE id=?`).bind(t, row.id),
      audit(c, "games", String(row.id), "admin_delete", before, { ...before, deletedAt: t }),
    ]);
    return c.json({ ok: true });
  }
  if (b.action === "restore") {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE games SET deleted_at=NULL WHERE id=?`).bind(row.id),
      audit(c, "games", String(row.id), "admin_restore", before, { ...before, deletedAt: null }),
    ]);
    return c.json({ ok: true });
  }
  const scores = await checkScores(c, b.scores);
  // updated_at は created_at のまま＝半荘一覧に「変更あり」を出さない。訂正の中身は下の audit に全部残す。
  const after = { ...before, scores };
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE games SET scores=? WHERE id=?`).bind(JSON.stringify(scores), row.id),
    audit(c, "games", String(row.id), "admin_update", before, after),
  ]);
  return c.json(after);
});

// 管理者だけが見られる記録係の編集履歴。パスワードが合えば admin_* の記録を返す。
app.post("/api/g/:gid/admin/logs", async (c) => {
  const b = await body<{ password: unknown; before?: unknown; limit?: unknown }>(c);
  if (b.password !== ADMIN_PW) throw new HttpError(403, "管理者パスワードが違います。");
  const gid = c.get("actor").groupId;
  const limit = Math.min(Number(b.limit ?? 50) || 50, 200);
  const before = Number(b.before ?? 0) || Number.MAX_SAFE_INTEGER;
  // 管理者はすべての半荘の訂正・削除を見られる（記録係の訂正 admin_* も、古い通常の変更・削除も）
  const r = await c.env.DB.prepare(
    `SELECT * FROM audit_logs WHERE group_id=? AND id<?
     AND entity='games' AND action IN ('update','delete','restore','admin_update','admin_delete','admin_restore')
     ORDER BY id DESC LIMIT ?`,
  )
    .bind(gid, before, limit)
    .all<Row>();
  return c.json({
    logs: r.results.map((x) => ({
      id: x.id,
      entity: x.entity,
      entityId: x.entity_id,
      action: x.action,
      before: x.before ? JSON.parse(String(x.before)) : null,
      after: x.after ? JSON.parse(String(x.after)) : null,
      actorName: x.actor_name,
      actorDevice: String(x.actor_device).slice(0, 6),
      createdAt: x.created_at,
    })),
  });
});

// ---------- チップ・調整・精算 ----------

function chipLines(raw: unknown, ids: Set<string>) {
  if (!Array.isArray(raw)) throw new HttpError(400, "チップの枚数が送られていません。");
  const lines = raw
    .map((x: Row) => ({ memberId: String(x.memberId), count: Number(x.count) }))
    .filter((l) => l.count !== 0);
  if (lines.some((l) => !Number.isInteger(l.count) || !ids.has(l.memberId) || Math.abs(l.count) > 10000))
    throw new HttpError(400, "チップの枚数は整数で入力してください。");
  if (lines.length < 2) throw new HttpError(400, "2人以上の増減を入れてください。");
  if (!sumIsZero(lines.map((l) => l.count))) throw new HttpError(400, "チップの増減の合計が0になっていません。");
  return lines;
}

function adjLines(raw: unknown, ids: Set<string>, kind: string) {
  if (!Array.isArray(raw)) throw new HttpError(400, "金額が送られていません。");
  const lines = raw
    .map((x: Row) => ({ memberId: String(x.memberId), yen: Number(x.yen) }))
    .filter((l) => l.yen !== 0);
  if (lines.some((l) => !Number.isInteger(l.yen) || !ids.has(l.memberId) || Math.abs(l.yen) > 10000000))
    throw new HttpError(400, "金額は円の整数で入力してください。");
  if (!lines.length) throw new HttpError(400, "金額を入れてください。");
  if (kind === "internal" && !sumIsZero(lines.map((l) => l.yen)))
    throw new HttpError(400, "メンバー間の調整は、合計が0円になるように入れてください。");
  return lines;
}

app.post("/api/g/:gid/chips", async (c) => {
  const b = await body<{ sessionId: unknown; lines: unknown; memo?: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const lines = chipLines(b.lines, await memberIds(c));
  const memo = b.memo === undefined ? "" : str(b.memo, "メモ", 100, true);
  const e = { id: uid(), sessionId: String(s.id), lines, memo, createdAt: now(), deletedAt: null };
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO chips(id,group_id,session_id,lines,memo,created_at) VALUES (?,?,?,?,?,?)`).bind(
      e.id,
      c.get("actor").groupId,
      e.sessionId,
      JSON.stringify(lines),
      memo,
      e.createdAt,
    ),
    audit(c, "chips", e.id, "insert", null, e),
  ]);
  return c.json(e);
});

app.patch("/api/g/:gid/chips/:id", async (c) => {
  const row = await getRow(c, "chips", c.req.param("id"));
  const before = mapChip(row);
  const b = await body<{ lines?: unknown; memo?: unknown }>(c);
  const after = { ...before };
  if (b.lines !== undefined) after.lines = chipLines(b.lines, await memberIds(c));
  if (b.memo !== undefined) after.memo = str(b.memo, "メモ", 100, true);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE chips SET lines=?, memo=? WHERE id=?`).bind(JSON.stringify(after.lines), after.memo, row.id),
    audit(c, "chips", String(row.id), "update", before, after),
  ]);
  return c.json(after);
});

app.post("/api/g/:gid/adjustments", async (c) => {
  const b = await body<{ sessionId: unknown; kind: unknown; lines: unknown; memo: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const kind = b.kind === "internal" ? "internal" : "external";
  const lines = adjLines(b.lines, await memberIds(c), kind);
  const memo = str(b.memo, "メモ", 100);
  const e = { id: uid(), sessionId: String(s.id), kind, lines, memo, createdAt: now(), deletedAt: null };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO adjustments(id,group_id,session_id,kind,lines,memo,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(e.id, c.get("actor").groupId, e.sessionId, kind, JSON.stringify(lines), memo, e.createdAt),
    audit(c, "adjustments", e.id, "insert", null, e),
  ]);
  return c.json(e);
});

app.patch("/api/g/:gid/adjustments/:id", async (c) => {
  const row = await getRow(c, "adjustments", c.req.param("id"));
  const before = mapAdj(row);
  const b = await body<{ lines?: unknown; memo?: unknown; kind?: unknown }>(c);
  const after = { ...before };
  if (b.kind !== undefined) after.kind = b.kind === "internal" ? "internal" : "external";
  if (b.lines !== undefined) after.lines = adjLines(b.lines, await memberIds(c), String(after.kind));
  if (b.memo !== undefined) after.memo = str(b.memo, "メモ", 100);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE adjustments SET kind=?, lines=?, memo=? WHERE id=?`).bind(
      after.kind,
      JSON.stringify(after.lines),
      after.memo,
      row.id,
    ),
    audit(c, "adjustments", String(row.id), "update", before, after),
  ]);
  return c.json(after);
});

app.post("/api/g/:gid/settlements", async (c) => {
  const b = await body<{ sessionId: unknown; memberId: unknown; yen: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const ids = await memberIds(c);
  if (typeof b.memberId !== "string" || !ids.has(b.memberId)) throw new HttpError(400, "メンバーが見つかりません。");
  const e = {
    id: uid(),
    sessionId: String(s.id),
    memberId: b.memberId,
    yen: int(b.yen, "金額"),
    createdAt: now(),
    deletedAt: null,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE settlements SET deleted_at=? WHERE session_id=? AND member_id=? AND deleted_at IS NULL`,
    ).bind(e.createdAt, e.sessionId, e.memberId),
    c.env.DB.prepare(
      `INSERT INTO settlements(id,group_id,session_id,member_id,yen,created_at) VALUES (?,?,?,?,?,?)`,
    ).bind(e.id, c.get("actor").groupId, e.sessionId, e.memberId, e.yen, e.createdAt),
    audit(c, "settlements", e.id, "insert", null, e),
  ]);
  return c.json(e);
});

// ---------- チップ（バイイン・返却・枚数） ----------

app.post("/api/g/:gid/chip-events", async (c) => {
  const b = await body<{ sessionId: unknown; memberIds: unknown; kind: unknown; amount: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const kind = b.kind === "return" ? "return" : b.kind === "count" ? "count" : b.kind === "buy" ? "buy" : null;
  if (!kind) throw new HttpError(400, "種類が正しくありません。");
  const amount = int(b.amount, kind === "count" ? "枚数" : "金額");
  if (amount < 0 || amount > 10000000) throw new HttpError(400, kind === "count" ? "枚数は0以上で入れてください。" : "金額は0円以上で入れてください。");
  if (kind !== "count" && amount === 0) throw new HttpError(400, "金額を入れてください。");
  const ids = await memberIds(c);
  if (!Array.isArray(b.memberIds) || !b.memberIds.length || b.memberIds.some((m) => typeof m !== "string" || !ids.has(m)))
    throw new HttpError(400, "人を選んでください。");
  if (kind === "count" && b.memberIds.length !== 1) throw new HttpError(400, "枚数は1人ずつ入れてください。");
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  const out = (b.memberIds as string[]).map((memberId) => {
    const e = { id: uid(), sessionId: String(s.id), memberId, kind, amount, createdAt: t, deletedAt: null };
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO chip_events(id,group_id,session_id,member_id,kind,amount,created_at) VALUES (?,?,?,?,?,?,?)`,
      ).bind(e.id, c.get("actor").groupId, e.sessionId, memberId, kind, amount, t),
      audit(c, "chip_events", e.id, "insert", null, e),
    );
    return e;
  });
  await c.env.DB.batch(stmts);
  return c.json(out);
});

// ---------- 役満 ----------

app.post("/api/g/:gid/yakuman", async (c) => {
  const b = await body<{ sessionId: unknown; gameId?: unknown; memberId: unknown; name?: unknown }>(c);
  const s = await requireSession(c, b.sessionId);
  const ids = await memberIds(c);
  if (typeof b.memberId !== "string" || !ids.has(b.memberId)) throw new HttpError(400, "役満を出した人を選んでください。");
  const gameId = typeof b.gameId === "string" && b.gameId ? b.gameId : null;
  if (gameId) await getRow(c, "games", gameId);
  const y = {
    id: uid(),
    sessionId: String(s.id),
    gameId,
    memberId: b.memberId,
    name: b.name === undefined ? "" : str(b.name, "役の名前", 30, true),
    createdAt: now(),
    deletedAt: null,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO yakuman(id,group_id,session_id,game_id,member_id,name,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(y.id, c.get("actor").groupId, y.sessionId, gameId, y.memberId, y.name, y.createdAt),
    audit(c, "yakuman", y.id, "insert", null, y),
  ]);
  return c.json(y);
});

// ---------- 写真 ----------

app.post("/api/g/:gid/photos", async (c) => {
  const s = await requireSession(c, c.req.query("sessionId"));
  // 役満の記念写真は yakumanId を game_id 列に入れて紐づける
  const yakumanId = c.req.query("yakumanId") || null;
  const gameId = yakumanId ?? (c.req.query("gameId") || null);
  if (yakumanId) await getRow(c, "yakuman", yakumanId);
  else if (gameId) await getRow(c, "games", gameId);
  const type = c.req.header("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(400, "画像ファイルを選んでください。");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > 4 * 1024 * 1024) throw new HttpError(413, "画像が大きすぎます（4MBまで）。");
  if (buf.byteLength === 0) throw new HttpError(400, "画像が空です。");
  const width = Number(c.req.query("w") ?? 0) || 0;
  const height = Number(c.req.query("h") ?? 0) || 0;
  const p = {
    id: uid(),
    sessionId: String(s.id),
    gameId,
    width,
    height,
    createdAt: now(),
    deletedAt: null,
  };
  const gid = c.get("actor").groupId;
  await c.env.PHOTOS.put(`${gid}/${p.id}`, buf, { metadata: { type } });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO photos(id,group_id,session_id,game_id,width,height,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(p.id, gid, p.sessionId, gameId, width, height, p.createdAt),
    audit(c, "photos", p.id, "insert", null, p),
  ]);
  return c.json(p);
});

app.get("/api/g/:gid/photos/:id/file", async (c) => {
  const gid = c.get("actor").groupId;
  await getRow(c, "photos", c.req.param("id"));
  const obj = await c.env.PHOTOS.getWithMetadata<{ type: string }>(`${gid}/${c.req.param("id")}`, "arrayBuffer");
  if (!obj.value) throw new HttpError(404, "画像が見つかりません。");
  return new Response(obj.value, {
    headers: {
      "content-type": obj.metadata?.type ?? "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
});

// ---------- 削除・復元（論理削除） ----------

for (const action of ["delete", "restore"] as const) {
  app.post(`/api/g/:gid/:table/:id/${action}`, async (c) => {
    const table = c.req.param("table");
    if (!(table in TABLES)) throw new HttpError(404, "対象が見つかりません。");
    const map = TABLES[table as SoftTable];
    const row = await getRow(c, table, c.req.param("id"));
    const before = map(row);
    if (action === "delete" && row.deleted_at) throw new HttpError(409, "すでに削除されています。");
    if (action === "restore" && !row.deleted_at) throw new HttpError(409, "削除されていません。");
    const t = action === "delete" ? now() : null;
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE ${table} SET deleted_at=? WHERE id=?`).bind(t, row.id),
      audit(c, table, String(row.id), action, before, { ...before, deletedAt: t }),
    ]);
    return c.json({ ok: true });
  });
}

// ---------- オンライン卓（WebSocket） ----------
// 注意：この登録は下の「/api/* → 404」より前に置くこと（Hono は登録順に照合するため、後ろだと必ず404になる）
// ブラウザの WebSocket はヘッダーを付けられないので、トークンは ?t= で渡す（requireAuth が読む）。
// 接続先の Durable Object はグループIDで決まる（1グループ＝1卓）。

async function tableSocket(c: C): Promise<Response> {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(400, "WebSocket で接続してください。");
  }
  const gid = c.get("actor").groupId;
  const g = await c.env.DB.prepare(`SELECT id FROM groups WHERE id=?`).bind(gid).first<Row>();
  if (!g) throw new HttpError(404, "グループが見つかりません。URLを確認してください。");
  const stub = c.env.TABLE.get(c.env.TABLE.idFromName(gid));
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-group-id", gid);
  return stub.fetch(new Request(c.req.raw.url, { headers }));
}

app.get("/api/table/:gid/ws", requireAuth, tableSocket);
app.get("/api/g/:gid/table/ws", tableSocket); // requireAuth は /api/g/:gid/* で適用済み

app.all("/api/*", () => {
  throw new HttpError(404, "見つかりません。");
});

export default app;
