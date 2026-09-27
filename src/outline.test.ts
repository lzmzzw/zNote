import { expect, test } from 'vitest';
import { buildOutline, visibleOutline } from './outline';

test('builds hierarchy from heading levels and hides only collapsed descendants', () => {
  const roots = buildOutline([
    { title: 'A', level: 1, from: 0 },
    { title: 'B', level: 3, from: 10 },
    { title: 'C', level: 4, from: 20 },
    { title: 'D', level: 2, from: 30 },
    { title: 'A', level: 1, from: 40 },
  ]);
  expect(roots.map(node => node.title)).toEqual(['A', 'A']);
  expect(roots[0].children.map(node => [node.title, node.depth])).toEqual([['B', 1], ['D', 1]]);
  expect(roots[0].children[0].children[0].title).toBe('C');
  expect(roots[1].key).not.toBe(roots[0].key);
  expect(visibleOutline(roots, new Set([roots[0].children[0].key])).map(node => node.title)).toEqual(['A', 'B', 'D', 'A']);
});
