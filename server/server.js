const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT) || 3001;
const configuredOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const allowedOrigin = /^https?:\/\//i.test(configuredOrigin)
  ? configuredOrigin
  : `https://${configuredOrigin}`;

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

const io = new Server(server, {
  maxHttpBufferSize: 64 * 1024,
  cors: {
    origin: allowedOrigin,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();
const MAX_PLAYERS = 8;
const ROUND_SECONDS = 60;
const WORD_CHOICES = 3;
const WORDS = [
  "rainbow", "guitar", "volcano", "penguin", "pizza", "spaceship",
  "turtle", "crown", "waterfall", "robot", "pineapple", "castle",
  "helicopter", "butterfly", "popcorn", "lighthouse", "snowman",
  "octopus", "treasure", "toothbrush", "cactus", "fireworks",
  "basketball", "dinosaur", "pancake", "umbrella", "submarine",
  "dragon", "camera", "watermelon",
];

function generateRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += characters[Math.floor(Math.random() * characters.length)];
    }

    if (!rooms.has(code)) return code;
  }

  throw new Error("Unable to generate a unique room code.");
}

function getRoomUpdate(room) {
  return {
    players: room.players,
    hostId: room.hostId,
  };
}

function getScores(room) {
  return room.players.map(({ id, name, score }) => ({ id, name, score }));
}

function clearGameTimers(game) {
  if (game.timer) clearInterval(game.timer);
  if (game.nextTimer) clearTimeout(game.nextTimer);
  game.timer = null;
  game.nextTimer = null;
}

function getPublicGameState(room) {
  const game = room.game;
  const state = {
    phase: game.phase,
    roundNumber: Math.min(game.roundIndex + 1, game.totalRounds),
    totalRounds: game.totalRounds,
    drawerId: game.drawerId,
    wordLength: game.phase === "drawing" ? game.word.length : undefined,
    endsAt: game.endsAt,
    scores: getScores(room),
    strokes: game.strokes,
  };

  if (game.phase === "round-end") state.word = game.word;
  return state;
}

function emitGameState(roomCode, room) {
  io.to(roomCode).emit("game-state", getPublicGameState(room));
}

function endGame(roomCode, room) {
  clearGameTimers(room.game);
  room.game.phase = "finished";
  room.game.endsAt = null;
  room.game.drawerId = null;
  emitGameState(roomCode, room);
}

function finishRound(roomCode, room, awardDrawer = true) {
  const game = room.game;
  if (game.phase !== "drawing") return;

  clearGameTimers(game);
  if (awardDrawer) {
    const drawer = room.players.find((player) => player.id === game.drawerId);
    if (drawer) drawer.score += 25;
  }

  game.phase = "round-end";
  game.endsAt = null;
  emitGameState(roomCode, room);
  io.to(roomCode).emit("players-updated", getRoomUpdate(room));

  game.nextTimer = setTimeout(() => {
    if (rooms.get(roomCode) !== room) return;
    game.roundIndex += 1;
    startTurn(roomCode, room);
  }, 4000);
}

