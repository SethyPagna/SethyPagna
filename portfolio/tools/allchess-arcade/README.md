# Current AllChess static arcade adapter

The portfolio export uses AllChess source `9d2b7ff66636a4669c1519f9d337b682832759d1` and this adapter. It supports browser bots and local pass-and-play. Online rooms and accounts use [the current standalone app](https://allchess.pagna.workers.dev/en). Its current engine and artwork are unchanged from this export.

The October 3 portfolio integration updates only the shared full-app URL constant in the compiled shell. The matching adapter source and `BUILD-INFO.json` record this correction and its before/after bundle hashes; the game engine and art are unchanged. JavaScript is served with revalidation to keep the current shell available.

To reproduce the code build, check out that AllChess revision in an isolated folder and copy this directory to its `ops/arcade/`. Keep the source repository's lockfile, run `npm ci`, then `npm run prepare:knowledge`, and build with:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
node node_modules/vite/bin/vite.js build --config ops/arcade/vite.config.ts
```

The result is `dist/arcade/`. Copy complete license notices, Stockfish GPL/source records and asset credits with the export. The portfolio retains its prior optimized GLB derivatives because their model source is unchanged. `play/allchess/BUILD-INFO.json` records source revisions, derivative hashes and final artifact hashes; the marble derivative uses quantized geometry and 1024-pixel textures.

Verify a variant bot reply, a Classic Chess Stockfish reply, a 3D tabletop and subdirectory asset loading before replacing the existing export. Preserve the prior export and raw model sources.
