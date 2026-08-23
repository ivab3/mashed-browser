# Contributing

Thanks for your interest in the project. External contributions are accepted through pull
requests from forks; direct pushes to `main` are not part of the contribution workflow.

## Before opening a pull request

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Keep pull requests focused and describe how the change was tested. New binary readers must
validate bounds, sizes, and magic values and should include synthetic tests for malformed input.

## Never upload original game data

Do not commit or attach copyrighted game resources, including BIN/CUE images, executables,
PIZ/RWS archives, models, textures, audio, video, screenshots containing extracted assets, or
the local `game-data/` directory. Metadata, hashes, schemas, and synthetic fixtures are welcome.

Do not include credentials, tokens, private keys, personal save data, or machine-specific
configuration. By submitting a contribution, you confirm that you have the right to contribute
it under the repository's eventual project license.
