# Pink Elephant Jungle Runner 2

A playable React + Three.js browser preview of Pink Elephant Jungle Runner.

## Project structure

- `src/App.jsx` — the game component and gameplay logic.
- `src/main.jsx` — browser entrypoint that mounts the game.
- `index.html` — static preview shell with import maps for CDN runtime dependencies.
- `tsconfig.json` — JSX-to-JavaScript preview build configuration.

## Run the playable preview

```bash
npm run start
```

Then open <http://127.0.0.1:5173/>. In hosted workspaces, forward or open port `5173` from the preview/ports panel.

## Build only

```bash
npm run build
```

The build emits ignored preview files into `dist/`.
