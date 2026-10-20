/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = function (config) {
  return {
    type: 'broadcast-upload',
    name: 'EverytoolBroadcast',
    displayName: 'Everytool',
    bundleIdentifier: '.broadcast',
    deploymentTarget: '17.0',
    entitlements: {
      'com.apple.security.application-groups': ['group.app.everytool.ios'],
    },
    frameworks: ['ReplayKit', 'CoreImage', 'ImageIO', 'UserNotifications'],
  };
};
