# Discord Activity Session Gateway

Reusable Discord Activity identity, OAuth, Socket.IO session, and presence gateway primitives.

This package keeps app-specific rules out of the gateway. It gives Discord Activity apps:

- Browser identity resolution through the Discord Embedded App SDK, OAuth code exchange, SDK user fallback, and local browser fallback.
- Browser layout-mode subscription for focused, picture-in-picture, and grid modes.
- Browser Socket.IO lifecycle handling: connect, join on connect/reconnect, sync snapshots, emit leave, and disconnect.
- Server token exchange helpers for `/api/discord/token`.
- Server session membership and presence helpers for join, leave, disconnect, host assignment, reconnect, room broadcasts, and idle cleanup.

## Install

```sh
npm install @discord-activities/session-gateway
```

For local package development:

```sh
npm install ../discord-activity-session-gateway
```

## Environment

Copy `.env.example` into the app that hosts your Activity and fill in the Discord application values:

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_REDIRECT_URI` are read by the server token exchange helper.
- `VITE_DISCORD_CLIENT_ID`, `VITE_API_BASE_URL`, and `VITE_WS_URL` are read by Vite browser clients.
- `VITE_LOCAL_API_BASE_URL` and `VITE_LOCAL_WS_URL` let local browser mode talk to a local gateway.

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

See `examples/activity-web.tsx` and `examples/activity-server.ts` for a Vite browser hook and an Express plus Socket.IO server.
