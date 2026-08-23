# Mashed: Fully Loaded — browser revival

Clean-room browser reimplementation of _Mashed: Fully Loaded_. The repository contains only
new code, schemas, documentation, and metadata. Original executable and game assets must come
from a user-owned disc image or installed copy and are always kept below ignored `game-data/`.

The current milestone is **M0: Asset feasibility**. Stage 1 provides a reproducible local
extraction pipeline; the renderer and asset viewer begin in Stage 2.

## Requirements

- Node.js 20 or newer;
- pnpm 9;
- [`unshield`](https://github.com/twogood/unshield) available in `PATH` for `.cue/.bin`
  sources.

## Extract assets

```bash
pnpm install
pnpm extract --source "/path/to/game.cue" --out ./game-data
pnpm assets:inspect --manifest ./game-data/manifest.json
```

An installed directory containing exactly one `MFL.exe` can be used instead of a CUE. See
[`tools/extractor/README.md`](./tools/extractor/README.md) for output layout and safety rules.

## Verify the workspace

```bash
pnpm typecheck
pnpm test
```

Project direction, gates, and scope live in [`ROADMAP.md`](./ROADMAP.md). Reference-build
metadata and acceptance scenarios live in [`REFERENCE.md`](./REFERENCE.md).
