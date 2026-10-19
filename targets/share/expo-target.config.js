/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = function (config) {
  return {
    type: 'share',
    name: 'EverytoolShare',
    displayName: 'Everytool',
    bundleIdentifier: '.share',
    deploymentTarget: '17.0',
    entitlements: {
      'com.apple.security.application-groups': ['group.app.everytool.ios'],
    },
    frameworks: ['UIKit', 'SwiftUI', 'UniformTypeIdentifiers'],
  };
};
