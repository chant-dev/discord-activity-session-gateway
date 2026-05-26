# Migration Notes From Button Battle

Button Battle should stay unchanged until the package boundary is tested in isolation. The current app has a safe extraction target, but the first import swap would touch high-traffic paths in both the React app and Socket.IO server.

## Current Lifecycle Map

Browser identity lives in `apps/web/src/discord.ts`:

1. `resolveActivityIdentity()` checks `?local=1` or missing `VITE_DISCORD_CLIENT_ID` and falls back to `makeLocalIdentity()`.
2. `resolveDiscordSdk()` dynamically imports `@discord/embedded-app-sdk`, constructs `DiscordSDK`, waits for `ready()`, and disables interactive PiP.
3. The session key prefers `?session=`, then `sdk.channelId`, `sdk.instanceId`, `sdk.guildId`, then `discord-activity`.
4. `authenticateDiscordUser()` calls Discord `authorize`, posts the code to `/api/discord/token`, then calls SDK `authenticate`.
5. If OAuth fails but `sdk.user` exists, the app still uses Discord mode.
6. If no Discord user is available, the app falls back to a local identity while preserving the Discord-derived session ID.

Browser session lifecycle lives in `apps/web/src/App.tsx`:

1. The identity effect resolves identity once and stores the status note.
2. The socket effect creates a Socket.IO client for local or remote URLs.
3. On every `connect`, including reconnects, it emits `join_session` with `{ sessionId, player }`.
4. `session_state`, `player_joined`, `player_left`, scoring, bonus, and round events all sync the latest snapshot.
5. Cleanup emits `leave_session`, disconnects the socket, and clears local socket state.

Server lifecycle lives in `apps/server/src/index.ts`:

1. `RuntimeSession` tracks `playerId -> Set<socketId>` so multiple sockets for the same identity count as one present player.
2. `join_session` validates identity, gets or creates the session, joins the Socket.IO room, records the socket, calls `GameSession.joinPlayer()`, broadcasts `player_joined`, and acks with a snapshot.
3. `leave_session` and `disconnect` remove the socket. Only the last socket for a player calls `GameSession.markDisconnected()`.
4. `request_state` emits a snapshot back to the socket.
5. Empty sessions are deleted after five minutes only if they remain empty and the game is in `lobby` or `results`.

Game membership semantics live in `apps/server/src/game.ts`:

1. First connected player becomes host.
2. Rejoining with the same player ID refreshes display data and sets `connected = true`.
3. Disconnect in lobby/results removes the player.
4. Disconnect during active play preserves the player with `connected = false` for results integrity.
5. Host moves to the first remaining connected player.

## Recommended Migration Order

1. Install the sibling package in Button Battle:

   ```sh
   npm install ../discord-activity-session-gateway
   ```

2. Replace `apps/web/src/discord.ts` with package calls first:

   - `resolveActivityIdentity({ clientId, apiBaseUrl, oauthState: "button-battle", localStorageKey: "button-battle-local-identity" })`
   - `subscribeToActivityLayoutMode(listener, { clientId })`
   - Keep Button Battle's `ActivityIdentity` type compatible or re-export the package type.

3. Replace the socket effect in `apps/web/src/App.tsx` with `createActivitySessionClient<SessionSnapshot>()`.

   Keep the game-specific side effects for `round_started`, `bonus_started`, and `round_ended` in Button Battle until a separate event plugin layer exists.

4. Replace `/api/discord/token` in `apps/server/src/index.ts` with `createDiscordTokenExchangeHandler()`.

5. Extract `RuntimeSession` membership management last. Use `SocketSessionGateway` with an adapter around `GameSession`, then keep all game commands (`start_round`, `player_click`, `use_power_up`, etc.) in Button Battle.

## Why Button Battle Was Not Wired Immediately

The browser import boundary is close, but the current React socket effect also triggers sound effects on specific game events. A direct swap would be more than a pure session-gateway change.

The server boundary is also close, but `RuntimeSession` mixes generic presence with game timers, round commands, and game broadcasts. The package includes a `SessionAdapter` path for this, but migrating it safely needs a focused pass with tests around reconnects, active-round disconnects, host reassignment, and idle cleanup.
