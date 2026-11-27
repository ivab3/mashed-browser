# Stage 7.1–7.4 — local import, offline play and on-demand loading

Folder and disc import landed on 2026-11-07. Offline delivery followed on 2026-11-28. M3 remains open.

## Player flow

1. Open the game from an HTTP(S) host. In production, no local extractor/server endpoints are required.
2. Click **Import game folder** and select an installed game directory containing `TOASTART` archives,
   or an extractor output directory containing expanded `TOASTART` resources. Alternatively choose
   **Import disc image** and select the matching `.cue` and `.bin` files together.
3. The Worker unpacks the admitted PIZ archives, validates resource contents with production readers,
   and writes the library into IndexedDB. The page shows progress and offers cancellation.
4. Successful import atomically activates the library and reloads the game. Choose a track and car
   from the existing visual catalog, then start a match.
5. On the next visit to the same origin and browser profile, the catalog and assets come from browser
   storage; no directory permission or file selection is needed.

After cancellation, navigation or tab closure, choose the folder or CUE/BIN pair again. Saved payloads are reused
by SHA-256; every selected payload is hashed and parsed again, so same-name changed resources are
not silently mistaken for completed work. The browser does not retain directory access: resumption
requires selecting the source again. The UI reports any unfinished import on startup.

## Implementation and boundaries

- `browser-import.ts` reads only bounded PIZ tables, holds payloads as Blob slices, normalizes paths,
  rejects traversal/case collisions/duplicate installations, and builds the admitted catalog.
- An installed/extracted folder may contain other resources; only the four admitted tracks, 15
  vehicles / 90 intact paints, shared pickup/AI/LED metadata, preview TXD and permanent sound bank
  enter this library. EXEs, unrelated documents, other tracks and movies are ignored.
- Selecting the complete extractor output prefers source archives over their expanded duplicates.
- Course identity and required world/collision/AI/texture/lap files are checked before saving.
  Nonstandard Arctic filenames come from COURSE.LUA. Partial model/texture pairs are rejected.
- The dedicated module Worker uses existing asset/Lua readers; Lua is parsed as data, never executed.
- `mashed-local-content` IndexedDB v1 stores SHA-256-addressed Blobs and separate active/pending
  manifests. Every completed payload and its pending checkpoint share one transaction. Activation
  and clearing the pending marker share one transaction. An error, cancellation or quota failure
  leaves the previous active library intact.
- Web Locks serialize imports across tabs. Unreferenced payloads are reclaimed at the beginning of
  the next import while preserving the active library and resumable payloads. During replacement,
  storage may need room for both the old library and changed payloads.
- Runtime reads individual cached files on demand, using the existing loading Worker and track/car
  catalog. Original bytes are not embedded in the production bundle or uploaded anywhere.
- Development retains `/__mashed` catalog fallback when there is no saved library; production never
  requests it. Settings and championship localStorage records remain independent of content storage.
- Browser eviction/private-mode restrictions may require reimport. Missing saved payloads produce
  an explicit repair message. Changing host, port or browser profile creates a separate library.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm import:validate
