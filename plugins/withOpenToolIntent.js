// Copies targets/controls/OpenToolIntent.swift into the main app target.
//
// Control Center controls whose intent opens the app (openAppWhenRun)
// must ship that intent in the app too: iOS performs it in the app
// process and finds it through the app's App Intents metadata. Swift in
// a CocoaPods module is NOT scanned for App Intents metadata, so the
// intent has to be a source of the app target itself.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

const FILE = 'OpenToolIntent.swift';

module.exports = function withOpenToolIntent(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const { projectRoot, platformProjectRoot } = cfg.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const src = path.join(projectRoot, 'targets', 'controls', FILE);
    const destDir = path.join(platformProjectRoot, projectName);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, FILE));

    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName,
    });
    const already = project.hasFile(`${projectName}/${FILE}`);
    if (!already) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${projectName}/${FILE}`,
        groupName: projectName,
        project,
        targetUuid: target.uuid,
      });
    }
    return cfg;
  });
};
