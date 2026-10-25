// オンライン卓（Durable Object）。要件 Phase 3（I-03〜I-07, P-01, P-02, P-06, N-02, DBG-01）。
// 1グループ＝1卓。DO の名前はグループID（env.TABLE.idFromName(gid)）。
// 本当のゲーム状態はここだけが持ち、各接続には viewFor で「その人に見えてよい情報」だけを送る。
// WebSocket Hibernation API を使うので、待ち時間中はメモリから消えても storage から復元できる。
//
// 不具合を追うとき：ログは全て "[table <gid>]" で始まる。`wrangler tail` で見る。

import { DurableObject } from "cloudflare:workers";
import { BASE_SCHEMA } from "./schema";
import { RULES } from "../src/shared/mahjong";
import type { Score } from "../src/shared/types";
import type { FinalResult, GameAction, PlayerView, SeatIndex } from "../src/shared/game/protocol";
import {
  applyAction,
  createGame,
  handleTimeout,
  nextDeadline,
  setConnected,
  viewFor,
  type GameState,
} from "../src/shared/game/engine";

type TableEnv = {
  DB: D1Database;
};

// ---------- 保存する形 ----------

/** 席（3つ）。null は空席 */
interface Seat {
  memberId: string;
  name: string;
}

interface Lobby {
  seats: (Seat | null)[];
  started: boolean;
  /** この半荘の起家の席（同点時の順位づけ P-07 に使う） */
  startDealer: SeatIndex;
  seed: number;
  /** 何半荘目か（登録済みフラグとの照合用） */
  gameNo: number;
}

/** 接続ごとに覚えておく情報（Hibernation でも残る） */
interface Attachment {
  memberId: string | null;
  debug: boolean;
}

// ---------- メッセージ ----------

type ClientMsg =
  | { t: "join"; memberId: string; name?: string }
  | { t: "leave" }
  | { t: "start"; seed?: number }
  | { t: "action"; action: GameAction }
  | { t: "debug"; on: boolean }
  | { t: "reset" };

type ServerMsg =
  | { t: "lobby"; seats: ({ memberId: string; name: string; connected: boolean } | null)[]; started: boolean }
  | { t: "view"; view: PlayerView }
  | { t: "error"; message: string };

const EMPTY_LOBBY: Lobby = { seats: [null, null, null], started: false, startDealer: 0, seed: 0, gameNo: 0 };

export class MahjongTable extends DurableObject<TableEnv> {
  // メモリ上のキャッシュ（Hibernation で消えたら storage から読み直す）
  private gid: string | null = null;
  private lobby: Lobby | null = null;
  private game: GameState | null = null;
  private loaded = false;