pnpm import:validate game-data/expanded/piz
```

The 7.1 suite passed **225 tests**; all workspace typechecks and both production builds passed.
Existing large-chunk warnings remain. New source-free tests cover PIZ bounds/path/collision failures,
archive-versus-expanded selection, incomplete catalog rejection, persistent restore, interrupted
pending state, orphan cleanup and missing-cache repair.

`import:validate` uses the same browser-compatible extraction and validation code with the user's
local data. The installed-directory corpus produced **280 files / 45,356,943 bytes**, four tracks,
15 vehicles and 90 paints, with every imported file passing the production readers. Expanded-only
input also passed: 279 files / 43,027,711 bytes (the separate permanent audio bank is absent).

For reproducible browser Worker acceptance, run `pnpm web` and open
`/test/import-browser.html`. This development-only fixture page reads ignored local archives and
passes File objects into the same production import client. It is not included in the build.

Observed browser acceptance:

- On a fresh production origin, **Import game folder** opened the directory chooser. Selecting
  `game-data/files` ran the production Worker and automatically reloaded the game. Reopening that
  same origin later restored four tracks / 15 cars / 43.3 MiB. This confirms the real folder-input
  path independently of the fixture driver. The immediate automation snapshot after selection was
  stale; checking the completed reload resolved the initial apparent chooser failure.

- Cancellation after five saved payloads left `active: null`, `pending: 5/280`.
- Resume activated all 280 payloads and removed the pending marker.
- Invalid PIZ input was rejected without altering the active 280-file library.
- Reload during a replacement import preserved the active library and a partial pending journal;
  resume completed successfully.
- The dev server was stopped and replaced by a plain static server serving only `apps/web/dist`
  on the same origin. Production restored four tracks / 15 cars / 43.3 MiB from IndexedDB.
- Warzone (136 checkpoints) and Wildfire loaded from browser storage; the Hard CPU completed a full
  physical lap in 55.32 seconds, pause/resume worked, and the console contained no warnings/errors. Server
  requests during this check were only for the application shell/JS/CSS/Worker files, not game data.

Verification limits: browser acceptance above used the in-app Chromium browser. Standalone Chrome
on this machine failed WebGL initialization before the importer ran. Firefox/Safari,
storage-pressure failure and full cross-browser acceptance remain Beta work. Directory selection
uses the standard `webkitdirectory` input.

## Slice 7.2 — browser CUE/BIN import

Implemented and verified on 2026-11-07. Supported input is the reference Fully Loaded Europe
single-track MODE1/2352 image with InstallShield v6 DATA1.HDR / DATA*.CAB. The browser uses no CLI,
external process, or remote extraction service. It reads slices of the user-selected BIN in the
import Worker and expands only admitted archive payloads.

- `disc-reader.ts`: strict CUE pairing, nonzero INDEX 01, validated raw sectors, bounded ISO directory
  traversal, duplicate/cycle/depth checks, both-endian extent validation and bounded random access.
- `installshield.ts`: bounded v6 descriptor/string tables, cabinet identity/index/range checks,
  raw-DEFLATE blocks with output limits, exact expanded size and original per-file MD5 verification.
  `@noble/hashes` provides MD5 for format integrity; SHA-256 remains the library storage identity.
- `disc-import.ts`: maps numbered CAB volumes within the ISO, admits only known PIZ/permanent RWS
  paths, rejects duplicate resources, and reports extraction progress. It never fetches installer
  URLs or runs code from the image. Reader metadata is capped; selected expanded archives are capped
  at 256 MiB in total, 64 MiB per archive, and DEFLATE output at 64 KiB per block.
- `import-client.ts` and the existing Worker share both source modes with the same validation,
  cancellation, atomic publication and cached-resource loading contract.

Disc extraction does not checkpoint raw CAB blocks. After cancellation/tab closure, reselect the
CUE/BIN pair: the disc metadata and selected archives are reread/decompressed, then already saved
resource blobs are reused after content verification. A cancellation during extraction has no new
resource checkpoint yet and leaves the previous active/pending library unchanged.

Unsupported inputs fail explicitly: multiple tracks/BINs, MODE2/audio images, path-based CUE file
references, ISO multi-extent/interleaved files, other InstallShield versions, and selected split,
linked or obfuscated CAB payloads. Generic ISO/ZIP import and all releases of Mashed are not claimed.
Raw-DEFLATE DecompressionStream support is required; unsupported browsers receive a folder-import
fallback message. Firefox/Safari acceptance remains open.

The reference image has a mastering inconsistency: its final manual PDF extends beyond the PVD's
stated volume length while staying within the actual MODE1 track. File extents are therefore bounded
by the physical track; directory metadata remains bounded by the declared volume. The manual is not
selected or read. A synthetic regression covers this behavior without relaxing physical bounds.

### 7.2 verification

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm disc:validate "/path/to/Mashed - Fully Loaded (Europe) (En,Fr,De,Es,It).cue"
```

The full suite passed **237 tests**, including 12 new source-free cases for CUE/sector/ISO/CAB parsing,
unsafe paths, malformed bounds, checksums, output budgets, cancellation, missing volumes and a
complete synthetic CUE → BIN → ISO → CAB chain. All typechecks and both builds passed; only the
existing large-chunk build warnings remain.

The local disc gate used the browser extraction code and compared every extracted archive with
`game-data/files` from the accepted CLI extraction, using SHA-256. All **24 PIZ/RWS archives matched**.
It read **31,429,776 raw BIN bytes** and produced the same **280 resources / 45,356,943 bytes**, four
tracks, 15 vehicles and 90 paints. Every resource then passed the production readers.

Production browser acceptance used a fresh origin served by a plain static HTTP server:

- Selected the actual CUE and BIN via **Import disc image**, completed import and automatic reload.
- Restored the 43.3 MiB library after a separate reload without file reattachment.
- Selected only CUE: actionable missing-pair error; the saved library remained available.
- Loaded Warzone and Wildfire entirely from IndexedDB; the Hard CPU finished all 136 checkpoints
  in 55.32 seconds through normal race rules.
