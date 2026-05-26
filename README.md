# Discord Activity Session Gateway

Reusable Discord Activity identity, OAuth, Socket.IO session, and presence primitives extracted from `button-battle` with a copy-first strategy.

This package keeps the game-specific rules out of the gateway. It gives Activity apps:

- Browser identity resolution through the Discord Embedded App SDK, OAuth code exchange, SDK user fallback, and local browser fallback.
- Browser layout-mode subscription for focused, picture-in-picture, and grid modes.
- Browser Socket.IO lifecycle handling: connect, join on connect/reconnect, sync snapshots, emit leave, and disconnect.
- Server token exchange helpers for `/api/discord/token`.
- Server session membership and presence helpers for join, leave, disconnect, host assignment, reconnect, room broadcasts, and idle cleanup.

## Button Battle Source Map

The extraction came from these current Button Battle paths:

- `apps/web/src/discord.ts`: Discord SDK init, `ready()`, `authorize`, backend token exchange, `authenticate`, avatar URL building, SDK user fallback, local identity fallback, and layout-mode subscription.
- `apps/web/src/localIdentity.ts`: `sessionStorage` identity persistence, `?name=`, `?session=`, and random local player generation.
- `apps/web/src/App.tsx`: Socket.IO connect handler, `join_session`, snapshot sync events, error handling, and leave/disconnect cleanup.
- `apps/server/src/index.ts`: `/api/discord/token`, Socket.IO room join/leave/disconnect handlers, socket-per-player tracking, broadcast shape, `request_state`, and idle session cleanup.
- `apps/server/src/game.ts`: membership semantics used by the gateway examples: first connected player becomes host, reconnect marks the player connected again, disconnect removes idle lobby/results players, active rounds preserve disconnected players, and host is reassigned.

## Install

```sh
npm install @discord-activities/session-gateway
```

For local sibling development from Button Battle:

```sh
npm install ../discord-activity-session-gateway
```

## Browser Usage

```ts
import {
  createActivitySessionClient,
  resolveActivityIdentity,
  websocketUrlForIdentity
} from "@discord-activities/session-gateway/browser";

const identity = await resolveActivityIdentity({
  clientId: import.meta.env.VITE_DISCORD_CLIENT_ID,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  oauthState: "my-activity"
});

const socketUrl = websocketUrlForIdentity({
  identity,
  remoteWsUrl: import.meta.env.VITE_WS_URL,
  localWsUrl: import.meta.env.VITE_LOCAL_WS_URL,
  localApiBaseUrl: "http://localhost:3001"
});

const session = createActivitySessionClient({
  socketUrl,
  identity,
  onStatus: console.info,
  onError: console.error,
  onSnapshot: (snapshot) => {
    // Render app state.
  }
});

session.connect();
window.addEventListener("beforeunload", () => session.disconnect());
```

## Server Usage

```ts
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  createDiscordTokenExchangeHandler,
  mountSocketSessionGateway
} from "@discord-activities/session-gateway/server";

const app = express();
app.use(express.json());

app.post("/api/discord/token", createDiscordTokenExchangeHandler(() => ({
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  redirectUri: process.env.DISCORD_REDIRECT_URI
})));

const server = createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const gateway = mountSocketSessionGateway(io);

app.get("/health", (_request, response) => {
  response.json({ ok: true, sessions: gateway.sessionCount });
});
```

For an authoritative game, pass `createSession` with a `SessionAdapter` around your game state instead of using the default `PresenceSession`.

See `examples/button-battle-web.tsx` and `examples/button-battle-server.ts` for Button Battle-shaped integration.
