
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

type Player = {
  id: string;
  name: string;
  score: number;
};

type RoomState = {
  roomCode: string;
  players: Player[];
  hostId: string;
};

type RoomResponse =
  | ({ success: true } & RoomState)
  | { success: false; message: string };

type Stroke = {
  points: { x: number; y: number }[];
  color: string;
  size: number;
  erase: boolean;
};

type GameState = {
  phase: "choosing" | "drawing" | "round-end" | "finished";
  roundNumber: number;
  totalRounds: number;
  drawerId: string | null;
  wordLength?: number;
  endsAt: number | null;
  scores: Player[];
  strokes: Stroke[];
  word?: string;
};

type ChatEntry = {
  id: string;
  kind: "chat" | "system" | "correct";
  playerName: string;
  text: string;
};

type ThemeMode = "system" | "light" | "dark";

function readThemeMode(): ThemeMode {
  try {
    const storedMode = window.localStorage.getItem("drawparty-theme");
    if (storedMode === "light" || storedMode === "dark") return storedMode;
  } catch {
    return "system";
  }
  return "system";
}

function ThemeToggle({
  isDark,
  onToggle,
}: {
  isDark: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <span aria-hidden="true">{isDark ? "☀️" : "🌙"}</span>
      <span className="theme-toggle-label">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

function App() {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [message, setMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState("");
  const [game, setGame] = useState<GameState | null>(null);
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [secretWord, setSecretWord] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [brushColor, setBrushColor] = useState("#7651ef");
  const [brushSize, setBrushSize] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [roundsPerPlayer, setRoundsPerPlayer] = useState(1);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [isDark, setIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const darkMode = themeMode === "system"
        ? systemTheme.matches
        : themeMode === "dark";
      document.documentElement.dataset.theme = darkMode ? "dark" : "light";
      document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
      setIsDark(darkMode);
    };

    applyTheme();
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [themeMode]);

  const handleThemeToggle = () => {
    const nextMode = isDark ? "light" : "dark";
    setThemeMode(nextMode);
    try {
      window.localStorage.setItem("drawparty-theme", nextMode);
    } catch {
      setMessage("Theme changed, but couldn't save your preference in this browser.");
    }
  };

  const appendChatEntry = (entry: ChatEntry) => {
    setChatEntries((entries) => [...entries.slice(-59), entry]);
  };

  useEffect(() => {
    const socket = io(
      import.meta.env.VITE_SERVER_URL || "http://localhost:3001"
    );
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setSocketId(socket.id ?? "");
      setMessage("");
    });
    socket.on("disconnect", () => {
      setIsConnected(false);
      setSocketId("");
      setIsLoading(false);
      setRoom(null);
      setGame(null);
      setMessage("Server connection lost. Please reconnect and join again.");
    });
    socket.on("connect_error", () => {
      setIsConnected(false);
      setMessage("Can't reach the game server. Check that the backend is running.");
    });
    socket.on(
      "players-updated",
      (update: { players: Player[]; hostId: string }) => {
        setRoom((currentRoom) =>
          currentRoom ? { ...currentRoom, ...update } : currentRoom
        );
      }
    );
    socket.on("player-joined", ({ playerName: name }: { playerName: string }) => {
      setLobbyNotice(`${name} joined the room.`);
    });
    socket.on("player-left", ({ playerName: name }: { playerName: string }) => {
      setLobbyNotice(`${name} left the room.`);
    });
    socket.on("game-state", (state: GameState | { phase: "lobby" }) => {
      if (state.phase === "lobby") {
        setGame(null);
        setWordOptions([]);
        setSecretWord("");
        setStrokes([]);
        setChatEntries([]);
        return;
      }

      const nextState = state as GameState;
      setGame(nextState);
      setStrokes(nextState.strokes || []);
      if (nextState.phase === "round-end" && nextState.word) {
        setSecretWord(nextState.word);
        appendChatEntry({
          id: `round-${nextState.roundNumber}`,
          kind: "system",
          playerName: "Round ended",
          text: `The word was ${nextState.word}.`,
        });
      }
    });
    socket.on("word-options", ({ choices }: { choices: string[] }) => {
      setWordOptions(choices);
      setSecretWord("");
      setStrokes([]);
    });
    socket.on("round-choosing", (round: { endsAt: number }) => {
      setSecondsLeft(Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000)));
      setChatEntries([]);
    });
    socket.on("round-start", (round: { endsAt: number }) => {
      setSecondsLeft(Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000)));
      setSecretWord("");
      setWordOptions([]);
      setStrokes([]);
    });
    socket.on("drawer-word", ({ word }: { word: string }) => {
      setSecretWord(word);
    });
    socket.on("timer-update", ({ secondsLeft: time }: { secondsLeft: number }) => {
      setSecondsLeft(time);
    });
    socket.on("drawing-stroke", (stroke: Stroke) => {
      setStrokes((currentStrokes) => [...currentStrokes, stroke]);
    });
    socket.on("canvas-cleared", () => {
      setStrokes([]);
      setDraftStroke(null);
      activeStrokeRef.current = null;
    });
    socket.on(
      "chat-message",
      (entry: { playerId: string; playerName: string; text: string }) => {
        appendChatEntry({
          id: `${Date.now()}-${entry.playerId}`,
          kind: "chat",
          playerName: entry.playerName,
          text: entry.text,
        });
      }
    );
    socket.on(
      "guess-correct",
      (entry: { playerId: string; playerName: string; scores: Player[] }) => {
        appendChatEntry({
          id: `${Date.now()}-${entry.playerId}-correct`,
          kind: "correct",
          playerName: "Nice guess!",
          text: `${entry.playerName} guessed the word!`,
        });
        setRoom((currentRoom) =>
          currentRoom
            ? {
                ...currentRoom,
                players: currentRoom.players.map((player) => ({
                  ...player,
                  score: entry.scores.find((score) => score.id === player.id)?.score ?? player.score,
                })),
              }
            : currentRoom
        );
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const validatePlayerName = () => {
    const name = playerName.trim().slice(0, 20);
    if (!name) {
      setMessage("Please enter your nickname first.");
      return;
    }
    return name;
  };

  const handleCreateRoom = () => {
    const name = validatePlayerName();
    if (!name) return;
    if (!socketRef.current?.connected) {
      setMessage("Can't reach the game server. Please try again in a moment.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    socketRef.current.timeout(5000).emit(
      "create-room",
      { playerName: name },
      (error: Error | null, response: RoomResponse) => {
        setIsLoading(false);
        if (error) {
          setMessage("The server didn't respond. Please try creating the room again.");
          return;
        }
        if (!response.success) {
          setMessage(response.message);
          return;
        }
        setPlayerName(name);
        setRoom({
          roomCode: response.roomCode,
          players: response.players,
          hostId: response.hostId,
        });
        setLobbyNotice("Room created! Invite your friends to join.");
      }
    );
  };

  const handleJoinRoom = () => {
    const name = validatePlayerName();
    if (!name) return;
    const code = roomCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      setMessage("Enter a valid six-character room code.");
      return;
    }
    if (!socketRef.current?.connected) {
      setMessage("Can't reach the game server. Please try again in a moment.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    socketRef.current.timeout(5000).emit(
      "join-room",
      { playerName: name, roomCode: code },
      (error: Error | null, response: RoomResponse) => {
        setIsLoading(false);
        if (error) {
          setMessage("The server didn't respond. Please try joining the room again.");
          return;
        }
        if (!response.success) {
          setMessage(response.message);
          return;
        }
        setPlayerName(name);
        setRoom({
          roomCode: response.roomCode,
          players: response.players,
          hostId: response.hostId,
        });
        setLobbyNotice(`Joined room ${response.roomCode}.`);
      }
    );
  };

  const handleLeaveRoom = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setRoom(null);
      setGame(null);
      return;
    }

    socket.emit("leave-room", () => {
      setRoom(null);
      setGame(null);
      setLobbyNotice("");
      setMessage("");
    });
  };

  const handleCopyRoomCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setLobbyNotice("Room code copied to clipboard!");
    } catch {
      setMessage("Couldn't copy automatically. Select and copy the room code.");
    }
  };

  const emitWithResponse = (
    event: string,
    data: Record<string, unknown> | undefined,
    onSuccess: () => void
  ) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setMessage("Connection lost. Please reconnect before continuing.");
      return;
    }

    socket.timeout(5000).emit(
      event,
      ...(data ? [data] : []),
      (error: Error | null, response: { success: boolean; message?: string }) => {
        if (error) {
          setMessage("The server didn't respond. Please try again.");
          return;
        }
        if (!response.success) {
          setMessage(response.message || "That action couldn't be completed.");
          return;
        }
        setMessage("");
        onSuccess();
      }
    );
  };

  const handleStartGame = () => {
    emitWithResponse(
      "start-game",
      { rounds: roundsPerPlayer },
      () => {
        setMessage("");
        setChatEntries([]);
      }
    );
  };

  const handleChooseWord = (word: string) => {
    emitWithResponse("choose-word", { word }, () => setWordOptions([]));
  };

  const handleSendChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;
    emitWithResponse("chat-message", { text }, () => setChatDraft(""));
  };

  const getCanvasPoint = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!isDrawer || game?.phase !== "drawing") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = {
      points: [getCanvasPoint(event)],
      color: brushColor,
      size: brushSize,
      erase: isEraser,
    };
    activeStrokeRef.current = stroke;
    setDraftStroke(stroke);
  };

  const handleCanvasPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke) return;
    activeStroke.points.push(getCanvasPoint(event));
    setDraftStroke({ ...activeStroke, points: [...activeStroke.points] });
  };

  const handleCanvasPointerUp = () => {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    activeStrokeRef.current = null;
    setDraftStroke(null);
    setStrokes((currentStrokes) => [...currentStrokes, stroke]);
    socketRef.current?.emit("drawing-stroke", stroke);
  };

  const handleClearCanvas = () => {
    emitWithResponse("clear-canvas", undefined, () => setStrokes([]));
  };

  const handleReturnToLobby = () => {
    emitWithResponse("return-to-lobby", undefined, () => setGame(null));
  };

  const isDrawer = game?.drawerId === socketId;

  if (room && game) {
    const scoreList = [...game.scores].sort((a, b) => b.score - a.score);
    const topScore = scoreList[0]?.score ?? 0;
    const winners = scoreList.filter((player) => player.score === topScore);
    const renderedStrokes = draftStroke ? [...strokes, draftStroke] : strokes;

    return (
      <main className="home-page">
        <nav className="navbar">
          <a className="brand" href="/" aria-label="DrawParty home">
            <span className="brand-icon">✏️</span>
            <span>Draw<span className="brand-accent">Party</span></span>
          </a>
          <div className="nav-actions">
            <div className="nav-status">
              <span className="status-dot"></span>
              {isConnected ? "Game in progress" : "Reconnecting..."}
            </div>
            <ThemeToggle isDark={isDark} onToggle={handleThemeToggle} />
          </div>
        </nav>

        <section className="game-page">
          <header className="game-header">
            <div>
              <span className="section-label">ROOM {room.roomCode}</span>
              <h1>
                {game.phase === "finished"
                  ? "Game complete!"
                  : `Round ${game.roundNumber} of ${game.totalRounds}`}
              </h1>
            </div>
            {game.phase !== "finished" && (
              <div className="game-timer" aria-live="polite">
                <span>⏱</span> {secondsLeft}s
              </div>
            )}
          </header>

          {game.phase === "choosing" && (
            <div className="game-prompt" role="status">
              {isDrawer && wordOptions.length > 0 ? (
                <>
                  <strong>Choose a word to draw</strong>
                  <div className="word-options">
                    {wordOptions.map((word) => (
                      <button
                        className="copy-button"
                        type="button"
                        key={word}
                        onClick={() => handleChooseWord(word)}
                      >
                        {word}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <strong>
                  {room.players.find((player) => player.id === game.drawerId)?.name}
                  {" "}is choosing a word...
                </strong>
              )}
            </div>
          )}

          {game.phase === "drawing" && (
            <div className="game-prompt" aria-live="polite">
              {isDrawer ? (
                <strong>Your word: {secretWord || "Loading..."}</strong>
              ) : (
                <strong>
                  {room.players.find((player) => player.id === game.drawerId)?.name}
                  {" "}is drawing · {game.wordLength ?? "?"} letters
                </strong>
              )}
            </div>
          )}

          {game.phase === "round-end" && (
            <div className="game-prompt round-result" role="status">
              <strong>Round over! The word was {game.word || secretWord}.</strong>
            </div>
          )}

          {game.phase === "finished" ? (
            <section className="results-card">
              <span className="results-trophy">🏆</span>
              <h2>
                {winners.length === 1
                  ? `${winners[0].name} wins!`
                  : `It's a tie: ${winners.map((winner) => winner.name).join(" & ")}!`}
              </h2>
              <p>Great game, everyone. Ready for another round?</p>
              <div className="leaderboard">
                {scoreList.map((player, index) => (
                  <div className="leaderboard-row" key={player.id}>
                    <span>{index + 1}.</span>
                    <strong>{player.name}</strong>
                    <span>{player.score} pts</span>
                  </div>
                ))}
              </div>
              {room.hostId === socketId && (
                <div className="results-actions">
                  <button className="primary-button" type="button" onClick={handleStartGame}>
                    Play again <span>→</span>
                  </button>
                  <button className="secondary-button" type="button" onClick={handleReturnToLobby}>
                    Return to lobby
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div className="game-layout">
              <div className="game-main">
                <div className="game-canvas-card">
                  <svg
                    ref={canvasRef}
                    className={`play-canvas${isDrawer && game.phase === "drawing" ? " is-drawable" : ""}`}
                    viewBox="0 0 1000 600"
                    preserveAspectRatio="none"
                    aria-label="Shared drawing canvas"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerCancel={handleCanvasPointerUp}
                  >
                    {renderedStrokes.map((stroke, index) => {
                      const path = stroke.points
                        .map((point, pointIndex) => {
                          const x = point.x * 1000;
                          const y = point.y * 600;
                          return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
                        })
                        .join(" ");
                      return (
                        <path
                          key={`${index}-${path.slice(0, 20)}`}
                          d={path}
                          fill="none"
                          stroke={stroke.erase ? "#ffffff" : stroke.color}
                          strokeWidth={stroke.size}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}
                  </svg>
                </div>

                {isDrawer && game.phase === "drawing" && (
                  <div className="canvas-toolbar">
                    <div className="color-palette" aria-label="Brush colors">
                      {["#7651ef", "#eb5d77", "#2375dc", "#23a87b", "#f0ac34", "#211a36", "#ffffff"].map((color) => (
                        <button
                          className={`color-swatch${brushColor === color && !isEraser ? " selected" : ""}`}
                          type="button"
                          key={color}
                          style={{ backgroundColor: color }}
                          aria-label={`Select ${color} brush`}
                          onClick={() => {
                            setBrushColor(color);
                            setIsEraser(false);
                          }}
                        />
                      ))}
                    </div>
                    <label className="brush-size-label">
                      Brush
                      <input
                        type="range"
                        min="2"
                        max="24"
                        value={brushSize}
                        onChange={(event) => setBrushSize(Number(event.target.value))}
                      />
                    </label>
                    <button
                      className={`tool-button${isEraser ? " active" : ""}`}
                      type="button"
                      onClick={() => setIsEraser((current) => !current)}
                    >
                      Eraser
                    </button>
                    <button className="tool-button" type="button" onClick={handleClearCanvas}>
                      Clear
                    </button>
                  </div>
                )}

                <section className="game-chat-card">
                  <h2>Guesses &amp; chat</h2>
                  <div className="chat-log" aria-live="polite" aria-relevant="additions">
                    {chatEntries.length === 0 ? (
                      <p className="chat-empty">Say hello or guess the word!</p>
                    ) : (
                      chatEntries.map((entry) => (
                        <p className={`chat-entry ${entry.kind}`} key={entry.id}>
                          {entry.kind === "chat" && <strong>{entry.playerName}: </strong>}
                          {entry.kind !== "chat" && <strong>{entry.playerName} </strong>}
                          {entry.text}
                        </p>
                      ))
                    )}
                  </div>
                  <form className="chat-form" onSubmit={handleSendChat}>
                    <input
                      value={chatDraft}
                      maxLength={120}
                      aria-label="Chat message or guess"
                      placeholder={game.phase === "drawing" ? "Type your guess..." : "Write a message..."}
                      onChange={(event) => setChatDraft(event.target.value)}
                      disabled={game.phase === "round-end"}
                    />
                    <button className="primary-button" type="submit" disabled={!chatDraft.trim() || game.phase === "round-end"}>
                      Send
                    </button>
                  </form>
                </section>
              </div>

              <aside className="game-sidebar">
                <section className="lobby-players game-players">
                  <div className="lobby-players-heading">
                    <h2>Players</h2>
                    <span>{room.players.length} / 8</span>
                  </div>
                  <ul className="player-list">
                    {[...room.players]
                      .sort((a, b) => b.score - a.score)
                      .map((player) => (
                        <li className="player-item" key={player.id}>
                          <span className="player-avatar">
                            {player.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="player-name">
                            {player.name}
                            {player.id === game.drawerId && <span className="host-badge">DRAWING</span>}
                          </span>
                          <strong className="player-score">{player.score}</strong>
                        </li>
                      ))}
                  </ul>
                </section>
                {message && <p className="feedback-message game-error" role="alert">{message}</p>}
                <button className="secondary-button leave-button" type="button" onClick={handleLeaveRoom}>
                  Leave game
                </button>
              </aside>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>🎨 DrawParty</span>
          <span>Made for friends, laughs &amp; terrible art.</span>
        </footer>
      </main>
    );
  }

  if (room) {
    return (
      <main className="home-page">
        <nav className="navbar">
          <a className="brand" href="/" aria-label="DrawParty home">
            <span className="brand-icon">✏️</span>
            <span>Draw<span className="brand-accent">Party</span></span>
          </a>
          <div className="nav-actions">
            <div className="nav-status">
              <span className="status-dot"></span>
              {isConnected ? "Connected" : "Reconnecting..."}
            </div>
            <ThemeToggle isDark={isDark} onToggle={handleThemeToggle} />
          </div>
        </nav>

        <section className="lobby">
          <span className="section-label">ROOM LOBBY</span>
          <h1>You're in. Let the fun begin!</h1>
          <p className="lobby-description">
            Share your room code with friends so they can join the game.
          </p>

          <div className="lobby-code-card">
            <div>
              <span className="lobby-overline">YOUR ROOM CODE</span>
              <strong className="lobby-room-code">{room.roomCode}</strong>
            </div>
            <button
              className="copy-button"
              type="button"
              onClick={handleCopyRoomCode}
            >
              Copy code
            </button>
          </div>

          <section className="lobby-players" aria-labelledby="players-title">
            <div className="lobby-players-heading">
              <h2 id="players-title">Players</h2>
              <span>{room.players.length} / 8</span>
            </div>
            <ul className="player-list">
              {room.players.map((player) => (
                <li className="player-item" key={player.id}>
                  <span className="player-avatar" aria-hidden="true">
                    {player.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="player-name">
                    {player.name}
                    {player.id === room.hostId && (
                      <span className="host-badge">HOST</span>
                    )}
                  </span>
                  {player.id === socketId && (
                    <span className="you-badge">YOU</span>
                  )}
                </li>
              ))}
            </ul>
            {room.players.length < 2 && (
              <p className="lobby-empty-state">
                Waiting for friends... Share the room code to fill the lobby.
              </p>
            )}
          </section>

          {room.hostId === socketId && (
            <div className="lobby-start">
              <label htmlFor="round-count">Rounds per player</label>
              <select
                id="round-count"
                value={roundsPerPlayer}
                onChange={(event) => setRoundsPerPlayer(Number(event.target.value))}
              >
                <option value={1}>1 round</option>
                <option value={2}>2 rounds</option>
                <option value={3}>3 rounds</option>
              </select>
              <button
                className="primary-button"
                type="button"
                onClick={handleStartGame}
                disabled={room.players.length < 2 || isLoading}
              >
                Start game <span>→</span>
              </button>
            </div>
          )}

          {lobbyNotice && (
            <p className="lobby-notice" role="status">{lobbyNotice}</p>
          )}
          {message && (
            <p className="feedback-message lobby-error" role="alert">{message}</p>
          )}
          <button
            className="secondary-button leave-button"
            type="button"
            onClick={handleLeaveRoom}
          >
            Leave room
          </button>
        </section>

        <footer className="footer">
          <span>🎨 DrawParty</span>
          <span>Made for friends, laughs &amp; terrible art.</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="home-page">
      <nav className="navbar">
        <a className="brand" href="/" aria-label="DrawParty home">
          <span className="brand-icon">✏️</span>
          <span>Draw<span className="brand-accent">Party</span></span>
        </a>

        <div className="nav-actions">
          <div className="nav-status">
            <span className="status-dot"></span>
            {isConnected ? "Ready to play" : "Connecting to server..."}
          </div>
          <ThemeToggle isDark={isDark} onToggle={handleThemeToggle} />
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span>🎨</span> DRAW · GUESS · REPEAT
          </div>

          <h1>
            Your friends.
            <br />
            Your drawings.
            <br />
            <span>Endless fun.</span>
          </h1>

          <p className="hero-description">
            One draws, everyone guesses! Join your friends for
            a hilarious drawing game where masterpieces are
            optional and bad drawings are legendary.
          </p>

          <div className="hero-features">
            <span>⚡ Real-time play</span>
            <span>👥 Multiplayer fun</span>
            <span>🏆 Friendly competition</span>
          </div>
        </div>

        <div className="preview-area" aria-label="Drawing game preview">
          <div className="floating-note note-one">What is it? 🤔</div>
          <div className="floating-note note-two">I know this! 💡</div>

          <div className="drawing-card">
            <div className="drawing-header">
              <span className="live-pill">
                <span className="status-dot"></span>
                GAME PREVIEW
              </span>
              <span className="preview-timer">⏱ 00:45</span>
            </div>

            <div className="drawing-canvas">
              <span className="canvas-spark spark-one">✦</span>
              <span className="canvas-spark spark-two">✧</span>
              <svg
                className="sample-drawing"
                viewBox="0 0 300 220"
                role="img"
                aria-label="A playful drawing of a cat"
              >
                <path
                  d="M90 95 L83 43 L126 72 Q151 60 175 73 L218 43 L211 101 Q235 144 202 174 Q151 213 100 175 Q68 145 90 95 Z"
                  fill="#FFD166"
                  stroke="#43365D"
                  strokeWidth="6"
                  strokeLinejoin="round"
                />
                <ellipse cx="123" cy="116" rx="7" ry="10" fill="#43365D" />
                <ellipse cx="181" cy="116" rx="7" ry="10" fill="#43365D" />
                <path
                  d="M140 139 Q151 150 163 139 M151 139 L151 130"
                  fill="none"
                  stroke="#43365D"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <path
                  d="M105 139 L66 132 M106 150 L69 157 M195 139 L233 132 M195 150 L232 158"
                  stroke="#43365D"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M116 78 Q130 66 143 79 M163 79 Q178 65 191 79"
                  fill="none"
                  stroke="#FF9B85"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="drawing-caption">A very talented cat 🐱</span>
            </div>

            <div className="drawing-tools">
              <span>🖌️</span>
              <span>🟣</span>
              <span>🔵</span>
              <span>🟢</span>
              <span>🟡</span>
              <span>🔴</span>
            </div>
          </div>
        </div>
      </section>

      <section className="play-section">
        <div className="section-heading">
          <span className="section-label">LET THE FUN BEGIN</span>
          <h2>Ready, set, draw!</h2>
          <p>Pick a nickname and jump into the game.</p>
        </div>

        <div className="play-grid">
          <article className="play-card create-card">
            <div className="card-icon create-icon">🎮</div>
            <h3>Create a room</h3>
            <p>Be the host. Invite your friends and start the fun.</p>

            <label htmlFor="create-nickname">Your nickname</label>
            <input
              id="create-nickname"
              type="text"
              placeholder="e.g. Picasso123"
              maxLength={20}
              value={playerName}
              onChange={(event) => {
                setPlayerName(event.target.value);
                setMessage("");
              }}
            />

            <button
              className="primary-button"
              type="button"
              onClick={handleCreateRoom}
              disabled={isLoading || !isConnected}
            >
              {isLoading ? "Creating room..." : "Create new room"}{" "}
              {!isLoading && <span>→</span>}
            </button>
          </article>

          <article className="play-card join-card">
            <div className="card-icon join-icon">🚀</div>
            <h3>Join a room</h3>
            <p>Already have a room code? Your friends are waiting.</p>

            <label htmlFor="join-nickname">Your nickname</label>
            <input
              id="join-nickname"
              type="text"
              placeholder="Enter your nickname"
              maxLength={20}
              value={playerName}
              onChange={(event) => {
                setPlayerName(event.target.value);
                setMessage("");
              }}
            />

            <label htmlFor="room-code">Room code</label>
            <input
              id="room-code"
              type="text"
              placeholder="e.g. ABC123"
              value={roomCode}
              maxLength={6}
              autoCapitalize="characters"
              onChange={(event) => {
                setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                setMessage("");
              }}
            />

            <button
              className="secondary-button"
              type="button"
              onClick={handleJoinRoom}
              disabled={isLoading || !isConnected}
            >
              {isLoading ? "Joining room..." : "Join game"}{" "}
              {!isLoading && <span>→</span>}
            </button>
          </article>
        </div>

        {message && (
          <div className="feedback-message" role="alert">
            {message}
          </div>
        )}
      </section>

      <footer className="footer">
        <span>🎨 DrawParty</span>
        <span>Made for friends, laughs &amp; terrible art.</span>
      </footer>
    </main>
  );
}

export default App;
