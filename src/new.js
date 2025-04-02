import express from "express";
import pino from "pino-http";
import cors from "cors";
import http from "http";
import { nanoid } from "nanoid";
import { v2 as cloudinary } from "cloudinary";
import { Server } from "socket.io";

import { getEnvVar } from "./utils/getEnvVar.js";
import { CLOUDINARY } from "./utils/cloudinary.js";

const PORT = Number(getEnvVar("PORT", "3000"));

cloudinary.config({
  secure: true,
  cloud_name: getEnvVar(CLOUDINARY.CLOUDNAME),
  api_key: getEnvVar(CLOUDINARY.CLOUDAPIKEY),
  api_secret: getEnvVar(CLOUDINARY.CLOUDAPISECRET),
});

const games = {};

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    console.log("Новое подключение:", socket.id);

    socket.on("create_session", (room) => {
      games[room] = {
        host: { socketId: null, _id: null },
        players: [
          { socketId: null, _id: null, points: 0, name: "Черепашки" },
          { socketId: null, _id: null, points: 0, name: "Черепушки" },
          { socketId: null, _id: null, points: 0, name: "Черемушки" },
        ],
        game: { socketId: null, _id: null },
      };
    });

    socket.on(
      "player_join_room",
      (room, playerName, playerSocket, playerId) => {
        const player = games[room].players.find(
          (player) => player.name === playerName
        );
        if (!playerId) {
          playerId = nanoid();
        }

        player.socketId = playerSocket;
        player._id = playerId;
      }
    );

    socket.on("host_join_room", (room, hostSocket, hostId) => {
      const host = games[room].host;

      if (!host) {
        games[room].host = { socketId: hostSocket, _id: nanoid() };
        socket.join(room);
        socket.emit("host_joined_room", hostId);
      } else if (host.socketId !== hostSocket && host._id === hostId) {
        host.socketId = hostSocket;
        socket.join(room);
        socket.emit("host_joined_room", hostId);
      } else {
        console.log("host exist", room);
      }
    });

    socket.on("game_join_room", (room, gameSocket, gameId) => {
      const game = games[room].game;

      if (!game) {
        games[room].game = { socketId: gameSocket, _id: gameId };
        socket.join(room);
        socket.emit("game_joined_room", gameId);
      } else if (game.socketId !== gameSocket && game._id === gameId) {
        game.socketId = gameSocket;
        socket.join(room);
        socket.emit("game_joined_room", gameId);
      } else {
        console.log("game exist", room);
      }
    });

    socket.on("start_game", (room) => {
      socket.broadcast.to(room).emit("start_game"); // send event to homepage to navigate to game
    });

    socket.on("player_answer", (room, playerName) => {
      socket.broadcast.to(room).emit("player_answer", playerName); // send event to all in this game
    });

    socket.on("answer_yes", (room) => {
      socket.broadcast.to(room).emit("answer_yes"); // send event to all in this game
    });

    socket.on("answer_no", (room) => {
      socket.broadcast.to(room).emit("answer_no"); // send event to all in this game
    });

    socket.on("get_points", (room, playerName, pts, playerSocket) => {
      games[room].players.find((player) => player.name === playerName).points +=
        pts;

      socket.broadcast.to(room).emit("all_points", games[room].players);
      io.to(playerSocket).emit(
        "your_points",
        games[room].players.find((player) => player.name === playerName).points
      );
    });

    //frames and end game

    io.on("disconnect", () => {
      console.log("Пользователь отключился:", socket.id);
    });
  });

  app.use(cors());
  app.use(pino({ transport: { target: "pino-pretty" } }));

  app.get("/", (req, res) => res.json({ message: "Hello world!" }));

  app.use((req, res) => res.status(404).json({ message: "Not found" }));

  app.use((err, req, res, next) => {
    console.error("Ошибка:", err.message);
    res
      .status(500)
      .json({ message: "Что-то пошло не так", error: err.message });
  });

  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
};
