export type ConversionMenuState = 'enabled' | 'disabled' | 'hidden';

export function nextUntitledName(names: string[]): string {
  const highest = names.reduce((max, name) => Math.max(max, Number(/^未命名(\d+)\./.exec(name)?.[1] ?? 0)), 0);
  return `未命名${highest + 1}.txt`;
}

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
