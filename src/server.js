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
  if (
    !gamesList[room] ||
    !gamesList[room].players ||
    gamesList[room].players.length === 0
  ) {
    console.log(`Нет игроков в сессии ${room}`);
    return null;
  }

  // Создаем копию массива игроков
  const players = [...gamesList[room].players];

  // Сортируем игроков по убыванию счета
  players.sort((a, b) => b.score - a.score);

  // Первый игрок после сортировки - победитель
  const winner = players[0];

  console.log(
    `Победитель в игре ${room}: ${winner.name} со счетом ${winner.score}`
  );

  // Проверка на ничью
  const tiedPlayers = players.filter((player) => player.score === winner.score);

  if (tiedPlayers.length > 1) {
    console.log(
      `В игре ${room} ничья между игроками: ${tiedPlayers
        .map((p) => p.name)
        .join(", ")}`
    );
    return { winner, isTie: true, tiedPlayers };
  }

  return { winner, isTie: false };
}

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);
  app.use(cors());
  
  const io = new Server(server, {
     cors: { origin: "https://movie-quiz-psi.vercel.app" }, // use it on prod
   // cors: { origin: "*" },
  });



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
      // Проверка существования сессии перед созданием
      if (Object.keys(gamesList).find((id) => id === room)) {
        console.log(
          `Сессия с ID ${Object.keys(gamesList).find(
            (id) => id === room
          )} уже существует`
        );
        return;
      }

      gamesList[room] = {
        host: null, // Пока нет хоста
        players: [], // Пока нет игроков
        gamePage: null, // Пока нет данных об игре
      };

      console.log("Сессия создана:", room);
    });

    socket.on("join_room", (room, playerId, _id, playerName) => {
      // Проверка существования сессии
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не существует`);
        return;
      }

      if (_id === null) {
        _id = nanoid();
      }

      if (gamesList[room].players.find((player) => player._id === _id)) {
        if (
          gamesList[room].players.find((player) => player.socketId === playerId)
        ) {
          console.log(`Пользователь с ID ${playerId} уже в сессии ${room}`);
          return;
        }
      } else {
        gamesList[room].players.find((player) => player._id === _id).socketId =
          playerId;
      }

      if (gamesList[room].players.length >= 3) {
        console.log(`Сессия ${room} уже заполнена. Максимум игроков: 3`);
        return;
      }

      gamesList[room].players.push({
        _id: _id,
        socketId: playerId,
        name: playerName,
        score: 0,
      });

      socket.join(room);
      console.log(`Игрок ${playerId} подключился к сессии ${room}:`);

      if (gamesList[room].host && gamesList[room].players.length === 3) {
        io.to(room).emit("game_page", room);
        console.log(`Комната ${room} получила запрос на переход.`);
      } else {
        console.log(`Комната ${room} не готова к игре.`);
      }
    });

    socket.on("host_page_id", (room, id, _id) => {
      // Проверка существования сессии
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не найдена.`);
        return;
      }

      if (_id === null) {
        _id = nanoid();
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

    socket.on("game_page_id", (room, gameId, id) => {
      // Проверка существования сессии
      if (!gamesList[room]) {
        console.log(`Сессия ${room} не найдена.`);
        return;
      }

      if (id === null) id = nanoid();

      if (gamesList[room].gamePage === null) {
        gamesList[room].gamePage = {
          socketId: gameId,
          _id: id,
        };

        socket.join(room);

        // Используем io.to вместо socket.to для отправки конкретному сокету
        io.to(gamesList[room].host.socketId).emit("send_game_page_id", gameId);

        io.emit("game_page_id_answer", id);
        console.log(
          gameId,
          "ID игровой страницы отправлен хосту:",
          gamesList[room].host.socketId
        );
      } else if (gamesList[room].gamePage._id === id) {
        console.log(`ID игровой страницы уже отправлен хосту: ${gameId}`);
      } else {
        console.log(
          `ID игровой страницы уже отправлен хосту: ${gamesList[room].gamePage}, новый ID: ${gameId}`
        );
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

        // Исправлено: функция должна возвращать результат
        const framesList = () => {
          return result.resources.map((frame) => frame.url);
        };

        console.log(`📡 Отправляем ${framesList().length} кадров к ${gameId}`);
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
        // Проверка существования сессии и структуры данных
        if (
          !moviesList[room] ||
          !moviesList[room].themes ||
          !moviesList[room].themes[movieTheme]
        ) {
          console.log(`Тема ${movieTheme} не найдена в сессии ${room}`);
          return;
        }

        // Убеждаемся, что фильм существует
        if (!moviesList[room].themes[movieTheme].movies[movieName]) {
          console.log(`Фильм ${movieName} не найден в теме ${movieTheme}`);
          return;
        }

        moviesList[room].themes[movieTheme].movies[movieName].guessed = true;
        moviesList[room].themes[movieTheme].movies[movieName].whoGuessed =
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
      }

      const playerIndex = gamesList[room].players.findIndex(
        (player) => player.name === playerName
      );

      if (playerIndex === -1) {
        console.log(`Игрок ${playerName} не найден в сессии ${room}.`);
        return;
      }

      gamesList[room].players[playerIndex].score += pts; // Добавляем балл
      console.log(
        `Игрок ${playerName} получил ${pts} балл! Текущие очки: ${gamesList[room].players[playerIndex].score}`
      );

      io.to(gameId).emit("all_points", gamesList[room].players);
      io.to(gamesList[room].players[playerIndex].socketId).emit(
        "your_points",
        gamesList[room].players[playerIndex].score
      );
    });

    socket.on("end_game", (room) => {
      const result = determineWinner(room);

      if (result) {
        if (result.isTie) {
          // Обработка ничьей
          io.to(room).emit("game_ended_tie", {
            tiedPlayers: result.tiedPlayers.map((p) => ({
              name: p.name,
              score: p.score,
            })),
            score: result.winner.score,
          });
          console.log(`Игра ${room} завершена с ничьей`);
        } else {
          // Обработка победы
          io.to(room).emit("game_ended", {
            winner: result.winner.name,
            score: result.winner.score,
          });
          console.log(
            `Игра ${room} завершена, победитель ${result.winner.name} со счетом ${result.winner.score}`
          );
        }

        // Очистка данных игры
        delete gamesList[room];
        delete moviesList[room];
      } else {
        console.log(`Невозможно определить победителя в игре ${room}`);
      }
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
