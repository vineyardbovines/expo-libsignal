try {
  module.exports = require('./plugin/build')
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    throw new Error(
      'expo-libsignal: plugin/build is missing. Run `bun run prepare` (or `npm run prepare`) ' +
        'in the package root to compile the config plugin before running expo prebuild.',
    )
  }
  throw err
}