  // ---------- 入口 ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket で接続してください", { status: 426 });
    }
    await this.load();
    const gid = request.headers.get("x-group-id");
    if (gid && gid !== this.gid) {
      this.gid = gid;
      await this.ctx.storage.put("gid", gid);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { memberId: null, debug: false };
    server.serializeAttachment(att);
    this.log("connect");
    // 接続直後に今のロビーを送る
    this.sendTo(server, this.lobbyMsg());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as ClientMsg;
    } catch {
      this.sendTo(ws, { t: "error", message: "メッセージを読めませんでした。" });
      return;
    }
    const att = this.att(ws);
    this.log(`recv ${att.memberId ?? "-"} ${JSON.stringify(msg)}`);
    try {
      await this.handle(ws, att, msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log(`error ${message}`);
      this.sendTo(ws, { t: "error", message });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.load();
    const att = this.att(ws);
    this.log(`close ${att.memberId ?? "-"} code=${code} ${reason}`);
    try {
      ws.close(code, reason);
    } catch {
      // すでに閉じている
    }
    await this.markDisconnected(att.memberId, ws);
  }

  async webSocketError(ws: WebSocket, err: unknown): Promise<void> {
    await this.load();
    const att = this.att(ws);
    this.log(`ws-error ${att.memberId ?? "-"} ${String(err)}`);
    await this.markDisconnected(att.memberId, ws);
  }

  /** 持ち時間切れ（P-06） */
  async alarm(): Promise<void> {
    await this.load();
    if (!this.game) return;
    this.log("alarm timeout");
    this.game = handleTimeout(this.game, Date.now());
    await this.saveAndBroadcast();
  }

  // ---------- 処理本体 ----------

  private async handle(ws: WebSocket, att: Attachment, msg: ClientMsg): Promise<void> {
    const lobby = this.lobby!;
    switch (msg.t) {
      case "join": {
        const memberId = String(msg.memberId ?? "");
        const member = await this.findMember(memberId);
        if (!member) throw new Error("メンバーが見つかりません。選び直してください。");
        const seatIdx = lobby.seats.findIndex((s) => s?.memberId === memberId);
        if (seatIdx >= 0) {
          // 再接続（P-02）
          att.memberId = memberId;
          ws.serializeAttachment(att);
          if (this.game) this.game = setConnected(this.game, memberId, true);
        } else {
          if (lobby.started) throw new Error("対局中のため入れません。終局までお待ちください。");
          const empty = lobby.seats.findIndex((s) => s === null);
          if (empty < 0) throw new Error("満席です。");
          lobby.seats[empty] = { memberId, name: member.name };
          att.memberId = memberId;
          ws.serializeAttachment(att);
        }
        break;
      }
      case "leave": {
        if (lobby.started) throw new Error("対局中は離席できません。");
        lobby.seats = lobby.seats.map((s) => (s && s.memberId === att.memberId ? null : s));
        att.memberId = null;
        ws.serializeAttachment(att);
        break;
      }
      case "start": {
        if (lobby.started) throw new Error("すでに始まっています。");
        if (lobby.seats.some((s) => s === null)) throw new Error("3人そろってから開始してください。");
        const seed = Number.isInteger(msg.seed) ? Number(msg.seed) : Math.floor(Math.random() * 2 ** 31);
        // 起家はシードから決める（P-01：ランダム）。同点時の順位に使うので覚えておく
        const startDealer = (Math.abs(seed) % 3) as SeatIndex;
        const players = lobby.seats.map((s) => ({ id: s!.memberId, name: s!.name }));
        this.game = createGame(players, { seed, dealerSeat: startDealer, now: Date.now() });
        lobby.started = true;
        lobby.seed = seed;
        lobby.startDealer = startDealer;
        lobby.gameNo += 1;
        // いまつながっていない人は切断扱いにしておく
        for (const s of lobby.seats) {
          if (s && !this.isOnline(s.memberId)) this.game = setConnected(this.game, s.memberId, false);
        }
        this.log(`start seed=${seed} dealer=${startDealer} gameNo=${lobby.gameNo}`);
        break;
      }
      case "action": {
        if (!this.game) throw new Error("対局が始まっていません。");
        if (!att.memberId) throw new Error("席に着いていません。");
        const r = applyAction(this.game, att.memberId, msg.action, Date.now());
        if (r.error) {
          // 不正な操作は本人にだけ返す（状態は変えない）
          this.sendTo(ws, { t: "error", message: r.error });
          return;
        }
        this.game = r.state;
        break;
      }
      case "debug": {
        att.debug = !!msg.on;
        ws.serializeAttachment(att);
        this.log(`debug ${att.memberId ?? "-"} ${att.debug}`);
        // この接続にだけ送り直す
        this.sendLobbyAndView(ws);
        return;
      }
      case "reset": {
        const ended = this.game ? this.view(this.game, lobby.seats[0]!.memberId).phase === "game_end" : true;
        if (lobby.started && !ended && !att.debug) {
          throw new Error("対局中はリセットできません（デバッグ表示中のみ可能）。");
        }
        this.game = null;
        this.lobby = { ...EMPTY_LOBBY, gameNo: lobby.gameNo };
        await this.ctx.storage.deleteAlarm();
        this.log("reset");
        break;
      }
      default:
        throw new Error("不明なメッセージです。");
    }
    await this.saveAndBroadcast();
  }

  // ---------- 保存・配信 ----------

  private async load(): Promise<void> {
    if (this.loaded) return;
    const [gid, lobby, game] = await Promise.all([
      this.ctx.storage.get<string>("gid"),
      this.ctx.storage.get<Lobby>("lobby"),
      this.ctx.storage.get<GameState>("game"),
    ]);
    this.gid = gid ?? null;
    this.lobby = lobby ?? { ...EMPTY_LOBBY, seats: [null, null, null] };
    this.game = game ?? null;
    this.loaded = true;
  }

  private async saveAndBroadcast(): Promise<void> {
    await this.ctx.storage.put({ lobby: this.lobby, game: this.game });
    // 持ち時間のアラームを張り直す（P-06）
    const dl = this.game ? nextDeadline(this.game) : null;
    if (dl !== null) await this.ctx.storage.setAlarm(dl);
    else await this.ctx.storage.deleteAlarm();
    this.broadcast();
    await this.maybeRegister();
  }

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) this.sendLobbyAndView(ws);
  }

  private sendLobbyAndView(ws: WebSocket): void {
    this.sendTo(ws, this.lobbyMsg());
    if (!this.game || !this.lobby) return;
    const att = this.att(ws);
    const seated = att.memberId && this.lobby.seats.some((s) => s?.memberId === att.memberId);
    if (seated) {
      this.sendTo(ws, { t: "view", view: this.view(this.game, att.memberId!, att.debug) });
    } else if (att.debug && this.lobby.seats[0]) {
      // 席に着いていないデバッグ接続は、席0の視点＋全員の手牌を見る
      this.sendTo(ws, { t: "view", view: this.view(this.game, this.lobby.seats[0].memberId, true) });
    }
  }

  private view(state: GameState, memberId: string, debug = false): PlayerView {
    return viewFor(state, memberId, { debug });
  }

  private lobbyMsg(): ServerMsg {
    const l = this.lobby ?? EMPTY_LOBBY;
    return {
      t: "lobby",
      seats: l.seats.map((s) => (s ? { memberId: s.memberId, name: s.name, connected: this.isOnline(s.memberId) } : null)),
      started: l.started,
    };
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
      if (msg.t !== "view") this.log(`send ${msg.t}${msg.t === "error" ? " " + msg.message : ""}`);
    } catch (e) {
      this.log(`send-failed ${String(e)}`);
    }
  }

  // ---------- 接続まわり ----------

  private att(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { memberId: null, debug: false };
  }

  /** そのメンバーの接続が1本でも開いているか */
  private isOnline(memberId: string, except?: WebSocket): boolean {
    return this.ctx.getWebSockets().some((w) => {
      if (w === except) return false;
      if (w.readyState !== WebSocket.OPEN) return false;
      return this.att(w).memberId === memberId;
    });
  }

  private async markDisconnected(memberId: string | null, ws: WebSocket): Promise<void> {
    if (!memberId) return;
    if (this.isOnline(memberId, ws)) return; // 別の端末でまだつながっている
    if (this.game) this.game = setConnected(this.game, memberId, false);
    await this.saveAndBroadcast();
  }

  private async findMember(memberId: string): Promise<{ id: string; name: string } | null> {
    if (!memberId || !this.gid) return null;
    const r = await this.env.DB.prepare(`SELECT id, name FROM members WHERE id=? AND group_id=?`)
      .bind(memberId, this.gid)
      .first<{ id: string; name: string }>();
    return r ? { id: String(r.id), name: String(r.name) } : null;
  }

  private log(s: string): void {
    console.log(`[table ${this.gid ?? "?"}] ${s}`);
  }

  // =====================================================================
  // 終局時の対戦記録への自動登録（I-03, I-04, C-06）
  // =====================================================================
  //
  // 何を入れるか：
  //   1. sessions … そのグループの「今日（日本時間）の日付」のセッション。無ければ新規作成
  //      （レート・チップ単価は対戦記録の既定値 RULES.DEFAULT_RATE / RULES.DEFAULT_CHIP）
  //   2. games … 半荘1件。素点は百点単位（満点/100）。3人合計は RULES.TOTAL（1050）
  //   3. chips … チップの増減（ゼロサム）を1件。既存の「チップの増減」記録と同じ形
  //      ＝ lines: [{memberId, count}]。精算では count×チップ単価 が各人の収支に足される。
  //      バイイン（20枚×回数）は卓の中でのチップの両替なので、お金の収支は「最終枚数−買った枚数」
  //      ＝ chipNet だけで決まる。chip_events（buy/count）は手入力の最終枚数を上書きしてしまうため使わない。
  //   4. yakuman … 役満が出ていれば殿堂に記録
  //   すべての INSERT と、それぞれの audit_logs への記録を1つの db.batch で行う（CLAUDE.md の絶対ルール）。
  //   二重登録を防ぐため、登録した半荘番号を storage の "registeredGameNo" に覚える。

  private async maybeRegister(): Promise<void> {
    if (!this.game || !this.lobby || !this.lobby.seats[0]) return;
    const v = this.view(this.game, this.lobby.seats[0].memberId);
    if (v.phase !== "game_end" || !v.final) return;
    const done = await this.ctx.storage.get<number>("registeredGameNo");
    if (done === this.lobby.gameNo) return;
    if (!this.gid) {
      this.log("register-skip gid不明");
      return;
    }
    try {
      const gameId = await this.registerToLedger(this.gid, v.final, v);
      await this.ctx.storage.put("registeredGameNo", this.lobby.gameNo);
      this.log(`registered gameNo=${this.lobby.gameNo} gameId=${gameId}`);
    } catch (e) {
      // 失敗しても状態はそのまま。次のメッセージ・アラームで再試行される
      this.log(`register-failed ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      for (const ws of this.ctx.getWebSockets()) {
        this.sendTo(ws, { t: "error", message: "対戦記録への自動登録に失敗しました。もう一度操作すると再試行します。" });
      }
    }
  }

  /** 対戦記録に登録して、作った半荘のIDを返す */
  private async registerToLedger(gid: string, final: FinalResult, v: PlayerView): Promise<string> {
    const db = this.env.DB;
    // テーブルが無い環境（新規デプロイ直後など）でも動くように、念のため作成（IF NOT EXISTS なので無害）
    await db.batch(BASE_SCHEMA.map((q) => db.prepare(q)));

    const t = new Date().toISOString();
    const actor = { groupId: gid, device: "online-table", memberId: null, name: "オンライン卓" };
    const stmts: D1PreparedStatement[] = [];

    // 1. 今日のセッション
    const session = await this.todaySession(gid, t, stmts, actor);

    // 2. 半荘
    const scores = this.toLedgerScores(final, v);
    const seqRow = await db
      .prepare(`SELECT COALESCE(MAX(seq),0)+1 AS n FROM games WHERE session_id=?`)
      .bind(session.id)
      .first<{ n: number }>();
    const game = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      seq: seqRow?.n ?? 1,
      rate: session.rate,
      scores,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    };
    stmts.push(
      db
        .prepare(`INSERT INTO games(id,group_id,session_id,seq,rate,scores,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(game.id, gid, game.sessionId, game.seq, game.rate, JSON.stringify(scores), t, t),
      this.audit(actor, "games", game.id, { ...game, source: "online-table", seed: this.lobby?.seed }, t),
    );

    // 3. チップの増減（ゼロサム）
    const lines = Object.entries(final.chipNet)
      .map(([memberId, count]) => ({ memberId, count }))
      .filter((l) => l.count !== 0);
    if (lines.length >= 2) {
      const buyMemo = Object.entries(final.buyins)
        .map(([id, n]) => `${this.nameOf(id)}${n}回`)
        .join("・");
      const chip = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        lines,
        memo: `オンライン卓 第${game.seq}半荘（バイイン ${buyMemo}）`.slice(0, 100),
        createdAt: t,
        deletedAt: null,
      };
      stmts.push(
        db
          .prepare(`INSERT INTO chips(id,group_id,session_id,lines,memo,created_at) VALUES (?,?,?,?,?,?)`)
          .bind(chip.id, gid, chip.sessionId, JSON.stringify(lines), chip.memo, t),
        this.audit(actor, "chips", chip.id, chip, t),
      );
    }

    // 4. 役満
    for (const y of final.yakuman) {
      const row = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        gameId: game.id,
        memberId: y.playerId,
        name: y.names.join("・").slice(0, 30),
        createdAt: t,
        deletedAt: null,
      };
      stmts.push(
        db
          .prepare(`INSERT INTO yakuman(id,group_id,session_id,game_id,member_id,name,created_at) VALUES (?,?,?,?,?,?,?)`)
          .bind(row.id, gid, row.sessionId, row.gameId, row.memberId, row.name, t),
        this.audit(actor, "yakuman", row.id, row, t),
      );
    }

    await db.batch(stmts);
    return game.id;
  }

  /** 今日（日本時間）のセッションを探す。無ければ作成用の文を stmts に積んで返す */
  private async todaySession(
    gid: string,
    t: string,
    stmts: D1PreparedStatement[],
    actor: { groupId: string; device: string; memberId: null; name: string },
  ): Promise<{ id: string; rate: number }> {
    const playedOn = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const found = await this.env.DB.prepare(
      `SELECT id, rate FROM sessions WHERE group_id=? AND played_on=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(gid, playedOn)
      .first<{ id: string; rate: number }>();
    if (found) return { id: String(found.id), rate: Number(found.rate) };
    const s = {
      id: crypto.randomUUID(),
      title: playedOn,
      playedOn,
      rate: RULES.DEFAULT_RATE,
      chipYen: RULES.DEFAULT_CHIP,
      createdAt: t,
      deletedAt: null,
    };
    stmts.push(
      this.env.DB.prepare(
        `INSERT INTO sessions(id,group_id,title,played_on,rate,chip_yen,created_at) VALUES (?,?,?,?,?,?,?)`,
      ).bind(s.id, gid, s.title, s.playedOn, s.rate, s.chipYen, s.createdAt),
      this.audit(actor, "sessions", s.id, s, t),
    );
    return { id: s.id, rate: s.rate };
  }

  /**
   * 最終持ち点（満点）→ 対戦記録の素点（百点単位・合計1050）。
   * - 卓に残った供託リーチ棒のぶん合計が足りないときは、慣例どおりトップに加える
   * - 同点は起家に近い席を上位にする（P-07）＝ tie に席の近さを入れる
   */
  private toLedgerScores(final: FinalResult, v: PlayerView): Score[] {
    const startDealer = this.lobby?.startDealer ?? 0;
    const rows = v.players.map((p) => ({
      memberId: p.id,
      score: Math.round((final.scores[p.id] ?? p.score) / 100),
      near: (p.seat - startDealer + 3) % 3,
    }));
    const diff = RULES.TOTAL - rows.reduce((s, r) => s + r.score, 0);
    if (diff !== 0) {
      const top = [...rows].sort((a, b) => b.score - a.score || a.near - b.near)[0];
      top.score += diff;
      this.log(`score-adjust ${diff * 100}点をトップ(${top.memberId})へ`);
    }
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.score, (counts.get(r.score) ?? 0) + 1);
    return rows.map((r) =>
      (counts.get(r.score) ?? 0) > 1 ? { memberId: r.memberId, score: r.score, tie: r.near } : { memberId: r.memberId, score: r.score },
    );
  }

  private nameOf(memberId: string): string {
    return this.lobby?.seats.find((s) => s?.memberId === memberId)?.name ?? memberId.slice(0, 4);
  }

  /** audit_logs への追記（UPDATE/DELETE はしない。DBのトリガーでも拒否される） */
  private audit(
    actor: { groupId: string; device: string; memberId: null; name: string },
    entity: string,
    entityId: string,
    after: unknown,
    t: string,
  ): D1PreparedStatement {
    return this.env.DB.prepare(
      `INSERT INTO audit_logs(group_id, entity, entity_id, action, before, after, actor_member_id, actor_name, actor_device, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(actor.groupId, entity, entityId, "insert", null, JSON.stringify(after), actor.memberId, actor.name, actor.device, t);
  }
}
