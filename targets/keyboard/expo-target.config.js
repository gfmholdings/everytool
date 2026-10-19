/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = function (config) {
  return {
    type: 'keyboard',
    name: 'EverytoolKeyboard',
    displayName: 'Everytool',
    bundleIdentifier: '.keyboard',
    deploymentTarget: '17.0',
    entitlements: {
      'com.apple.security.application-groups': ['group.app.everytool.ios'],
    },
    frameworks: ['UIKit'],
  };
};
