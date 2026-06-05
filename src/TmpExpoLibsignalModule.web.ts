import { registerWebModule, NativeModule } from 'expo';

class TmpExpoLibsignalModule extends NativeModule<{}> {}

export default registerWebModule(TmpExpoLibsignalModule, 'TmpExpoLibsignalModule');
