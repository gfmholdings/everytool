#!/usr/bin/env ruby
# Patch signing settings in the generated ios/*.xcodeproj for manual signing
# with the App Store provisioning profiles created in the Apple portal.
# Run AFTER `expo prebuild` (which generates the ios/ project).
require 'xcodeproj'

TEAM_ID = '8H56KM6SCW'

# Xcode target name => provisioning profile name (App Store Connect profiles)
PROFILES = {
  'Everytool' => 'Everytool App Store',
  'EverytoolKeyboard' => 'Everytool Keyboard App Store',
  'EverytoolShare' => 'Everytool Share App Store',
  'EverytoolControls' => 'Everytool Controls App Store',
  'EverytoolBroadcast' => 'Everytool Broadcast App Store',
  'EverytoolBroadcastUI' => 'Everytool BroadcastUI App Store',
}.freeze

project_path = Dir['ios/*.xcodeproj'].first
abort 'ERROR: no .xcodeproj found under ios/ — did prebuild run?' unless project_path

project = Xcodeproj::Project.open(project_path)
puts "Project targets: #{project.targets.map(&:name).join(', ')}"

found = []
project.targets.each do |target|
  specifier = PROFILES[target.name]
  next unless specifier

  found << target.name
  target.build_configurations.each do |config|
    settings = config.build_settings
    settings['CODE_SIGN_STYLE'] = 'Manual'
    settings['DEVELOPMENT_TEAM'] = TEAM_ID
    settings['PROVISIONING_PROFILE_SPECIFIER'] = specifier
    # Drop SDK-conditional variants so the plain values above always win.
    settings.delete('PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]')
    settings.delete('PROVISIONING_PROFILE[sdk=iphoneos*]')
    next unless config.name == 'Release'

    settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    settings.delete('CODE_SIGN_IDENTITY[sdk=iphoneos*]')
  end
  puts "Patched #{target.name} -> #{specifier}"
end

missing = PROFILES.keys - found
abort "ERROR: targets not found in project: #{missing.join(', ')}" unless missing.empty?

project.save
puts 'Signing patch applied.'
