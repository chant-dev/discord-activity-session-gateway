import type { Server, Socket } from "socket.io";
import type { GatewayPlayer, JoinSessionPayload } from "./types.js";

export interface GatewayMember extends GatewayPlayer {
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface PresenceSnapshot {
  sessionId: string;
  hostId?: string;
  players: GatewayMember[];
  connectedPlayerCount: number;
  serverNow: number;
}

export interface PresenceSessionOptions {
  maxConnectedPlayers?: number;
  preserveDisconnectedMembers?: boolean;
}

export interface SessionAdapter<TSnapshot> {
  sessionId: string;
  room?: string;
  canJoinPlayer: (playerId: string) => boolean;
  joinPlayer: (player: GatewayPlayer) => unknown;
  markDisconnected: (playerId: string) => unknown;
  connectedPlayerCount: () => number;
  snapshot: () => TSnapshot;
  canDeleteWhenIdle?: () => boolean;
}

export interface SocketSessionGatewayEvents {
  join: string;
  leave: string;
  requestState: string;
  state: string;
  joined: string;
  left: string;
  error: string;
}

export interface SocketSessionGatewayOptions<TSnapshot> {
  createSession?: (sessionId: string) => SessionAdapter<TSnapshot>;
  defaultSessionId?: string;
  maxSessionIdLength?: number;
  cleanupAfterMs?: number;
  events?: Partial<SocketSessionGatewayEvents>;
  missingIdentityMessage?: string;
  fullSessionMessage?: string;
  shouldDeleteIdleSession?: (session: SessionAdapter<TSnapshot>) => boolean;
}

export interface DiscordTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

export interface DiscordTokenExchangeOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  discordTokenUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ExpressLikeRequest {
  body?: unknown;
}

export interface ExpressLikeResponse {
  status: (statusCode: number) => ExpressLikeResponse;
  json: (payload: unknown) => void;
}

interface ManagedSession<TSnapshot> {
  adapter: SessionAdapter<TSnapshot>;
  playerSockets: Map<string, Set<string>>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

interface GatewaySocketData {
  sessionId?: string;
  playerId?: string;
}

const DEFAULT_EVENTS: SocketSessionGatewayEvents = {
  join: "join_session",
  leave: "leave_session",
  requestState: "request_state",
  state: "session_state",
  joined: "player_joined",
  left: "player_left",
  error: "error_message"
};

export class PresenceSession implements SessionAdapter<PresenceSnapshot> {
  readonly sessionId: string;
  readonly room: string;
  private readonly maxConnectedPlayers: number;
  private readonly preserveDisconnectedMembers: boolean;
  private members = new Map<string, GatewayMember>();
  private hostId?: string;

  constructor(sessionId: string, options: PresenceSessionOptions = {}) {
    this.sessionId = sessionId;
    this.room = `session:${sessionId}`;
    this.maxConnectedPlayers = options.maxConnectedPlayers ?? 12;
    this.preserveDisconnectedMembers = options.preserveDisconnectedMembers ?? false;
  }

  canJoinPlayer(playerId: string): boolean {
    return this.members.has(playerId) || this.connectedPlayerCount() < this.maxConnectedPlayers;
  }

  joinPlayer(input: GatewayPlayer): GatewayMember {
    const now = Date.now();
    const displayName = input.displayName.trim().slice(0, 32) || "Activity Player";
    let member = this.members.get(input.id);

    if (!member) {
      member = {
        id: input.id,
        displayName,
        avatarUrl: input.avatarUrl,
        connected: true,
        isHost: false,
        joinedAt: now,
        lastSeenAt: now
      };
      this.members.set(input.id, member);
    }

    member.displayName = displayName;
    member.avatarUrl = input.avatarUrl;
    member.connected = true;
    member.lastSeenAt = now;

    if (!this.hostId || !this.members.get(this.hostId)?.connected) {
      this.hostId = member.id;
    }

    this.syncHostFlags();
    return { ...member };
  }

  markDisconnected(playerId: string): void {
    const member = this.members.get(playerId);
    if (!member) {
      return;
    }

    if (this.preserveDisconnectedMembers) {
      member.connected = false;
      member.lastSeenAt = Date.now();
    } else {
      this.members.delete(playerId);
    }

    if (this.hostId === playerId) {
      this.hostId = this.connectedMembers()[0]?.id;
    }

    this.syncHostFlags();
  }

  connectedPlayerCount(): number {
    return this.connectedMembers().length;
  }

