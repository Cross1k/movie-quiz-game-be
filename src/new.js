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
      await getThemesAndMovies(socket.id);
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
        if (!playerId) {
          playerId = nanoid();
        }
        const player = games[room].players.find(
          (player) => player.name === playerName
        );

        if (player._id !== playerId) {
          player.socketId = playerSocket;
          player._id = playerId;
          console.log("Player joined", player);
          socket.join(room);
          socket.emit("player_joined_room", playerId);
        } else {
          return;
        }
      }
    );

    socket.on("host_join_room", (room, hostSocket, hostId) => {
      if (!hostId) {
        hostId = nanoid();
      }

      const host = games[room].host;

      if (!host) {
        games[room].host = { socketId: hostSocket, _id: nanoid() };
        console.log("Host joined", host);
        socket.join(room);
        socket.emit("host_joined_room", hostId);
      } else if (host.socketId !== hostSocket && host._id === hostId) {
        host.socketId = hostSocket;
        console.log("Host changed and joined", host);
        socket.join(room);
        socket.emit("host_joined_room", hostId);
      } else {
        console.log("host exist", room);
      }
    });

    socket.on("game_join_room", (room, gameSocket, gameId) => {
      if (!gameId) {
        gameId = nanoid();
      }

      const game = games[room].game;

      if (!game) {
        games[room].game = { socketId: gameSocket, _id: gameId };
        console.log("Game page joined", game);
        socket.join(room);
        socket.emit("game_joined_room", gameId);
      } else if (game.socketId !== gameSocket && game._id === gameId) {
        game.socketId = gameSocket;
        console.log("Game page changed and joined", game);
        socket.join(room);
        socket.emit("game_joined_room", gameId);
      } else {
        console.log("game exist", room);
      }
    });

    socket.on("start_game", (room) => {
      console.log("Game started");
      socket.broadcast.to(room).emit("start_game"); // send event to homepage to navigate to game
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

    socket.on("answer_yes", (room) => {
      console.log("Answer yes");
      socket.broadcast.to(room).emit("answer_yes"); // send event to all in this game
    });

    socket.on("answer_no", (room) => {
      console.log("Answer no");
      socket.broadcast.to(room).emit("answer_no"); // send event to all in this game
    });

    socket.on("get_points", (room, playerName, pts, playerSocket) => {
      games[room].players.find((player) => player.name === playerName).points +=
        pts;

      console.log("Sending points", games[room].players);
      socket.broadcast.to(room).emit("all_points", games[room].players);
      io.to(playerSocket).emit(
        "your_points",
        games[room].players.find((player) => player.name === playerName).points
      );
    });

    socket.on("get_themes", (room) => {
      const theme = Object.keys(movies[socket.id].themes);
      const moviesTheme = movies[socket.id].themes[theme].movies;
      const list = {};
      for (const movie of moviesTheme) {
        list[movie] = [...moviesTheme];
      }
      console.log("Sending themes", list);
      socket.to(room).emit("all_themes", list);
    });

    socket.on("get_frames", async (room, theme, movie) => {
      const frames = await cloudinary.api.resources_by_asset_folder(
        `movie-quiz/themes/${theme}/${movie}`
      );

      const framesList = () => {
        return frames.resources.map((frame) => frame.url);
      };
      console.log("Sending frames", framesList());
      socket.to(room).emit("all_frames", framesList());
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
