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

const movies = {};

const selectedTheme = {};

const selectedMovie = {};

// const getThemesAndMovies = async () => {
//   const themesResult = await cloudinary.api.sub_folders("movie-quiz/themes");
//   const themes = themesResult.folders.name;
//   movies = { ...themes };
//   console.log(movies);
// for (const theme of themes) {
//   const moviesResult = await cloudinary.api.sub_folders(
//     `movie-quiz/themes/${theme.name}`
//   );
// }
// };
const getThemesAndMovies = async (room) => {
  try {
    console.log("📡 Запрос тем и фильмов...");

    const themesResult = await cloudinary.api.sub_folders("movie-quiz/themes");
    movies[room] = { themes: {} };
    for (const theme of themesResult.folders) {
      if (!movies[room].themes[theme.name]) {
        movies[room].themes[theme.name] = { movies: [] };

        const moviesResult = await cloudinary.api.sub_folders(
          `movie-quiz/themes/${theme.name}`
        );

        movies[room].themes[theme.name].movies = moviesResult.folders.map(
          (movie, index) => ({
            index,
            name: movie.name,
            guessed: false,
            whoGuessed: null,
          })
        );
      }
    }
    console.log("📡 Темы и фильмы получены:", movies[room].themes);
  } catch (error) {
    console.error("❌ Ошибка при запросе тем и фильмов:", error);
  }
};

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", async (socket) => {
    console.log("Новое подключение:", socket.id);

    socket.on("create_session", async (room) => {
      await getThemesAndMovies(room);
      games[room] = {
        host: { socketId: null },
        players: [
          { socketId: null, points: 0, name: "Черепашки" },
          { socketId: null, points: 0, name: "Черепушки" },
          { socketId: null, points: 0, name: "Черемушки" },
        ],
        game: { socketId: null },
      };
      // socket.leave(room);
      console.log("Сессия создана:", room);
    });

    socket.on("player_join_room", (room, playerName, playerSocket) => {
      if (!games[room]) {
        return;
      }

      // if (!playerId) {
      //   playerId = nanoid();
      // }
      const player = games[room].players.find(
        (player) => player.name === playerName
      );

      if (player.socketId !== playerSocket) {
        player.socketId = playerSocket;
        // player._id = playerId;
        console.log("Player joined", player);
        socket.join(room);
        // socket.emit("player_joined_room", playerId);
      } else {
        return;
      }
    });

    socket.on("host_join_room", (room, hostSocket) => {
      // if (hostId === null) {
      //   hostId = nanoid();
      // }

      if (!games[room]) {
        console.log("?");
        return;
      }

      let host = games[room].host;

      if (host.hostSocket === null) {
        host = { socketId: hostSocket };
        console.log("Host joined", host);
        socket.join(room);
        // socket.emit("host_joined_room", hostId);
      } else if (host.socketId !== hostSocket) {
        host.socketId = hostSocket;
        console.log("Host changed and joined", host);
        socket.join(room);
        // socket.emit("host_joined_room", hostId);
      } else if (host.socketId === hostSocket) {
        console.log("host exist", room, host);
      }
    });

    socket.on("game_join_room", (room, gameSocket) => {
      if (!games[room]) {
        return;
      }

      let game = games[room].game;
      // console.log("First game page", room, game);
      if (game.socketId === null) {
        game = { socketId: gameSocket };
        console.log("Game page joined", game);
        socket.join(room);
        // socket.emit("game_joined_room", gameId);
      } else if (game.socketId !== gameSocket) {
        game.socketId = gameSocket;
        console.log("Game page changed and joined", game);
        socket.join(room);
        // socket.emit("game_joined_room", gameId);
      } else {
        console.log("game exist", room);
      }
    });

    socket.on("start_game", (room) => {
      if (!games[room]) {
        return;
      }
      console.log("Game started", room);
      socket.broadcast.to(room).emit("start_game", room); // send event to homepage to navigate to game
    });

    socket.on("start_round", (room) => {
      console.log("Round started");
      socket.broadcast.to(room).emit("start_round");
    });

    socket.on("round_end", (room) => {
      console.log("Round ended");
      socket.broadcast.to(room).emit("round_end");
    });

    socket.on("player_answer", (room, playerName) => {
      console.log(`Player ${playerName} answering...`);
      socket.broadcast.to(room).emit("player_answer", playerName); // send event to all in this game
    });

    socket.on("answer_yes", (room, playerName) => {
      console.log("Answer yes");

      // movies[room].themes.forEach((theme) => {
      //   theme.movies.forEach((movie) => {
      //     if (movie.name === selectedMovie[room]) {
      //       movie.guessed = true;
      //     }
      //   });
      // });

      socket.broadcast.to(room).emit("answer_yes", playerName, movies[room]); // send event to all in this game
      socket.broadcast.to(room).emit("get_points", playerName);
    });

    socket.on("player_points", (room, playerName, pts, gameId, movie) => {
      console.log(room, playerName, pts, movie);
      const player = games[room].players.find(
        (player) => player.name === playerName
      );
      console.log(player);
      player.points += pts;

      io.to(gameId).emit("all_points", games[room].players);
      console.log("Sending points", games[room].players, "to", gameId);

      io.to(player.socketId).emit("your_points", player.points);
    });

    socket.on("answer_no", (room) => {
      console.log("Answer no");
      socket.broadcast.to(room).emit("answer_no"); // send event to all in this game
    });

    socket.on("get_themes", (room) => {
      if (!games[room]) {
        return;
      }
      console.log("Themes", room, movies[room].themes);
      const themeList = Object.keys(movies[room].themes); // Отримуємо список тем
      const moviesTheme = movies[room].themes; // Отримуємо об'єкт тем

      const list = {};
      for (const theme of themeList) {
        // Перебираємо теми
        list[theme] = [...moviesTheme[theme].movies]; // Копіюємо список фільмів у відповідну тему
      }
      io.to(room).emit("all_themes", list);
    });

    socket.on("get_frames", async (room, theme, movie) => {
      const frames = await cloudinary.api.resources_by_asset_folder(
        `movie-quiz/themes/${theme}/${movie}`
      );

      selectedTheme[room] = theme;
      selectedMovie[room] = movie;

      const framesList = () => {
        return frames.resources.map((frame) => frame.url);
      };
      console.log("Sending frames", framesList(), "from", movie, "to", room);
      io.to(room).emit("all_frames", framesList(), movie);
    });

    socket.on("change_frame", (gamePage) => {
      console.log("Change frame");
      socket.to(gamePage).emit("change_frame");
    });
    //frames and end game

    socket.on("end_game", (room) => {
      // const result = determineWinner(room);

      // if (result) {
      //   if (result.isTie) {
      //     // Обработка ничьей
      //     io.to(room).emit("game_ended_tie", {
      //       tiedPlayers: result.tiedPlayers.map((p) => ({
      //         name: p.name,
      //         score: p.score,
      //       })),
      //       score: result.winner.score,
      //     });
      //     console.log(`Игра ${room} завершена с ничьей`);
      //   } else {
      //     // Обработка победы
      //     io.to(room).emit("game_ended", {
      //       winner: result.winner.name,
      //       score: result.winner.score,
      //     });
      //     console.log(
      //       `Игра ${room} завершена, победитель ${result.winner.name} со счетом ${result.winner.score}`
      //     );
      //   }

      // Очистка данных игры
      delete gamesList[room];
      delete moviesList[room];
      //   } else {
      //     console.log(`Невозможно определить победителя в игре ${room}`);
      //   }
    });

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
