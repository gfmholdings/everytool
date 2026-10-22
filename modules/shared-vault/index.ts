import { requireNativeModule } from 'expo-modules-core';

export interface SharedVaultNative {
  readStateJson(groupId: string): string | null;
  writeStateJson(groupId: string, json: string): boolean;
  groupContainerUri(groupId: string): string | null;
  takePendingTool(groupId: string): string | null;
  readGroupString(groupId: string, key: string): string | null;
  writeGroupString(groupId: string, key: string, value: string | null): boolean;
  reloadWidgets(): void;
  recognizeText(uri: string): Promise<{ text: string; x: number; y: number; width: number; height: number }[]>;
  stripLocation(inputUri: string, outputUri: string): boolean;
  imageHasLocation(uri: string): boolean;
  reencodeImage?(
    inputUri: string,
    outputUri: string,
    format: string,
    quality: number,
    maxWidth: number,
    stripMetadata: boolean,
  ): number;
  showBroadcastPicker(extensionBundleId: string): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  /** Sandbox copy of a PDF opened from Files or another app. */
  takeOpenedPdf(sourceUrl: string): { uri: string; name: string } | null;
}

export default requireNativeModule<SharedVaultNative>('EverytoolSharedVault');
