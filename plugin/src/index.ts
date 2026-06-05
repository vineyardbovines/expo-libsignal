import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import {
  type ConfigPlugin,
  type ExportedConfigWithProps,
  withDangerousMod,
} from 'expo/config-plugins'

/**
 * Pin matches the version we depend on in ios/ExpoLibsignal.podspec.
 * Bump both together — and update the SHA below from
 * https://github.com/signalapp/libsignal/releases/download/v<VERSION>/libsignal-client-ios-build-v<VERSION>.tar.gz.sha256
 */
const LIBSIGNAL_VERSION = '0.94.4'
const LIBSIGNAL_IOS_FFI_SHA256 = '273236d44fdd2eb76f18de0d4229dd82d73ac1edb2e52e71885c6f98843a9c0d'

const PODFILE_MARKER_POD = '# expo-libsignal: LibSignalClient pod'
const PODFILE_MARKER_CHECKSUM = '# expo-libsignal: FFI prebuild checksum'
const PODFILE_MARKER_LDFLAGS = '# expo-libsignal: link FFI into consumer targets'

const checksumLine = (sha: string) =>
  `${PODFILE_MARKER_CHECKSUM}\nENV['LIBSIGNAL_FFI_PREBUILD_CHECKSUM'] = '${sha}'`

const podLine = (version: string) =>
  `${PODFILE_MARKER_POD} (v${version})\n` +
  `pod 'LibSignalClient', :podspec => 'https://raw.githubusercontent.com/signalapp/libsignal/v${version}/LibSignalClient.podspec'`

/**
 * Ruby snippet spliced into the user's existing `post_install` block.
 *
 * Signal's LibSignalClient.podspec sets OTHER_LDFLAGS only on its own pod
 * target, not on consumers' user_target_xcconfig. So app targets that depend
 * on LibSignalClient still need `$(LIBSIGNAL_FFI_LIB_TO_LINK)` added to their
 * linker flags or the final link fails with "Undefined symbol: _signal_*".
 *
 * We splice into the existing post_install instead of creating a second one
 * because CocoaPods only invokes the last `post_install` block defined.
 */
const ldflagsHookRuby = `    ${PODFILE_MARKER_LDFLAGS}
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_build_configurations.each do |config_name, _|
        xcconfig_path = aggregate_target.xcconfig_path(config_name)
        next unless File.exist?(xcconfig_path)
        lines = File.read(xcconfig_path).lines
        already_patched = lines.any? { |l| l.include?('LIBSIGNAL_FFI_LIB_TO_LINK') }
        next if already_patched
        ldflags_idx = lines.index { |l| l =~ /^OTHER_LDFLAGS\\s*=/ }
        addition = '$(LIBSIGNAL_FFI_LIB_TO_LINK)'
        if ldflags_idx
          lines[ldflags_idx] = lines[ldflags_idx].chomp + " " + addition + "\\n"
        else
          lines << "OTHER_LDFLAGS = $(inherited) " + addition + "\\n"
        end
        File.write(xcconfig_path, lines.join)
      end
    end
`

function injectChecksum(podfile: string, sha: string): string {
  if (podfile.includes(PODFILE_MARKER_CHECKSUM)) return podfile
  // Insert at the very top, before any other Podfile content. The checksum
  // must be set in ENV before pod install evaluates the LibSignalClient
  // podspec, which reads it via ENV.fetch.
  return `${checksumLine(sha)}\n\n${podfile}`
}

function injectPodLine(podfile: string, version: string): string {
  if (podfile.includes(PODFILE_MARKER_POD)) return podfile
  const insertion = `${podLine(version)}\n\n`
  const targetIdx = podfile.search(/^target\s+/m)
  if (targetIdx === -1) return `${podfile.trimEnd()}\n\n${insertion}`
  return `${podfile.slice(0, targetIdx)}${insertion}${podfile.slice(targetIdx)}`
}

function injectLdflagsHook(podfile: string): string {
  if (podfile.includes(PODFILE_MARKER_LDFLAGS)) return podfile

  // Find the existing `post_install do |installer|` block and splice our
  // Ruby logic in just before its closing `end`. Match the innermost block.
  const blockRegex = /post_install\s+do\s*\|([a-zA-Z_]+)\|([\s\S]*?)^\s{2,4}end\s*$/m
  const match = blockRegex.exec(podfile)
  if (!match) {
    // No existing block — append a fresh one. The Podfile may not have one
    // (e.g. minimal templates), in which case adding ours is safe.
    return `${podfile.trimEnd()}\n\npost_install do |installer|\n${ldflagsHookRuby}end\n`
  }

  const installerVar = match[1]
  const hookForBlock = ldflagsHookRuby.replace(/installer/g, installerVar ?? 'installer')
  const blockStart = match.index + match[0].length
  // Insert before the final `end` of the matched block.
  const lastEndIdx = podfile.lastIndexOf('end', blockStart)
  return podfile.slice(0, lastEndIdx) + hookForBlock + podfile.slice(lastEndIdx)
}

const withLibsignalPodfile: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg: ExportedConfigWithProps) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      let podfile = await fs.readFile(podfilePath, 'utf8')
      podfile = injectChecksum(podfile, LIBSIGNAL_IOS_FFI_SHA256)
      podfile = injectPodLine(podfile, LIBSIGNAL_VERSION)
      podfile = injectLdflagsHook(podfile)
      await fs.writeFile(podfilePath, podfile, 'utf8')
      return cfg
    },
  ])

const withExpoLibsignal: ConfigPlugin = (config) => withLibsignalPodfile(config)

export default withExpoLibsignal
