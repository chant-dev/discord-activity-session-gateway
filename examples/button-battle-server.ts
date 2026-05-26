import { Server } from "socket.io";
import {
  createDiscordTokenExchangeHandler,
  mountSocketSessionGateway,
  type GatewayPlayer,
  type SessionAdapter
} from "@discord-activities/session-gateway/server";
import { GameSession } from "../apps/server/src/game.js";

type Snapshot = ReturnType<GameSession["snapshot"]>;

class ButtonBattleSessionAdapter implements SessionAdapter<Snapshot> {
  readonly game: GameSession;

  constructor(readonly sessionId: string) {
    this.game = new GameSession(sessionId);
  }

  get room() {
    return `session:${this.game.sessionId}`;
  }

  canJoinPlayer(playerId: string) {
    return this.game.canJoinPlayer(playerId);
  }

  joinPlayer(player: GatewayPlayer) {
    this.game.joinPlayer(player);
  }

  markDisconnected(playerId: string) {
    this.game.markDisconnected(playerId);
  }

  connectedPlayerCount() {
    return this.game.connectedPlayerCount();
  }

  snapshot() {
    return this.game.snapshot();
  }

  canDeleteWhenIdle() {
    return this.game.phase === "lobby" || this.game.phase === "results";
  }
}

export function mountButtonBattleGateway(io: Server) {
  return mountSocketSessionGateway<Snapshot>(io, {
    createSession: (sessionId) => new ButtonBattleSessionAdapter(sessionId),
    fullSessionMessage: "This Button Battle session is full.",
    shouldDeleteIdleSession: (session) => session.canDeleteWhenIdle?.() ?? true
  });
}

export const discordTokenHandler = createDiscordTokenExchangeHandler(() => ({
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.DISCORD_REDIRECT_URI
}));
