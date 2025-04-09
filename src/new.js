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

const games = {};
const movies = {};
const selectedTheme = {};
const selectedMovie = {};

const getThemesAndMovies = async (room) => {
  if (!room) {
    console.error("getThemesAndMovies: room is null or undefined");
    return;
  }

  try {
    console.log("Themes and movies requested");

    const themesResult = await cloudinary.api.sub_folders("movie-quiz/themes");
    movies[room] = { themes: {} };
    if (!themesResult || !themesResult.folders) {
      console.error("getThemesAndMovies: themesResult is null or undefined");
      return;
    }

    for (const theme of themesResult.folders) {
      if (!theme || !theme.name) {
        console.error("getThemesAndMovies: theme is null or undefined");
        continue;
      }

      movies[room].themes[theme.name] = {
        movies: (
          await cloudinary.api.sub_folders(`movie-quiz/themes/${theme.name}`)
        ).folders.map((movie, index) => ({
          index,
          name: movie.name,
          guessed: false,
          whoGuessed: null,
        })),
      };
    }
    console.log("Themes and movies received:", movies[room].themes);
  } catch (error) {
    console.error("Error when requesting themes and movies:", error);
  }
};

export const setupServer = () => {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "https://movie-quiz-psi.vercel.app" },
    // cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("New connection:", socket.id);

    socket.on("create_session", (room) => {
      //
      games[room] = {
        host: { socketId: null },
        players: [
          { socketId: null, points: 0, name: "Черепашки", logo: "🐢" },
          { socketId: null, points: 0, name: "Черепушки", logo: "💀" },
          { socketId: null, points: 0, name: "Черемушки", logo: "🍇" },
        ],
        game: { socketId: null },
        isRoundStarted: false,
        whoAnswering: null,
      };
      console.log("Session created:", room);
    });

    socket.on(
      "player_join_room",
      (room, playerName, playerId, playerSocket) => {
        if (!games[room]) return;
        const player = games[room].players.find(
          (player) => player.name === playerName
        );
        if (player.socketId !== playerSocket) {
          player.socketId = playerSocket;
          console.log("Player joined", player);
          socket.join(room);
          socket.emit("player_joined");
        }
        console.log("set QR disabled and emit points");
        io.to(room).emit("check_player", playerId);
        io.to(player.socketId).emit("your_points", player.points);
      }
    );

    socket.on("host_join_room", (room, hostSocket) => {
      if (!games[room]) return;
      let host = games[room].host;
      if (host.socketId === null) {
        host = { socketId: hostSocket };
        console.log("Host joined", host);
        socket.join(room);
      } else if (host.socketId !== hostSocket) {
        host.socketId = hostSocket;
        console.log("Host changed and joined", host);
        socket.join(room);
      }
      io.to(room).emit("check_host", games[room].players);
    });

    socket.on("game_join_room", (room, gameSocket) => {
      if (!games[room]) return;
      let game = games[room].game;
      if (game.socketId === null) {
        game = { socketId: gameSocket };
        console.log("Game page joined", game);
        socket.join(room);
      } else if (game.socketId !== gameSocket) {
        game.socketId = gameSocket;
        console.log("Game page changed and joined", game);
        socket.join(room);
      }

      io.to(gameSocket).emit("all_points", games[room].players);
      console.log(games[room].players);
    });

    socket.on("start_game", async (room) => {
      if (!games[room]) return;
      console.log("Game started", room);
      socket.broadcast.to(room).emit("start_game", room);
    });

    socket.on("round_request", (room) => {
      if (!games[room]) return;
      socket.emit("is_started", games[room].isRoundStarted);
    });

    socket.on("who_answer", (room) => {
      if (!games[room]) return;
      socket.emit("who_answer", games[room].whoAnswering);
    });

    socket.on("start_round", (room) => {
      console.log("Round started");
      socket.broadcast.to(room).emit("start_round");
      games[room].isRoundStarted = true;
    });

    socket.on("round_end", (room) => {
      console.log("Round ended");
      socket.broadcast.to(room).emit("round_end");
      games[room].isRoundStarted = false;
    });

    socket.on("player_answer", (room, playerName) => {
      console.log(`Player ${playerName} answering...`);

      games[room].whoAnswering = playerName;

      io.emit("player_answer", playerName);
    });

    socket.on("answer_yes", (room, playerName) => {
      console.log("Answer yes");
      const chosenMovie = Object.values(
        movies[room].themes[selectedTheme[room]].movies
      ).find((m) => m.name === selectedMovie[room]);
      const playerLogo = games[room].players.find((p) => p.name === playerName);
      chosenMovie.guessed = true;
      chosenMovie.whoGuessed = playerLogo.logo;
      games[room].whoAnswering = null;
      games[room].isRoundStarted = false;
      io.emit("answer_yes", playerName);
      socket.broadcast.to(room).emit("get_points", playerName);
    });

    socket.on("player_points", (room, playerName, pts, gameId) => {
      console.log(room, playerName, pts, gameId);
      const player = games[room].players.find(
        (player) => player.name === playerName
      );
      player.points += pts;

      io.to(gameId).emit("all_points", games[room].players);
      io.to(player.socketId).emit("your_points", player.points);
      console.log(games[room].players);
    });

    socket.on("answer_no", (room) => {
      console.log("Answer no");
      io.emit("answer_no");
    });

    socket.on("get_themes", async (room) => {
      if (!games[room]) return;
      try {
        await getThemesAndMovies(room);
      } catch (err) {
        console.log(err.message);
      } finally {
        const themeList = Object.keys(movies[room].themes);
        const moviesTheme = movies[room].themes;

        const list = {};
        for (const theme of themeList) {
          list[theme] = { movies: [...moviesTheme[theme].movies] };
        }

        io.to(room).emit("all_themes", list);
      }
    });

    socket.on("get_frames", async (room, theme, movie) => {
      const frames = await cloudinary.api.resources_by_asset_folder(
        `movie-quiz/themes/${theme}/${movie}`
      );

      selectedTheme[room] = theme;
      selectedMovie[room] = movie;

      const framesList = () => frames.resources.map((frame) => frame.url);
      io.to(room).emit("all_frames", framesList(), movie);
    });

    socket.on("change_frame", (gamePage) => {
      console.log("Change frame");
      socket.to(gamePage).emit("change_frame");
    });

    socket.on("end_game", async (room) => {
      const maxPoints = Math.max(
        ...games[room].players.map((player) => player.points)
      );

      const winners = games[room].players.filter(
        (player) => player.points === maxPoints
      );

      let result;
      if (winners.length > 1) {
        result = "Ничья";
        console.log("winners: Ничья", "max points", maxPoints);
        io.emit("end_game", result, maxPoints);
      } else {
        result = winners[0].name;
        console.log("winner:", result, "max points", maxPoints);
        io.emit("end_game", result, maxPoints);
      }

      setTimeout(() => {
        console.log("game deleted", room);
        delete games[room];
        delete movies[room];
      }, 6000);
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
    console.error("Error:", err.message);
    res
      .status(500)
      .json({ message: "Something went wrong", error: err.message });
  });

  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
};