  canDeleteWhenIdle(): boolean {
    return this.connectedPlayerCount() === 0;
  }

  snapshot(now = Date.now()): PresenceSnapshot {
    const players = Array.from(this.members.values())
      .map((member) => ({ ...member }))
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.displayName.localeCompare(b.displayName));

    return {
      sessionId: this.sessionId,
      hostId: this.hostId,
      players,
      connectedPlayerCount: this.connectedPlayerCount(),
      serverNow: now
    };
  }

  private connectedMembers(): GatewayMember[] {
    return Array.from(this.members.values()).filter((member) => member.connected);
  }

  private syncHostFlags(): void {
    for (const member of this.members.values()) {
      member.isHost = member.id === this.hostId;
    }
  }
}

export class SocketSessionGateway<TSnapshot = PresenceSnapshot> {
  private readonly events: SocketSessionGatewayEvents;
  private readonly sessions = new Map<string, ManagedSession<TSnapshot>>();

  constructor(
    private readonly io: Server,
    private readonly options: SocketSessionGatewayOptions<TSnapshot> = {}
  ) {
    this.events = { ...DEFAULT_EVENTS, ...options.events };
  }

  attach(): void {
    this.io.on("connection", (socket) => this.attachSocket(socket));
  }

  attachSocket(socket: Socket): void {
    socket.on(this.events.join, (payload: JoinSessionPayload, ack?: (snapshot: TSnapshot) => void) => {
      this.joinSocket(socket, payload, ack);
    });

    socket.on(this.events.leave, () => {
      this.leaveSocket(socket);
    });

    socket.on(this.events.requestState, () => {
      const socketData = socket.data as GatewaySocketData;
      if (!socketData.sessionId) {
        return;
      }
      socket.emit(this.events.state, this.getSession(socketData.sessionId).adapter.snapshot());
    });

    socket.on("disconnect", () => {
      this.leaveSocket(socket);
    });
  }

  getSnapshot(sessionId: string): TSnapshot {
    return this.getSession(sessionId).adapter.snapshot();
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  private joinSocket(socket: Socket, payload: JoinSessionPayload, ack?: (snapshot: TSnapshot) => void): void {
    if (!payload?.player?.id || !payload.player.displayName) {
      socket.emit(this.events.error, this.options.missingIdentityMessage ?? "Missing player identity for session join.");
      return;
    }

    const managed = this.getSession(payload.sessionId);
    if (!managed.adapter.canJoinPlayer(payload.player.id)) {
      const snapshot = managed.adapter.snapshot();
      socket.emit(this.events.error, this.options.fullSessionMessage ?? "This Activity session is full.");
      ack?.(snapshot);
      return;
    }

    const socketData = socket.data as GatewaySocketData;
    socketData.sessionId = managed.adapter.sessionId;
    socketData.playerId = payload.player.id;
    socket.join(roomForSession(managed.adapter));
    this.addSocket(managed, payload.player.id, socket.id);
    managed.adapter.joinPlayer(payload.player);
    this.broadcast(managed, this.events.joined);
    ack?.(managed.adapter.snapshot());
  }

  private leaveSocket(socket: Socket): void {
    const socketData = socket.data as GatewaySocketData;
    const sessionId = socketData.sessionId;
    const playerId = socketData.playerId;
    if (!sessionId || !playerId) {
      return;
    }

    const managed = this.getSession(sessionId);
    this.removeSocket(managed, playerId, socket.id);
    socket.leave(roomForSession(managed.adapter));
    socketData.sessionId = undefined;
    socketData.playerId = undefined;
    this.scheduleSessionCleanup(managed.adapter.sessionId);
  }

  private getSession(sessionId = this.options.defaultSessionId ?? "local-arena"): ManagedSession<TSnapshot> {
    const safeSessionId = sanitizeSessionId(sessionId, this.options.maxSessionIdLength ?? 80, this.options.defaultSessionId ?? "local-arena");
    const existing = this.sessions.get(safeSessionId);
    if (existing) {
      if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
        existing.cleanupTimer = undefined;
      }
      return existing;
    }

    const adapter = this.options.createSession
      ? this.options.createSession(safeSessionId)
      : (new PresenceSession(safeSessionId) as unknown as SessionAdapter<TSnapshot>);
    const managed = {
      adapter,
      playerSockets: new Map<string, Set<string>>()
    };
    this.sessions.set(safeSessionId, managed);
    return managed;
  }

