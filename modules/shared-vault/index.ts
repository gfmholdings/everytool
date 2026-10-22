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
  /** VisionKit document camera. Empty array means the user cancelled. */
  scanDocuments(): Promise<string[]>;
  /** DataScanner live text. False on devices that cannot run it. */
  liveTextSupported(): boolean;
  /** Live text boxes, same shape as recognizeText. Empty array means cancel. */
  scanLiveText(): Promise<{ text: string; x: number; y: number; width: number; height: number }[]>;
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
  /**
   * Raw 8-bit sRGB RGBA frames (width × height × 4, top-left, straight
   * alpha). `timesMs` are milliseconds. Absent on binaries built before
   * this function existed.
   */
  sampleVideoFrames?(
    videoUri: string,
    timesMs: number[],
    maxWidth: number,
  ): Promise<{ uri: string; width: number; height: number; timeMs: number }[]>;
}

export default requireNativeModule<SharedVaultNative>('EverytoolSharedVault');
