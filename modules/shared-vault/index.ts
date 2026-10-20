import { requireNativeModule } from 'expo-modules-core';

export interface SharedVaultNative {
  readStateJson(groupId: string): string | null;
  writeStateJson(groupId: string, json: string): boolean;
  groupContainerUri(groupId: string): string | null;
  takePendingTool(groupId: string): string | null;
  showBroadcastPicker(extensionBundleId: string): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
}

export default requireNativeModule<SharedVaultNative>('EverytoolSharedVault');
