# DrawParty

DrawParty is a React, TypeScript, Vite, Express, and Socket.IO multiplayer drawing game.

## Run locally on Windows

Open two PowerShell terminals.

In the first terminal, start the backend:

```powershell
cd C:\Users\user\OneDrive\Desktop\skribbl-clone\server
npm.cmd run dev
```

In the second terminal, start the frontend:

```powershell
cd C:\Users\user\OneDrive\Desktop\skribbl-clone\client
npm.cmd run dev
```

Open the Vite URL printed in the second terminal (normally `http://localhost:5173`). The backend health endpoint is `http://localhost:3001`.

To connect the frontend to a backend at another address, set `VITE_SERVER_URL` before starting Vite, for example:

```powershell
$env:VITE_SERVER_URL = "http://localhost:3002"
npm.cmd run dev
```

## Implemented

- Create and join six-character rooms using Socket.IO.
- Live lobby player list, host indicator, room-code copying, and leave-room handling.
- Server-enforced nickname validation, room capacity, host transfer, and empty-room cleanup.
- Host-configurable one-to-three rounds per player, private word choices, and server-controlled timers.
- Mouse/touch drawing with shared strokes, palette, brush size, eraser, and canvas clearing.
- In-game chat and server-side correct-guess detection, with rate limits and no pre-reveal word broadcast.
- Server-managed scoring, leaderboard, tie-aware results, and replay/lobby actions.

The game stores room state in memory; rooms and scores are lost when the backend restarts.
