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

let hostPageIds = [];

let score = [];

let playerList = [];

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    // cors: { origin: "https://movie-quiz-psi.vercel.app" }, // use it on prod
    cors: { origin: "*" },
  });

  app.use(cors());

  app.use(
    pino({
      transport: {
        target: "pino-pretty",
      },
    })
  );

  app.get("/", (req, res) => {
    res.json({
      message: "Hello world!",
    });
  });

  io.on("connection", (socket) => {
    console.log("Новое подключение:", socket.id, socket.handshake.time);
    // socket.emit("home_page", socket.id);
    socket.on("create_session", (room) => {
      socket.join(room);

      console.log("Сессия создана:", room);
    });

    socket.on("join_room", (room) => {
      socket.join(room);

      const roomSize = io.sockets.adapter.rooms.get(room).size;
      console.log("users connected:", roomSize);
      if (roomSize === 5) {
        socket.to(room).emit("broadcast_full_room", room);
      }
      console.log("Игрок подключился к сессии:", room);
    });

    socket.on("join_room_game_page", (room, gamePageId) => {
      socket.join(room);
      socket.broadcast.to(room).emit("game_page_id", gamePageId);
    });

    socket.on("host_page_id", (id, _id) => {
      // Ищем запись по уникальному _id
      let existingHost = hostPageIds.find((host) => host._id === _id);

      if (!existingHost) {
        // Если хоста с таким _id нет, создаем новую запись
        const newHost = { _id: nanoid(), socketId: id };
        hostPageIds.push(newHost);
        io.emit("host_page_id_answer", newHost._id);
        console.log("Добавлен новый хост:", newHost);
      } else if (existingHost.socketId !== id) {
        // Если уже есть, просто обновляем socketId
        existingHost.socketId = id;
        io.emit("host_page_id_answer", existingHost._id);
        console.log("Обновлен существующий хост:", existingHost);
      } else {
        console.log("Хост существует");
      }

      console.log("Текущий список хостов:", hostPageIds);
    });

    socket.on("player_page_id", (id, _id) => {
      // Ищем запись по уникальному _id
      let existingPlayer = playerList.find((player) => player._id === _id);

      if (!existingPlayer) {
        // Если игрока с таким _id нет, создаем новую запись
        const newPlayer = { _id: nanoid(), socketId: id };
        playerList.push(newPlayer);
        io.emit("host_page_id_answer", newPlayer._id);
        console.log("Добавлен новый хост:", newPlayer);
      } else if (existingPlayer.socketId !== id) {
        // Если уже есть, просто обновляем socketId
        existingPlayer.socketId = id;
        io.emit("host_page_id_answer", existingPlayer._id);
        console.log("Обновлен существующий хост:", existingPlayer);
      } else {
        console.log("Игрок существует");
      }

      console.log("Текущий список игроков:", existingPlayer);
    });

    socket.on("game_page", (room, gamePageId) => {
      socket.broadcast.to(room).emit("game_page_id", gamePageId);
      // if (hostPageId) {
      //   // Используем io.to вместо socket.to для отправки конкретному сокету
      //   io.to(hostPageId).emit("send_game_page_id", gameId);
      //   console.log(hostPageId, "ID игровой страницы отправлен хосту:", gameId);
      // } else {
      //   console.log("Ошибка: ID хост-страницы не установлен");
      // }
    });

    socket.on("get_themes", async () => {
      try {
        console.log("📡 Запрос тем и фильмов...");
        const themesResult = await cloudinary.api.sub_folders(
          "movie-quiz/themes"
        );

        let themesWithMovies = [];

        for (const theme of themesResult.folders) {
          const moviesResult = await cloudinary.api.sub_folders(
            `movie-quiz/themes/${theme.name}`
          );
          themesWithMovies.push({
            theme: theme.name,
            movies: moviesResult.folders.map((movie, index) => {
              return {
                index,
                movie: movie.name,
              };
            }),
          });
        }

        console.log("✅ Отправляем темы и фильмы:", themesWithMovies);
        socket.emit("themes_list", themesWithMovies);
      } catch (error) {
        console.error("❌ Ошибка при запросе тем и фильмов:", error);
        socket.emit("themes_list", []);
      }
    });

    socket.on("select_movie", async (themeName, movieName, gameId) => {
      console.log("selected movie:", themeName, movieName, gameId);
      try {
        const result = await cloudinary.api.resources_by_asset_folder(
          `movie-quiz/themes/${themeName}/${movieName}`
        );
        console.log(
          "selected movie:",
          result.resources.map((frame) => frame.url)
        );
        io.to(gameId).emit(
          "open_frame",
          result.resources.map((frame) => frame.url)
        );
      } catch (error) {
        console.log("error", error.message);
      }
    });

    socket.on("change_frame", (gameId) => {
      io.to(gameId).emit("change_frame");
      console.log("FRAME, sended to", gameId);
    });

    socket.on("show_logo", (gameId) => {
      socket.to(gameId).emit("show_logo");
      console.log("LOGO, sended to", gameId);
    });

    socket.on("give_answer", (session, id) => {
      socket.broadcast.to(session).emit("broadcast_answer", id);

      console.log(id, session);
    });

    socket.on("bad_answer", (session) => {
      socket.to(session).emit("broadcast_bad_answer");
    });

    socket.on("send_points", (pts, gameId, playerName, playerId) => {
      console.log("Имя команды:", playerName);
      // Ищем игрока в массиве по playerId
      const playerIndex = score.findIndex((player) => player?.id === playerId);

      if (playerIndex === -1) {
        // Игрок не существует, добавляем его в массив
        score.push({ id: playerId, name: playerName, score: pts });
      } else {
        // Игрок существует, обновляем его счет
        score[playerIndex].score += pts;
      }

      // Отправляем всем игрокам в комнате обновленный массив очков
      io.to(gameId).emit("all_points", score);

      // Отправляем только игроку с данным playerId его личные очки
      io.to(playerId).emit(
        "your_points",
        score[playerIndex === -1 ? score.length - 1 : playerIndex]
      );

      console.log("Transferred data:", score);
      console.log(`Transferred ${pts} points to ${playerId}`);
    });

    socket.on("disconnect", () => {
      console.log("Пользователь отключился:", socket.id);
    });
  });

  app.get("*", (req, res, next) => {
    res.status(404).json({
      message: "Not found",
    });
  });

  app.use((err, req, res, next) => {
    res.status(500).json({
      message: "Something went wrong",
      error: err.message,
    });
  });

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};
