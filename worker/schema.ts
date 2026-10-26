// テーブルは初回アクセス時に自動で作る（CREATE TABLE IF NOT EXISTS）。
// 列を足すときは MIGRATIONS の末尾に追記し、SCHEMA_VERSION を上げる。

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
