# DrawParty

DrawParty is a real-time multiplayer drawing and guessing game built with React, TypeScript, Vite, Express, and Socket.IO.

## Features

- Create or join six-character game rooms.
- Play in real time with up to eight players per room.
- Draw with a mouse or touch screen, using colors, brush sizes, an eraser, and canvas clearing.
- Take turns drawing private word choices while other players guess in chat.
- Track round timers, scores, and tie-aware game results.
- Use the responsive interface with light, dark, or system-preferred color themes.

## Requirements

- Node.js (LTS recommended)
- npm

## Run locally on Windows

Install dependencies once in each project folder:

```powershell
cd C:\Users\user\OneDrive\Desktop\skribbl-clone\server
npm.cmd install

cd C:\Users\user\OneDrive\Desktop\skribbl-clone\client
npm.cmd install
```

Open two PowerShell terminals to run the game. In the first:

```powershell
cd C:\Users\user\OneDrive\Desktop\skribbl-clone\server
npm.cmd run dev
```

In the second:

```powershell
cd C:\Users\user\OneDrive\Desktop\skribbl-clone\client
npm.cmd run dev
```

Open the Vite URL printed in the client terminal (usually `http://localhost:5173`). The server health endpoint is `http://localhost:3001`.

## Configuration

The server reads `PORT` (default `3001`) and `CLIENT_ORIGIN` (default `http://localhost:5173`) from its environment.

The client uses `VITE_SERVER_URL` to connect to a server at a non-default URL. For example:

```powershell
$env:VITE_SERVER_URL = "http://localhost:3002"
npm.cmd run dev
```

For internet play, use the Render Blueprint below to deploy the frontend and backend with their public URLs connected. The local development addresses are not internet-accessible.

## Deploy to Render

The root `render.yaml` is a Render Blueprint for both services. Push this repository to GitHub, then in Render choose **New → Blueprint**, select the repository, and apply the Blueprint. Render will build the backend and frontend and connect their generated URLs automatically. Open the generated frontend URL to play.

The root `.env.example` documents the local environment variables. Render reads deployment configuration from `render.yaml`; do not commit a real `.env` file or put secrets in the Blueprint. The free backend may take a little time to wake up after inactivity.

## Checks

Run the frontend production build and linter from `client`:

```powershell
npm.cmd run build
npm.cmd run lint
```

Game rooms and scores are held in server memory and are cleared when the backend restarts. This project has not been represented as production-ready.
