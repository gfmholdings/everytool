// Product constants shared by the app and (mirrored in Swift) the targets.

/** App Group that holds the shared clipboard vault + QR history. The app,
 *  keyboard, share extension and broadcast extension all read this suite. */
export const APP_GROUP_ID = 'group.app.everytool.ios';

/** Deep-link scheme: everytool://tool/<id> opens a tool from Control
 *  Center, the share extension, or the broadcast extension. */
export const SCHEME = 'everytool';

/** Bundle id of the ReplayKit broadcast upload extension (targets/broadcast). */
export const BROADCAST_EXTENSION_ID = 'app.everytool.ios.broadcast';
