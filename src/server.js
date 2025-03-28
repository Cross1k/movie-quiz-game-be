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
    socket.emit("home_page", socket.id);

    socket.on("create_session", (room) => {
      socket.join(room);

      console.log("Сессия создана:", room);
    });

    socket.on("join_room", (room) => {
      socket.join(room);

      const roomSize = io.sockets.adapter.rooms.get(room).size;
      console.log(roomSize);
      if (roomSize === 5) {
        socket.to(room).emit("broadcast_full_room", room);
      }
      console.log("Игрок подключился к сессии:", room);
    });

    socket.on("get_themes", async () => {
      try {
        const result = await cloudinary.api.sub_folders("movie-quiz/themes");
        socket.emit("themes_list", result.folders);
      } catch (error) {
        console.log(error);
      }
    });

    socket.on("select_theme", async (path, sessionid) => {
      try {
        const result = await cloudinary.api.sub_folders(`${path}`);
        socket.to(sessionid).emit("open_theme", result.folders);
      } catch (error) {
        console.log(error);
      }
    });

    socket.on("give_answer", ({ session, id }) => {
      socket.to(session).emit("broadcast_answer", id);

      console.log(id, session);
    });

    socket.on("good_answer", (session) => {
      socket.to(session).emit("broadcast_good_answer");
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
