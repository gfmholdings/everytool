# Without a podspec, expo-modules-autolinking silently skips a local
# module (resolveModuleAsync returns null when no *.podspec is found), and
# the app falls back to private AsyncStorage: clips never reach the
# keyboard, Control Center taps are never routed, and the share/broadcast
# inboxes are never drained. This file is what links the module.
Pod::Spec.new do |s|
  s.name           = 'EverytoolSharedVault'
  s.version        = '1.0.0'
  s.summary        = 'Everytool App Group bridge (vault, inboxes, broadcast picker)'
  s.description    = 'Everytool App Group bridge (vault, inboxes, broadcast picker)'
  s.license        = 'UNLICENSED'
  s.author         = 'Everytool'
  s.homepage       = 'https://github.com/everytool/everytool'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ReplayKit', 'UserNotifications'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
