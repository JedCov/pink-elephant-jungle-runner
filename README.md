# Pink Elephant Jungle Runner 2
A playable React + Three.js browser preview of Pink Elephant Jungle Runner. The public preview is deployed with GitHub Pages at <https://jedcov.github.io/pink-elephant-jungle-runner2/> after the Pages workflow runs on `main`.
## Project structure
- `src/App.jsx` — the game component and gameplay logic.
- `src/main.jsx` — browser entrypoint that mounts the game.
- `index.html` — static preview shell with relative asset paths that work locally and under the GitHub Pages repository subpath.
- `tsconfig.json` — JSX-to-JavaScript preview build configuration.
- `.github/workflows/deploy-pages.yml` — GitHub Actions workflow that builds and deploys the playable preview to GitHub Pages.
## Run the playable preview
```bash
npm run start
```
Then open <http://127.0.0.1:5173/>. In hosted workspaces, forward or open port `5173` from the preview/ports panel. The same static build is deployed to <https://jedcov.github.io/pink-elephant-jungle-runner2/> when changes land on `main`.
## Build only
```bash
npm run build
```
The build emits ignored preview files into `dist/`.