function startDrawing(roomCode, room, word) {
  const game = room.game;
  clearGameTimers(game);
  game.phase = "drawing";
  game.word = word;
  game.strokes = [];
  game.guessed = new Set();
  game.endsAt = Date.now() + ROUND_SECONDS * 1000;

  io.to(roomCode).emit("canvas-cleared");
  io.to(roomCode).emit("round-start", {
    drawerId: game.drawerId,
    wordLength: word.length,
    roundNumber: game.roundIndex + 1,
    totalRounds: game.totalRounds,
    endsAt: game.endsAt,
    scores: getScores(room),
  });
  io.to(game.drawerId).emit("drawer-word", { word });
  emitGameState(roomCode, room);

  game.timer = setInterval(() => {
    if (rooms.get(roomCode) !== room || game.phase !== "drawing") {
      clearGameTimers(game);
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
    io.to(roomCode).emit("timer-update", { secondsLeft });
    if (secondsLeft === 0) finishRound(roomCode, room);
  }, 1000);
}

function startTurn(roomCode, room) {
  const game = room.game;
  const activePlayers = game.playerOrder.filter((id) =>
    room.players.some((player) => player.id === id)
  );

  if (activePlayers.length < 2) {
    clearGameTimers(game);
    game.phase = "lobby";
    game.drawerId = null;
    game.endsAt = null;
    emitGameState(roomCode, room);
    return;
  }

  if (game.roundIndex >= game.totalRounds) {
    endGame(roomCode, room);
    return;
  }

  game.drawerId = activePlayers[game.roundIndex % activePlayers.length];
  game.phase = "choosing";
  game.word = "";
  game.strokes = [];
  game.endsAt = Date.now() + 15000;
  const choices = [...WORDS]
    .sort(() => Math.random() - 0.5)
    .slice(0, WORD_CHOICES);
  game.choices = choices;

  io.to(roomCode).emit("canvas-cleared");
  io.to(roomCode).emit("round-choosing", {
    drawerId: game.drawerId,
    roundNumber: game.roundIndex + 1,
    totalRounds: game.totalRounds,
    endsAt: game.endsAt,
    scores: getScores(room),
  });
  io.to(game.drawerId).emit("word-options", { choices });
  emitGameState(roomCode, room);

  game.timer = setInterval(() => {
    if (rooms.get(roomCode) !== room || game.phase !== "choosing") {
      clearGameTimers(game);
      return;
    }

    const secondsLeft = Math.max(0, Math.ceil((game.endsAt - Date.now()) / 1000));
    io.to(roomCode).emit("timer-update", { secondsLeft });
    if (secondsLeft === 0) startDrawing(roomCode, room, choices[0]);
  }, 1000);
}

function removePlayerFromRoom(socket) {
  const roomCode = socket.data.roomCode;
  if (!roomCode) return;

  const playerName = socket.data.playerName;
  const room = rooms.get(roomCode);
  socket.leave(roomCode);
  delete socket.data.roomCode;
  delete socket.data.playerName;

  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);

  if (room.players.length === 0) {
    if (room.game) clearGameTimers(room.game);
    rooms.delete(roomCode);
    console.log(`Room ${roomCode} closed (empty).`);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
  }

  io.to(roomCode).emit("players-updated", getRoomUpdate(room));
  io.to(roomCode).emit("player-left", { playerName });

  if (
    room.game &&
    room.players.length < 2 &&
    room.game.phase !== "lobby" &&
    room.game.phase !== "finished"
  ) {
    clearGameTimers(room.game);
    room.game.phase = "lobby";
    room.game.drawerId = null;
    room.game.endsAt = null;
    emitGameState(roomCode, room);
  } else if (
    room.game &&
    room.game.phase !== "lobby" &&
    room.game.phase !== "finished"
  ) {
    if (room.game.drawerId === socket.id) {
      if (room.game.phase === "drawing") {
        finishRound(roomCode, room, false);
      } else {
        clearGameTimers(room.game);
        room.game.roundIndex += 1;
        startTurn(roomCode, room);
      }
    } else if (room.game.phase === "drawing") {
      const activeGuessers = room.players.filter(
        (player) => player.id !== room.game.drawerId
      );
      if (
        activeGuessers.length > 0 &&
        activeGuessers.every((player) => room.game.guessed.has(player.id))
      ) {
        finishRound(roomCode, room);
      }
    }
  }
}