- No console errors or warnings; no requests for original assets to the static server.

The automation's file-transfer duration is not an import benchmark: passing the large BIN through
the browser-control bridge is separate from the application's bounded reads and extraction.

Format references: [unshield file reader](https://github.com/twogood/unshield/blob/main/lib/file.c),
[header layout](https://github.com/twogood/unshield/blob/main/lib/cabfile.h), and
[DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream).
The unshield MIT attribution and noble-hashes license accompany the public build in `licenses/`.

## Slice 7.3 — offline launch and PWA

Open the production build over HTTPS or localhost. Once **Ready to play offline.** appears, close
the browser, disconnect, and open the same URL in the same profile. The browser's install command
can also add a standalone launcher. An existing 7.1 or 7.2 library qualifies on its first visit
to the updated build.

The production build generates a versioned service worker from the final HTML, CSS, JavaScript
(including both Workers and the lazy Rapier runtime), install manifest and icons. Installation
verifies the SHA-256 digest of every file and commits the cache in one batch. An update waits
for tabs using the old build to close before activation and cleanup. Game resources continue to
load from IndexedDB. The development server uses live Vite modules.

### 7.3 verification

- Chrome on macOS, clean profile, production build mounted under `/play/` on a static server.
  A 503 for one required icon prevented offline readiness. Restoring the file and reloading
  completed installation. Chrome reported zero manifest installability errors.
- Importing the reference CUE/BIN through the production file input restored four tracks
  and 15 vehicles after the automatic reload. The shell cache contained nine application files.
- The static server was stopped and Chrome was closed. A new Chrome process using the same
  profile opened `/play/index.html?offlineQA=1` with the network offline and HTTP cache disabled.
  Warzone and Wildfire loaded from browser storage. Starting the race with a mouse click
  let the Hard CPU pass checkpoint 1 of 136 at 21 km/h. No JavaScript exceptions were observed.
- All 237 workspace tests, typechecks and both production builds passed. The browser check used
  headless Chrome with software WebGL. OS launcher installation and Firefox/Safari remain untested.

## Slice 7.4 — on-demand tracks and audio

Opening the catalog reads its shared preview dictionary. Choosing a track reads `COURSE.LUA`
first, then the world, textures, models, explosive-object placements and gameplay files used by
that course. Selecting the active track again reuses it. Switching tracks releases the previous
track's parsed resources and keeps the garage models and textures. Changes of vehicle paint
no longer rebuild the track geometry or collision.

The first race with audible volume reads the optional `PERMDICT.RWS` through the loading Worker.
Starting muted defers that read until sound is enabled. Tracks and subsequent races share one
successful bank load per page session. Web Audio allocates buffers as individual samples are
used and reuses them on resume. A missing or unreadable bank allows play with synthesized audio.
After a read error the next audible start or unmute retries. These changes work with the v1
catalog already in IndexedDB. Import still validates the full library before activation.

### 7.4 verification

On macOS, headless Chrome imported the reference CUE/BIN into a clean profile. A second Chrome
process opened the production build offline with the static server stopped. Instrumenting IndexedDB
blob reads showed one preview dictionary read at startup. The following counts include the course
descriptor and shared gameplay files.

| Selected track | Files listed in v1 catalog | Blobs read on selection | Checkpoints |
| --- | ---: | ---: | ---: |
| City | 41 | 20 | 117 |
| Neustein | 36 | 21 | 72 |
| Arctic | 33 | 19 | 94 |
| Warzone | 68 | 45 | 136 |

Choosing Warzone again added zero reads. Choosing Wildfire added two for the selected paint and
texture dictionary. The Hard CPU passed a Warzone checkpoint with sound muted and the bank unread.
An injected missing bank at unmute kept the race running with synthesized sounds. Restoring the
blob and toggling sound on loaded original samples. A subsequent City race reused the bank.
After a page reload, the first audible race read the bank exactly once. A missing lap file on a
track switch cleared the failed selection. Restoring the file allowed City to load and race again.

All 239 workspace tests, typechecks and both production builds passed. The browser check used
software WebGL and observed Web Audio buffer creation. Listening quality, Firefox/Safari and
hardware frame-time measurements remain unverified.

## Next slices

- Remaining Beta work includes texture and audio compression (KTX2/Basis and Opus), gamepad
  mapping/reconnect, the browser/OS matrix and performance acceptance.

Platform references: [directory inputs](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory)
and [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).
