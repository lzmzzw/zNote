export type ConversionMenuState = 'enabled' | 'disabled' | 'hidden';

export function displayMenuState(path: string | null): 'enabled' | 'disabled' {
  return path !== null && /\.(md|markdown|json|jsonc|geojson|csv)$/i.test(path) ? 'disabled' : 'enabled';
}

export function conversionMenuState(path: string | null): ConversionMenuState {
  if (path === null || /\.txt$/i.test(path)) return 'enabled';
  if (/\.(md|markdown|json|jsonc|geojson|csv)$/i.test(path)) return 'disabled';
  return 'hidden';
}

export function needsSave(path: string | null, dirty: boolean, requiresSaveAs: boolean): boolean {
  return path === null || dirty || requiresSaveAs;
}
