import type { ToolId } from '../types';

export interface RoutedShare {
  item: { file: string; kind: 'image' | 'pdf' | 'text'; tool: ToolId };
  uri: string;
}

/** Keep every PDF from the batch, in its original order, for merge. */
export function sharedPdfSources(items: RoutedShare[]): { uri: string; name: string }[] {
  return items.filter(({ item }) => item.kind === 'pdf')
    .map(({ item, uri }) => ({ uri, name: item.file }));
}
