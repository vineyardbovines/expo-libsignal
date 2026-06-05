import { NativeModule, requireNativeModule } from 'expo'

declare class ExpoLibsignalModule extends NativeModule<Record<string, never>> {}

export default requireNativeModule<ExpoLibsignalModule>('ExpoLibsignal')
