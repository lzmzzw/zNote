const MAX_SCROLL_EXTENT = 8_000_000;
const columnStarts = new WeakMap<readonly number[], number[]>();

export function rowViewport(count: number, height: number, offset: number, viewport: number, overscan = 5) {
  const extent = Math.min(MAX_SCROLL_EXTENT, count * height);
  const visible = Math.max(1, Math.ceil(viewport / height));
  const first =
    count * height <= MAX_SCROLL_EXTENT
      ? Math.floor(offset / height)
      : Math.floor((Math.max(0, offset) / Math.max(1, extent - viewport)) * Math.max(0, count - visible));
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.min(count, first + visible + overscan);
  return {
    start,
    end,
    first,
    origin: count * height <= MAX_SCROLL_EXTENT ? start * height : offset - (first - start) * height,
    extent,
  };
}

export function columnViewport(count: number, widths: readonly number[], offset: number, viewport: number) {
  const custom = widths.length === count;
  let starts = custom ? columnStarts.get(widths) : undefined;
  if (!starts) {
    starts = [0];
    if (custom) {
      for (const width of widths) starts.push(starts[starts.length - 1] + width);
      columnStarts.set(widths, starts);
    }
  }
  const position = (column: number) => (custom ? starts[column] : column * 160);
  const total = position(count);
  const extent = Math.min(MAX_SCROLL_EXTENT, total);
  const logicalOffset =
    extent === total ? offset : (offset / Math.max(1, extent - viewport)) * Math.max(0, total - viewport);
  function columnAt(value: number) {
    if (!custom) return Math.max(0, Math.min(count, Math.floor(value / 160)));
    let low = 0,
      high = count;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (position(mid) <= value) low = mid;
      else high = mid - 1;
    }
    return low;
  }
  const start = Math.max(0, columnAt(logicalOffset) - 2);
  const end = Math.min(count, columnAt(logicalOffset + viewport) + 3);
  return { start, end, origin: offset - (logicalOffset - position(start)), extent, position };
}

export function rowScrollOffset(row: number, count: number, height: number, viewport: number) {
  const extent = Math.min(MAX_SCROLL_EXTENT, count * height);
  return count * height <= MAX_SCROLL_EXTENT
    ? row * height
    : (row / Math.max(1, count - Math.ceil(viewport / height))) * Math.max(0, extent - viewport);
}
