# expo-libsignal example app

Three-persona smoke test for the SignalClient facade. See `SMOKE_TEST_LOG.md` for the
verified iOS/Android runs.

## Running

Install **from the package root**, not here:

```sh
cd ..
bun install
bun run prepare    # compiles the config plugin to plugin/build
cd example
bun run ios        # or: bun run android
```

## Footgun: do not `bun install` inside `example/`

The example depends on the parent via `expo-libsignal: file:..`. Running `bun install`
(or `npm install`) inside this directory replaces the symlink with a copy and breaks
the next `expo prebuild`. If the link gets clobbered, repair it:

```sh
rm -rf node_modules/expo-libsignal
ln -s ../.. node_modules/expo-libsignal
```

Root-level `bun install` handles the link correctly via the workspace setup.