function normalizePlayerName(value) {
  if (typeof value !== "string") return "";
  const playerName = value.trim();
  return playerName.length <= 20 ? playerName : "";
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", (data, callback) => {
    if (typeof callback !== "function") return;

    const playerName = normalizePlayerName(data?.playerName);
    if (!playerName) {
      callback({ success: false, message: "Enter a nickname (up to 20 characters)." });
      return;
    }

    removePlayerFromRoom(socket);

    let roomCode;
    try {
      roomCode = generateRoomCode();
    } catch (error) {
      console.error("Room creation failed:", error);
      callback({
        success: false,
        message: "Couldn't create a room. Please try again.",
      });
      return;
    }

    const player = { id: socket.id, name: playerName, score: 0 };
    const room = { players: [player], hostId: socket.id, game: null };
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    console.log(`${playerName} created room ${roomCode}`);
    callback({ success: true, roomCode, ...getRoomUpdate(room) });
  });

  socket.on("join-room", (data, callback) => {
    if (typeof callback !== "function") return;

    const playerName = normalizePlayerName(data?.playerName);
    const roomCode =
      typeof data?.roomCode === "string"
        ? data.roomCode.trim().toUpperCase()
        : "";

    if (!playerName || !/^[A-Z2-9]{6}$/.test(roomCode)) {
      callback({
        success: false,
        message: "Enter a nickname and a valid six-character room code.",
      });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      callback({
        success: false,
        message: "Room not found. Check the room code and try again.",
      });
      return;
    }

    if (room.game && room.game.phase !== "lobby") {
      callback({
        success: false,
        message: "A game is in progress. Please join after it finishes.",
      });
      return;
    }

    const existingPlayer = room.players.find((player) => player.id === socket.id);
    if (existingPlayer) {
      callback({ success: true, roomCode, ...getRoomUpdate(room) });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      callback({
        success: false,
        message: `Room is full. Maximum ${MAX_PLAYERS} players allowed.`,
      });
      return;
    }

    removePlayerFromRoom(socket);

    const player = { id: socket.id, name: playerName, score: 0 };
    room.players.push(player);
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.playerName = playerName;

    io.to(roomCode).emit("players-updated", getRoomUpdate(room));
    socket.to(roomCode).emit("player-joined", { playerName });
    console.log(`${playerName} joined room ${roomCode}`);

    callback({ success: true, roomCode, ...getRoomUpdate(room) });
  });

  socket.on("start-game", (data, callback) => {
    if (typeof callback !== "function") return;
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.hostId !== socket.id) {
      callback({ success: false, message: "Only the room host can start the game." });
      return;
    }
    if (room.players.length < 2) {
      callback({ success: false, message: "At least two players are needed." });
      return;
    }
    if (room.game && !["lobby", "finished"].includes(room.game.phase)) {
      callback({ success: false, message: "A game is already in progress." });
      return;
    }

    const requestedRounds = Number(data?.rounds);
    const roundsPerPlayer = Number.isInteger(requestedRounds)
      ? Math.min(3, Math.max(1, requestedRounds))
      : 1;

    for (const player of room.players) player.score = 0;
    room.game = {
      phase: "choosing",
      roundIndex: 0,
      totalRounds: roundsPerPlayer * room.players.length,
      playerOrder: room.players.map((player) => player.id),
      drawerId: null,
      word: "",
      choices: [],
      guessed: new Set(),
      strokes: [],
      endsAt: null,
      timer: null,
      nextTimer: null,
    };
    io.to(socket.data.roomCode).emit("players-updated", getRoomUpdate(room));
    startTurn(socket.data.roomCode, room);
    callback({ success: true });
  });

  socket.on("choose-word", (data, callback) => {
    if (typeof callback !== "function") return;
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const game = room?.game;
    const word = typeof data?.word === "string" ? data.word : "";

    if (
      !room ||
      !game ||
      game.phase !== "choosing" ||
      game.drawerId !== socket.id ||
      !game.choices.includes(word)
    ) {
      callback({ success: false, message: "That word choice is not available." });
      return;
    }

    startDrawing(roomCode, room, word);
    callback({ success: true });
  });

  socket.on("drawing-stroke", (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const game = room?.game;
    const now = Date.now();
    const points = data?.points;

    if (
      !room ||
      !game ||
      game.phase !== "drawing" ||
      game.drawerId !== socket.id ||
      !Array.isArray(points) ||
      points.length < 1 ||
      points.length > 80 ||
      game.strokes.length >= 600 ||
      typeof data.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(data.color) ||
      !Number.isFinite(data.size) ||
      data.size < 1 ||
      data.size > 32 ||
      typeof data.erase !== "boolean" ||
      points.some(
        (point) =>
          !point ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.x > 1 ||
          point.y < 0 ||
          point.y > 1
      )
    ) {
      return;
    }

    const recent = socket.data.strokeTimes || [];
    socket.data.strokeTimes = recent.filter((time) => now - time < 1000);
    if (socket.data.strokeTimes.length >= 30) return;
    socket.data.strokeTimes.push(now);

    const stroke = {
      points,
      color: data.color,
      size: data.size,
      erase: data.erase,
    };
    game.strokes.push(stroke);
    socket.to(roomCode).emit("drawing-stroke", stroke);
  });

  socket.on("clear-canvas", (callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const game = room?.game;
    if (!room || !game || game.phase !== "drawing" || game.drawerId !== socket.id) {
      if (typeof callback === "function") {
        callback({ success: false, message: "Only the drawer can clear the canvas." });
      }
      return;
    }

    game.strokes = [];
    io.to(roomCode).emit("canvas-cleared");
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("chat-message", (data, callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    const game = room?.game;
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    if (
      !room ||
      !game ||
      !["choosing", "drawing"].includes(game.phase) ||
      !text ||
      text.length > 120
    ) {
      if (typeof callback === "function") {
        callback({ success: false, message: "Message must be 1–120 characters during a round." });
      }
      return;
    }

    const now = Date.now();
    const recent = socket.data.chatTimes || [];
    socket.data.chatTimes = recent.filter((time) => now - time < 5000);
    if (socket.data.chatTimes.length >= 6) {
      if (typeof callback === "function") {
        callback({ success: false, message: "Slow down before sending another message." });
      }
      return;
    }
    socket.data.chatTimes.push(now);

    if (game.phase === "drawing" && socket.id !== game.drawerId) {
      const guess = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const answer = game.word.toLowerCase().replace(/[^a-z0-9]/g, "");

      if (guess === answer && !game.guessed.has(socket.id)) {
        game.guessed.add(socket.id);
        const player = room.players.find((entry) => entry.id === socket.id);
        if (player) {
          player.score += Math.max(50, Math.round(100 + (game.endsAt - now) / 600));
        }

        io.to(roomCode).emit("guess-correct", {
          playerId: socket.id,
          playerName: socket.data.playerName,
          scores: getScores(room),
        });
        io.to(roomCode).emit("players-updated", getRoomUpdate(room));

        const guessers = room.players.filter((entry) => entry.id !== game.drawerId);
        if (guessers.length > 0 && guessers.every((entry) => game.guessed.has(entry.id))) {
          finishRound(roomCode, room);
        }
        if (typeof callback === "function") callback({ success: true, correct: true });
        return;
      }

      if (game.guessed.has(socket.id)) {
        if (typeof callback === "function") {
          callback({ success: false, message: "You already guessed correctly this round." });
        }
        return;
      }
    }

    io.to(roomCode).emit("chat-message", {
      playerId: socket.id,
      playerName: socket.data.playerName,
      text,
      timestamp: now,
    });
    if (typeof callback === "function") callback({ success: true, correct: false });
  });

  socket.on("return-to-lobby", (callback) => {
    const roomCode = socket.data.roomCode;
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id || room.game?.phase !== "finished") {
      if (typeof callback === "function") {
        callback({ success: false, message: "Only the host can return to the lobby after the game." });
      }
      return;
    }

    clearGameTimers(room.game);
    room.game = null;
    for (const player of room.players) player.score = 0;
    io.to(roomCode).emit("players-updated", getRoomUpdate(room));
    io.to(roomCode).emit("game-state", { phase: "lobby" });
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("leave-room", (callback) => {
    removePlayerFromRoom(socket);
    if (typeof callback === "function") callback({ success: true });
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket);
    console.log("Player disconnected:", socket.id);
  });
});

app.get("/", (_request, response) => {
  response.send("DrawParty server is running!");
});

server.listen(port, () => {
  console.log(`DrawParty server running at http://localhost:${port}`);
});
