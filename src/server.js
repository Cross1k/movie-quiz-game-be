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

const gamesList = {};
const moviesList = {};

function determineWinner(room) {
  if (!gamesList[room]?.players?.length) {
    console.log(`Нет игроков в сессии ${room}`);
    return null;
  }

  const players = [...gamesList[room].players].sort(
    (a, b) => b.score - a.score
  );
  const winner = players[0];

  console.log(
    `Победитель в игре ${room}: ${winner.name} со счетом ${winner.score}`
  );

  const tiedPlayers = players.filter((player) => player.score === winner.score);

  return tiedPlayers.length > 1
    ? { winner, isTie: true, tiedPlayers }
    : { winner, isTie: false };
}

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  app.use(cors());
  app.use(pino({ transport: { target: "pino-pretty" } }));

  app.get("/", (req, res) => res.json({ message: "Hello world!" }));

  io.on("connection", (socket) => {
    console.log("Новое подключение:", socket.id);

    socket.on("create_session", (room) => {
      if (Object.hasOwn(gamesList, room)) {
        console.log(`Сессия с ID ${room} уже существует`);
        return;
      }
      gamesList[room] = { host: null, players: [], gamePage: null };
      console.log("Сессия создана:", room);
    });

    socket.on("join_room", (room, playerId, id = nanoid(), playerName) => {
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не существует`);
        return;
      }

      gamesList[room].players ??= [];

      const existingPlayer = gamesList[room].players.find(
        (player) => player._id === id
      );

      if (existingPlayer) {
        if (existingPlayer.socketId !== playerId) {
          console.log(`Обновляем socketId для игрока ${playerName}`);
          existingPlayer.socketId = playerId;
        } else {
          console.log(`Игрок ${playerName} уже в сессии ${room}`);
          return;
        }
      } else {
        if (gamesList[room].players.length >= 3) {
          console.log(`Сессия ${room} заполнена`);
          return;
        }

        gamesList[room].players.push({
          _id: id,
          socketId: playerId,
          name: playerName,
          score: 0,
        });
        io.to(playerId).emit("player_page_id_answer", id);
        console.log(
          `Игрок ${playerName} (${playerId}) подключился к сессии ${room}`
        );
      }

      socket.join(room);

      if (gamesList[room].host && gamesList[room].players.length === 3) {
        io.to(room).emit("game_page", room);
        console.log(`Игра в комнате ${room} запущена`);
      }
    });

    socket.on("host_page_id", (room, id, _id = nanoid()) => {
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не найдена.`);
        return;
      }

      const session = gamesList[room];

      if (!session.host) {
        session.host = { id: _id, socketId: id };
        socket.join(room);
        io.to(id).emit("game_page_id", session?.gamePage?.id);
        console.log(`Добавлен хост в сессию ${room}:`, session.host);
      } else if (session.host.id === _id && session.host.socketId !== id) {
        session.host.socketId = id;
        socket.join(room);
        console.log(`Обновлен socketId хоста в сессии ${room}`);
      }

      io.to(id).emit("host_page_id_answer", _id);
    });

    socket.on("send_points", (pts, room, playerName, gameId) => {
      const session = gamesList[room];
      if (!session) return console.log(`Сессия ${room} не найдена.`);

      const player = session.players.find((p) => p.name === playerName);
      if (!player)
        return console.log(`Игрок ${playerName} не найден в сессии ${room}.`);

      player.score += pts;
      console.log(
        `Игрок ${playerName} получил ${pts} балл! Текущие очки: ${player.score}`
      );

      io.to(gameId).emit("all_points", session.players);
      io.to(player.socketId).emit("your_points", player.score);
    });

    socket.on("end_game", (room) => {
      const result = determineWinner(room);
      if (!result)
        return console.log(`Невозможно определить победителя в игре ${room}`);

      if (result.isTie) {
        io.to(room).emit("game_ended_tie", {
          tiedPlayers: result.tiedPlayers.map((p) => ({
            name: p.name,
            score: p.score,
          })),
          score: result.winner.score,
        });
        console.log(`Игра ${room} завершена с ничьей`);
      } else {
        io.to(room).emit("game_ended", {
          winner: result.winner.name,
          score: result.winner.score,
        });
        console.log(`Игра ${room} завершена, победитель ${result.winner.name}`);
      }

      delete gamesList[room];
      delete moviesList[room];
    });

    socket.on("disconnect", () =>
      console.log("Пользователь отключился:", socket.id)
    );
  });

  app.use((req, res) => res.status(404).json({ message: "Not found" }));

  app.use((err, req, res, next) => {
    console.error("Ошибка:", err.message);
    res
      .status(500)
      .json({ message: "Что-то пошло не так", error: err.message });
  });

  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
};
