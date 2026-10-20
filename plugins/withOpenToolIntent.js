// Copies the App Intents sources into the main app target:
// targets/controls/OpenToolIntent.swift and ios-app/EverytoolIntents.swift.
//
// Control Center controls whose intent opens the app (openAppWhenRun)
// must ship that intent in the app too: iOS performs it in the app
// process and finds it through the app's App Intents metadata. Swift in
// a CocoaPods module is NOT scanned for App Intents metadata, so the
// intent has to be a source of the app target itself.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

// [source (relative to the project root), file name in the app target]
const FILES = [
  ['targets/controls/OpenToolIntent.swift', 'OpenToolIntent.swift'],
  // Siri & Shortcuts actions + AppShortcutsProvider
  ['ios-app/EverytoolIntents.swift', 'EverytoolIntents.swift'],
];

module.exports = function withOpenToolIntent(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const { projectRoot, platformProjectRoot } = cfg.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const destDir = path.join(platformProjectRoot, projectName);
    fs.mkdirSync(destDir, { recursive: true });
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName,
    });
    for (const [from, name] of FILES) {
      fs.copyFileSync(path.join(projectRoot, from), path.join(destDir, name));
      if (!project.hasFile(`${projectName}/${name}`)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
          filepath: `${projectName}/${name}`,
          groupName: projectName,
          project,
          targetUuid: target.uuid,
        });
      }
    }
    return cfg;
  });
};
