// Jest mock for 'expo' — provides a no-op requireNativeModule so unit tests
// that import TS wrappers don't need a real native runtime.
module.exports = {
  requireNativeModule: () => ({}),
}
