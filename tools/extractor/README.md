# @mashed/extractor

Local-only extractor for a user-owned copy of _Mashed: Fully Loaded_. Original game data is
written below the ignored `game-data/` directory and must not be committed.

## Commands

```bash
pnpm extract --source "/path/to/game.cue" --out ./game-data
pnpm extract --source "/path/to/installed/App_Executables" --out ./game-data
pnpm assets:inspect --manifest ./game-data/manifest.json
```

Disc extraction supports a single MODE1/2352 track, reads ISO 9660 directly, and invokes
`unshield` for the InstallShield CAB set. Directory extraction ignores known mutable runtime
files (`gamesave.bin`, video/controller configuration, and `mashed.log`).

PIZ entries are expanded below `expanded/piz/`. RWS files remain byte-exact and their
top-level RenderWare chunk headers are validated and recorded in the manifest. Every emitted
game file has a size, SHA-256, type, and source chain.

An existing output directory is replaced only when it contains the extractor marker. This
keeps repeated runs automatic while preventing accidental deletion of unrelated data.
