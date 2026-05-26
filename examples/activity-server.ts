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

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? true,
    credentials: true
  }
});
const gateway = mountSocketSessionGateway(io);

app.get("/health", (_request, response) => {
  response.json({ ok: true, sessions: gateway.sessionCount });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`Activity session gateway listening on ${port}`);
});
