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

// const gamesList = session_12345: {  // ID сессии (уникальный идентификатор)
//     host: {
//       _id: "host_001",
//       socketId: "socket_abc123",
//     },
//     players: [
//       {
//         _id: "player_001",
//         socketId: "socket_xyz456",
//         name: "Игрок 1",
//         score: 0,
//       },
//       {
//         _id: "player_002",
//         socketId: "socket_xyz789",
//         name: "Игрок 2",
//         score: 0,
//       },
//       {
//         _id: "player_003",
//         socketId: "socket_xyz999",
//         name: "Игрок 3",
//         score: 0,
//       },
//     ],
//     gamePage: {
//       currentFrame: 1,  // Текущий кадр фильма
//       movieTitle: "Интерстеллар",  // Текущий фильм
//       isPaused: false,  // Игра на паузе или нет
//     },
//   },
// };

const moviesList = {};

//   session_1: {
//     theme: {
//       "Action Movies": [
//         { index: 0, name: "Die Hard", guessed: false },
//         { index: 1, name: "Mad Max: Fury Road", guessed: false }
//       ],
//       "Sci-Fi": [
//         { index: 0, name: "Interstellar", guessed: false },
//         { index: 1, name: "Blade Runner 2049", guessed: false }
//       ]
//     }
//   },
//   session_2: {
//     theme: {
//       "Horror": [
//         { index: 0, name: "The Conjuring", guessed: false },
//         { index: 1, name: "IT", guessed: false }
//       ]
//     }
//   }
// };

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

    socket.on("create_session", (room) => {
      gamesList[room] = {
        host: null, // Пока нет хоста
        players: [], // Пока нет игроков
        gamePage: null, // Пока нет данных об игре
      };
      // socket.join(room);
      if (gamesList[room]) {
        console.log(`Сессия с ID ${gamesList[room]} уже существует`);
        return;
      }

      console.log("Сессия создана:", room);
    });

    socket.on("join_room", (room, playerId, playerName) => {
      if (gamesList[room]?.players.find((player) => player._id === playerId)) {
        console.log(`Пользователь с ID ${playerId} уже в сессии ${room}`);
        return;
      }
      if (gamesList[room]?.players.length >= 3) {
        console.log(`Сессия ${room} уже заполнена. Максимум игроков: 3`);
        return;
      }

      gamesList[room]?.players.push({
        _id: playerId,
        socketId: socket.id,
        name: playerName,
        score: 0,
      });

      socket.join(room);
      console.log(`Игрок ${playerId} подключился к сессии${room}:`);

      if (gamesList[room]?.host && gamesList[room].players.length === 3) {
        io.to(room).emit("game_page", room);
        console.log(`Комната ${room} получила запрос на переход.`);
      } else {
        console.log(`Комната ${room} не готова к игре.`);
        return;
      }
    });

    socket.on("host_page_id", (room, id, _id) => {
      // Если сессии нет, ничего не делаем
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не найдена.`);
        return;
      }

      const session = gamesList[room];

      // Если хоста в сессии нет — добавляем нового
      if (!session.host) {
        session.host = { id: _id, socketId: id };
        socket.join(room);
        console.log(`Добавлен хост в сессию ${room}:`, session.host);
        return;
      }

      // Если хост уже есть, но ID совпадают, а socketId изменился — обновляем socketId
      if (session.host.id === _id) {
        if (session.host.socketId !== id) {
          session.host.socketId = id;
          console.log(
            `Обновлен socketId хоста в сессии ${room}:`,
            session.host
          );
        } else {
          console.log(
            `Хост в сессии ${room} уже актуален, изменений не требуется.`
          );
        }
        return;
      }

      // Если в сессии уже есть хост с другим hostId — ничего не делаем
      console.log(
        `В сессии ${room} уже есть другой хост, изменение не требуется.`
      );
    });

    socket.on("game_page_id", (room, gameId) => {
      if (gamesList[room].gamePage === null) {
        gamesList[room].gamePage = gameId;
        socket.join(room);
        // Используем io.to вместо socket.to для отправки конкретному сокету
        io.to(gamesList[room].host.socketId).emit("send_game_page_id", gameId);
        console.log(
          gameId,
          "ID игровой страницы отправлен хосту:",
          gamesList[room].host.socketId
        );
      } else if (gamesList[room].gamePage === gameId) {
        console.log(`ID игровой страницы уже отправлен хосту: ${gameId}`);
        return;
      } else {
        console.log(
          `ID игровой страницы уже отправлен хосту: ${gamesList[room].gamePage}, новый ID: ${gameId}`
        );
        return;
      }
    });

    /* - THEMES, MOVIES - */

    socket.on("get_themes", async (room) => {
      if (!moviesList[room]) {
        moviesList[room] = { themes: {} };
      }

      try {
        console.log("📡 Запрос тем и фильмов...");

        const themesResult = await cloudinary.api.sub_folders(
          "movie-quiz/themes"
        );

        for (const theme of themesResult.folders) {
          if (!moviesList[room].themes[theme.name]) {
            moviesList[room].themes[theme.name] = { movies: [] };

            const moviesResult = await cloudinary.api.sub_folders(
              `movie-quiz/themes/${theme.name}`
            );

            moviesList[room].themes[theme.name].movies =
              moviesResult.folders.map((movie, index) => ({
                index,
                name: movie.name,
                guessed: false,
                whoGuessed: null,
              }));
          }
        }

        io.emit("themes_list", moviesList[room].themes);
        console.log("📡 Темы и фильмы отправлены:", moviesList[room].themes);
      } catch (error) {
        console.error("❌ Ошибка при запросе тем и фильмов:", error);
      }
    });

    socket.on("select_movie", async (themeName, movieName, gameId) => {
      try {
        const result = await cloudinary.api.resources_by_asset_folder(
          `movie-quiz/themes/${themeName}/${movieName}`
        );
        const framesList = () => {
          result.resources.map((frame) => frame.url);
          // return frames.push
        };
        console.log(`📡 Отправляем ${framesList()} к ${gameId}`);
        io.to(gameId).emit("open_frame", framesList());
      } catch (error) {
        console.log("error", error.message);
      }
    });

    socket.on("change_frame", (gameId) => {
      io.to(gameId).emit("change_frame");
      console.log("FRAME, sended to", gameId);
    });

    socket.on(
      "show_logo",
      (gameId, room, playerName, movieTheme, movieName) => {
        moviesList[room].theme[movieTheme].movies[movieName].guessed = true;
        moviesList[room].theme[movieTheme].movies[movieName].whoGuessed =
          playerName;

        socket.to(gameId).emit("show_logo", moviesList[room]);
        console.log("LOGO, sended to", gameId);
      }
    );

    /* - ANSWERS - */

    socket.on("give_answer", (room, playerName) => {
      console.log(`Отвечает пользователь ${playerName} в сессии ${room}`);
      socket.broadcast.to(room).emit("broadcast_answer", playerName);
    });

    socket.on("bad_answer", (room) => {
      console.log(`Не верный ответ в сессии ${room}`);
      socket.to(room).emit("broadcast_bad_answer");
    });

    socket.on("send_points", (pts, room, playerName, gameId) => {
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не найдена.`);
        return;
      } else {
        const playerIndex = gamesList[room].players.findIndex(
          (player) => player.name === playerName
        );

        if (playerIndex === -1) {
          console.log(`Игрок ${playerName} не найден в сессии ${room}.`);
        } else {
          gamesList[room].players[playerIndex].score += pts; // Добавляем балл
          console.log(
            `Игрок ${playerName} получил ${pts} балл! Текущие очки: ${gamesList[room].players[playerIndex].score}`
          );
        }
      }
      io.to(gameId).emit("all_points", gamesList[room].players);
      io.to(playerName).emit(
        "your_points",
        gamesList[room].players[playerIndex].score
      );
    });

    socket.on("end_game", (room, highScore, playerName) => {
      socket.broadcast.to(room).emit("end_game", highScore, playerName);
      gamesList[room] = null;
      moviesList[room] = [];
      console.log(
        `Игра ${room} завершена, победитель ${playerName} со счетом ${highScore}`
      );
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
