import { registerWebModule, NativeModule } from 'expo';

class ExpoLibsignalModule extends NativeModule<{}> {}

export default registerWebModule(ExpoLibsignalModule, 'ExpoLibsignalModule');
