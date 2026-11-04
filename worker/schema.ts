// テーブルは初回アクセス時に自動で作る（CREATE TABLE IF NOT EXISTS）。
// 列を足すときは BASE_SCHEMA に ALTER を書かず、MIGRATIONS の末尾に追記する（BASE_SCHEMA は毎回全部流れるため）。

export const BASE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, join_salt TEXT NOT NULL, join_hash TEXT NOT NULL,
    created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS members_group ON members(group_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, title TEXT NOT NULL, played_on TEXT NOT NULL,
    rate INTEGER NOT NULL, chip_yen INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS sessions_group ON sessions(group_id)`,
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
    rate INTEGER NOT NULL, scores TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS games_group ON games(group_id)`,
  `CREATE TABLE IF NOT EXISTS chips (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, lines TEXT NOT NULL,
    memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS chips_group ON chips(group_id)`,
  `CREATE TABLE IF NOT EXISTS adjustments (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
    lines TEXT NOT NULL, memo TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS adjustments_group ON adjustments(group_id)`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
    yen INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS settlements_group ON settlements(group_id)`,
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, game_id TEXT,
    width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS photos_group ON photos(group_id)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, entity TEXT NOT NULL,
    entity_id TEXT NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT,
    actor_member_id TEXT, actor_name TEXT NOT NULL, actor_device TEXT NOT NULL,
    created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS audit_group ON audit_logs(group_id, id)`,
  // 履歴は書き換え・削除できない（アプリにその処理がないことに加え、DBでも拒否する）
  `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END`,
  `CREATE TABLE IF NOT EXISTS chip_events (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
    kind TEXT NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS chip_events_group ON chip_events(group_id)`,
  `CREATE TABLE IF NOT EXISTS yakuman (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, game_id TEXT, member_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS yakuman_group ON yakuman(group_id)`,
  `CREATE TABLE IF NOT EXISTS join_attempts (
    group_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL)`,
  // 雀霊カプセル（G-01〜G-09）。1行＝1回分の結果。消さない（追記のみ）
  `CREATE TABLE IF NOT EXISTS gacha_pulls (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, member_id TEXT NOT NULL, coin TEXT NOT NULL,
    result TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS gacha_pulls_member ON gacha_pulls(group_id, member_id)`,
  `CREATE TABLE IF NOT EXISTS gacha_profiles (
    group_id TEXT NOT NULL, member_id TEXT NOT NULL, partner_spirit_id TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (group_id, member_id))`,
];

/** 既存DBへの変更。version は増やす一方で、適用済みは meta の schema_version で飛ばす */
export const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: `ALTER TABLE photos ADD COLUMN yakuman_id TEXT` },
  { version: 2, sql: `ALTER TABLE photos ADD COLUMN storage TEXT NOT NULL DEFAULT 'kv'` },
  // これまで役満の写真は game_id 列に役満IDを入れていた。旧列はそのまま残す
  { version: 3, sql: `UPDATE photos SET yakuman_id=game_id WHERE yakuman_id IS NULL AND game_id IN (SELECT id FROM yakuman)` },
  { version: 4, sql: `CREATE INDEX IF NOT EXISTS photos_yakuman ON photos(yakuman_id)` },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS chombo (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, session_id TEXT NOT NULL, member_id TEXT NOT NULL,
    memo TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, deleted_at TEXT)`,
  },
  { version: 6, sql: `CREATE INDEX IF NOT EXISTS chombo_group ON chombo(group_id)` },
];

/** テーブル作成と移行をまとめて行う。同時に走っても、列の重複だけは適用済みとして扱う */
export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch(BASE_SCHEMA.map((q) => db.prepare(q)));
  const row = await db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).first<{ value: string }>();
  const current = Number(row?.value ?? 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    try {
      await db.prepare(m.sql).run();
    } catch (e) {
      if (!/duplicate column name/i.test(String(e))) throw e;
    }
    await db
      .prepare(`INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(String(m.version))
      .run();
  }
}
