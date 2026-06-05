require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoLibsignal'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '15.0',
    :tvos => '15.0'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/vineyardbovines/expo-libsignal' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'LibSignalClient', '0.94.4'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Propagate LibSignalClient's FFI build variables and linker flag down to any
  # target that depends on us, since upstream's podspec scopes them only to
  # itself. Without this, consumers' OTHER_LDFLAGS expands $(LIBSIGNAL_FFI_LIB_TO_LINK)
  # to an empty string and the final link fails with "Undefined symbol: _signal_*".
  s.user_target_xcconfig = {
    'CARGO_BUILD_TARGET[sdk=iphoneos*]' => 'aarch64-apple-ios',
    'CARGO_BUILD_TARGET[sdk=iphoneos*][arch=arm64e]' => 'arm64e-apple-ios',
    'CARGO_BUILD_TARGET[sdk=iphonesimulator*][arch=*]' => 'x86_64-apple-ios',
    'CARGO_BUILD_TARGET[sdk=iphonesimulator*][arch=arm64]' => 'aarch64-apple-ios-sim',
    'LIBSIGNAL_FFI_TEMP_DIR' => '$(OBJROOT)/Pods.build/libsignal_ffi',
    'LIBSIGNAL_FFI_BUILD_PATH' => 'target/$(CARGO_BUILD_TARGET)/release',
    'LIBSIGNAL_FFI_LIB_TO_LINK' => '$(LIBSIGNAL_FFI_TEMP_DIR)/$(LIBSIGNAL_FFI_BUILD_PATH)/libsignal_ffi.a',
    'OTHER_LDFLAGS' => '$(inherited) $(LIBSIGNAL_FFI_LIB_TO_LINK)'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