  private addSocket(managed: ManagedSession<TSnapshot>, playerId: string, socketId: string): void {
    const socketIds = managed.playerSockets.get(playerId) ?? new Set<string>();
    socketIds.add(socketId);
    managed.playerSockets.set(playerId, socketIds);
  }

  private removeSocket(managed: ManagedSession<TSnapshot>, playerId: string, socketId: string): void {
    const socketIds = managed.playerSockets.get(playerId);
    if (!socketIds) {
      return;
    }

    socketIds.delete(socketId);
    if (socketIds.size === 0) {
      managed.playerSockets.delete(playerId);
      managed.adapter.markDisconnected(playerId);
      this.broadcast(managed, this.events.left);
    }
  }

  private broadcast(managed: ManagedSession<TSnapshot>, event: string): void {
    const snapshot = managed.adapter.snapshot();
    this.io.to(roomForSession(managed.adapter)).emit(event, snapshot);
    if (event !== this.events.state) {
      this.io.to(roomForSession(managed.adapter)).emit(this.events.state, snapshot);
    }
  }

  private scheduleSessionCleanup(sessionId: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.adapter.connectedPlayerCount() > 0) {
      return;
    }

    if (managed.cleanupTimer) {
      clearTimeout(managed.cleanupTimer);
    }

    managed.cleanupTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current || current.adapter.connectedPlayerCount() > 0) {
        return;
      }

      const canDelete =
        this.options.shouldDeleteIdleSession?.(current.adapter) ??
        current.adapter.canDeleteWhenIdle?.() ??
        true;
      if (canDelete) {
        this.sessions.delete(sessionId);
      }
    }, this.options.cleanupAfterMs ?? 5 * 60_000);
  }
}

export function mountSocketSessionGateway<TSnapshot = PresenceSnapshot>(
  io: Server,
  options: SocketSessionGatewayOptions<TSnapshot> = {}
): SocketSessionGateway<TSnapshot> {
  const gateway = new SocketSessionGateway<TSnapshot>(io, options);
  gateway.attach();
  return gateway;
}

export async function exchangeDiscordActivityCodeForToken(
  code: string,
  options: DiscordTokenExchangeOptions
): Promise<DiscordTokenResponse> {
  if (!code) {
    throw new Error("Missing Discord authorization code");
  }

  if (!options.clientId || !options.clientSecret) {
    throw new Error("Discord OAuth credentials are not configured on the backend");
  }

  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: options.redirectUri?.trim() || "https://127.0.0.1"
  });

  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl(options.discordTokenUrl ?? "https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await tokenResponse.json();

  if (!tokenResponse.ok) {
    throw new DiscordTokenExchangeError(
      "Discord token exchange failed",
      tokenResponse.status,
      payload.error_description ?? payload.error
    );
  }

  return {
    access_token: payload.access_token,
    token_type: payload.token_type,
    expires_in: payload.expires_in,
    scope: payload.scope
  };
}

export function createDiscordTokenExchangeHandler(
  options: DiscordTokenExchangeOptions | (() => DiscordTokenExchangeOptions)
): (request: ExpressLikeRequest, response: ExpressLikeResponse) => Promise<void> {
  return async (request, response) => {
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const code = typeof body.code === "string" ? body.code : "";

    if (!code) {
      response.status(400).json({ error: "Missing Discord authorization code" });
      return;
    }

    const resolvedOptions = typeof options === "function" ? options() : options;
    if (!resolvedOptions.clientId || !resolvedOptions.clientSecret) {
      response.status(501).json({ error: "Discord OAuth credentials are not configured on the backend" });
      return;
    }

    try {
      const token = await exchangeDiscordActivityCodeForToken(code, resolvedOptions);
      response.json(token);
    } catch (error) {
      if (error instanceof DiscordTokenExchangeError) {
        response.status(error.statusCode).json({
          error: error.message,
          detail: error.detail
        });
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown token exchange error";
      response.status(502).json({ error: "Discord token exchange request failed", detail: message });
    }
  };
}

export class DiscordTokenExchangeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly detail?: string
  ) {
    super(message);
    this.name = "DiscordTokenExchangeError";
  }
}

function sanitizeSessionId(sessionId: string, maxLength: number, fallback: string): string {
  return sessionId.trim().slice(0, maxLength) || fallback;
}

function roomForSession<TSnapshot>(session: SessionAdapter<TSnapshot>): string {
  return session.room ?? `session:${session.sessionId}`;
}
