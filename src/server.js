import express from "express";
import pino from "pino-http";
import cors from "cors";
import http from "http";

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

let hostPageId = null;

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

    socket.on("host_page_id", (id) => {
      hostPageId = id;
      console.log("host page id:", hostPageId);
    });

    socket.on("game_page", (gameId) => {
      if (hostPageId) {
        // Используем io.to вместо socket.to для отправки конкретному сокету
        io.to(hostPageId).emit("send_game_page_id", gameId);
        console.log(hostPageId, "ID игровой страницы отправлен хосту:", gameId);
      } else {
        console.log("Ошибка: ID хост-страницы не установлен");
      }
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

    socket.on("give_answer", ({ session, id }) => {
      socket.to(session).emit("broadcast_answer", id);

      console.log(id, session);
    });

    socket.on("bad_answer", (session) => {
      socket.to(session).emit("broadcast_bad_answer");
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
