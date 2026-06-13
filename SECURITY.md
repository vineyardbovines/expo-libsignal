# Security Policy

`expo-libsignal` is a wrapper around [signalapp/libsignal](https://github.com/signalapp/libsignal). Most cryptographic security questions belong with the upstream project.

## Reporting a vulnerability

For vulnerabilities **in this wrapper** (the binding layer, the TypeScript surface, the config plugin, the SQLCipher store implementation when it lands):

- Open a private security advisory on GitHub: `https://github.com/vineyardbovines/expo-libsignal/security/advisories/new`
- Or email `security@<domain>` (replace with the maintainer's email when published).
- Acknowledgement within 72 hours; critical patches within 7 days where feasible.

For vulnerabilities **in libsignal itself** — the Rust crypto code, the Signal Protocol specification — please report directly to Signal: https://signal.org/security/

## Coordinated disclosure

We prefer coordinated disclosure. We will work with you to establish a disclosure timeline that balances user safety against your right to publish your research.

## Supported versions

Only the latest minor version receives security updates while we are pre-1.0.

## Known limitations

- Kyber base-key replay detection (`ReusedBaseKeyException` in upstream
  libsignal stores) is not yet enforced: the stateless native ops cannot see
  base keys from prior decrypts. Tracked for the native fast path (design
  spec 2026-06-12, Section 10). The default SQLCipher store records `used_at`
  for kyber prekeys, but a replayed first message that reuses a base key
  against a last-resort kyber prekey is not rejected on that basis alone.
- The bundled `LibSignalClient` iOS pod 0.94.4 downloads its prebuilt Rust FFI archive from `https://build-artifacts.signal.org/libraries/` at pod install time. The checksum is verified against the value pinned in this library's config plugin (which is in turn copied from Signal's published `.sha256` file on the GitHub release). A network MITM during pod install with an attacker who also controls Signal's GitHub release publishing could theoretically substitute the archive — this risk is shared with anyone consuming LibSignalClient via CocoaPods.
- We track `org.signal:libsignal-android` from Signal's own Maven repo at `https://build-artifacts.signal.org/libraries/maven/`. Same trust assumptions apply.
