import { NativeModule, requireNativeModule } from 'expo';

declare class TmpExpoLibsignalModule extends NativeModule<{}> {}

export default requireNativeModule<TmpExpoLibsignalModule>('TmpExpoLibsignal');
