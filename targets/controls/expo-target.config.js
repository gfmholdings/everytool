/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = function (config) {
  return {
    type: 'widget',
    name: 'EverytoolControls',
    displayName: 'Everytool Controls',
    bundleIdentifier: '.widget',
    icon: '../../assets/icon.png',
    // ControlWidgets (Control Center controls) need iOS 18.
    deploymentTarget: '18.0',
    entitlements: {
      'com.apple.security.application-groups': ['group.app.everytool.ios'],
    },
    frameworks: ['WidgetKit', 'SwiftUI', 'AppIntents'],
  };
};
