# Contributing

## Issues

Open an issue before any change beyond a small fix. For security
concerns, see [SECURITY.md](./SECURITY.md).

## Dev setup

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

The example app is in `example/`. To run it on a simulator:

```bash
cd example
bunx expo run:ios       # or run:android
```

Do not run `bun install` inside `example/`. It clobbers the workspace
link to the parent package. Install from the repo root.

## Native changes

Anything under `ios/`, `android/`, or the config plugin must be
verified by on-device smoke on both platforms before merging. The
smoke pattern is in
[example/SMOKE_TEST_LOG.md](./example/SMOKE_TEST_LOG.md). Append a
dated entry for your run.

## Commits and PRs

Conventional commit prefixes (`feat`, `fix`, `chore`, `docs`,
`refactor`, `test`, `ci`). One concern per PR. Squash-merge into
main.

## License

By contributing, you agree your contribution is licensed under AGPL-3.0
(the project license).
