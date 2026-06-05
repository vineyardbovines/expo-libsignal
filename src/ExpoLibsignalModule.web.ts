import { NativeModule, registerWebModule } from 'expo'

class ExpoLibsignalModule extends NativeModule<Record<string, never>> {}

export default registerWebModule(ExpoLibsignalModule, 'ExpoLibsignalModule')
