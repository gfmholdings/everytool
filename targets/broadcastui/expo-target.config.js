/** @type {import('@bacons/apple-targets').ConfigFunction} */
module.exports = function (config) {
  return {
    type: 'broadcast-setup-ui',
    name: 'EverytoolBroadcastUI',
    displayName: 'Everytool',
    bundleIdentifier: '.broadcastui',
    deploymentTarget: '17.0',
    frameworks: ['ReplayKit', 'UIKit'],
  };
};
