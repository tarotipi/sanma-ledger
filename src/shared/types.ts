// 素点は百点単位の整数（320 = 32,000点）。円は整数。ptは10倍した整数（pt10）で扱う。

export type Score = {
  memberId: string;
  score: number;
  /** 同点時の順位指定。小さいほど上。同点がなければ不要 */
  tie?: number;
};

export type Member = {
  id: string;
  name: string;
  color: string;
  sort: number;
  hidden: boolean;
};

export type Session = {
  id: string;
  title: string;
  playedOn: string;
  rate: number;
  chipYen: number;
  createdAt: string;
  deletedAt: string | null;
};

export type Game = {
  id: string;
  sessionId: string;
  seq: number;
  rate: number;
  scores: Score[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ChipLine = { memberId: string; count: number };
export type ChipEntry = {
  id: string;
  sessionId: string;
  lines: ChipLine[];
  memo: string;
  createdAt: string;
  deletedAt: string | null;
};

export type AdjustmentKind = "external" | "internal";
export type AdjustmentLine = { memberId: string; yen: number };
export type Adjustment = {
  id: string;
  sessionId: string;
  kind: AdjustmentKind;
  lines: AdjustmentLine[];
  memo: string;
  createdAt: string;
  deletedAt: string | null;
};

export type Settlement = {
  id: string;
  sessionId: string;
  memberId: string;
  yen: number;
  createdAt: string;
  deletedAt: string | null;
};

export type Photo = {
  id: string;
  sessionId: string;
  gameId: string | null;
  width: number;
  height: number;
  createdAt: string;
  deletedAt: string | null;
};

export type GroupState = {
  group: { id: string; name: string; hasCode: boolean; bg: string | null };
  members: Member[];
  sessions: Session[];
  games: Game[];
  chips: ChipEntry[];
  adjustments: Adjustment[];
  settlements: Settlement[];
  photos: Photo[];
  version: number;
};

export type LogEntity =
  | "group"
  | "members"
  | "sessions"
  | "games"
  | "chips"
  | "adjustments"
  | "settlements"
  | "photos";

export type LogAction = "insert" | "update" | "delete" | "restore";

export type AuditLog = {
  id: number;
  entity: LogEntity;
  entityId: string;
  action: LogAction;
  before: unknown;
  after: unknown;
  actorName: string;
  actorDevice: string;
  createdAt: string;
};
