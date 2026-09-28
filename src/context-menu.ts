export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  separator?: boolean;
  action: () => void | Promise<void>;
}

export type TabCloseScope = 'left' | 'right' | 'others' | 'all' | 'current';

export function tabCloseTargets(ids: number[], targetId: number, scope: TabCloseScope): number[] {
  const index = ids.indexOf(targetId);
  if (index < 0) return [];
  switch (scope) {
    case 'left': return ids.slice(0, index);
    case 'right': return ids.slice(index + 1);
    case 'others': return ids.filter(id => id !== targetId);
    case 'all': return [...ids];
    case 'current': return [targetId];
  }
}

export function spreadsheetText(rows: string[][]): string {
  return rows.map(row => row.map(value => /["\t\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"` : value).join('\t')).join('\r\n');
}
