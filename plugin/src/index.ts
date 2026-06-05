import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import {
  type ConfigPlugin,
  type ExportedConfigWithProps,
  withDangerousMod,
} from 'expo/config-plugins'

/**
 * Pin matches the version we depend on in ios/ExpoLibsignal.podspec.
 * Bump both together.
 */
const LIBSIGNAL_VERSION = '0.94.4'
const PODFILE_MARKER = '# expo-libsignal: LibSignalClient'

const podLine = (version: string) =>
  `${PODFILE_MARKER} (v${version})\n` +
  `pod 'LibSignalClient', :podspec => 'https://raw.githubusercontent.com/signalapp/libsignal/v${version}/LibSignalClient.podspec'`

const withLibsignalPodfile: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg: ExportedConfigWithProps) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile')
      const original = await fs.readFile(podfilePath, 'utf8')
      if (original.includes(PODFILE_MARKER)) {
        return cfg
      }
      // Inject just before the first `target` line so it lives in the workspace scope
      // available to every consuming target.
      const insertion = `${podLine(LIBSIGNAL_VERSION)}\n\n`
      const targetIdx = original.search(/^target\s+/m)
      const next =
        targetIdx === -1
          ? `${original.trimEnd()}\n\n${insertion}`
          : `${original.slice(0, targetIdx)}${insertion}${original.slice(targetIdx)}`
      await fs.writeFile(podfilePath, next, 'utf8')
      return cfg
    },
  ])

const withExpoLibsignal: ConfigPlugin = (config) => withLibsignalPodfile(config)

export default withExpoLibsignal
