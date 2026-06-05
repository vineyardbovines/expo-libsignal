import { NativeModule, requireNativeModule } from 'expo';

declare class ExpoLibsignalModule extends NativeModule<{}> {}

export default requireNativeModule<ExpoLibsignalModule>('ExpoLibsignal');
