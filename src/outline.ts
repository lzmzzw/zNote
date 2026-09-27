export interface OutlineHeading { title: string; from: number; level: number }
export interface OutlineNode extends OutlineHeading { key: string; depth: number; children: OutlineNode[] }

export function buildOutline(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const siblings = new Map<string, number>();
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = stack.at(-1);
    const parentKey = parent?.key ?? '';
    const identity = `${parentKey}/${heading.level}:${heading.title}`;
    const ordinal = (siblings.get(identity) ?? 0) + 1;
    siblings.set(identity, ordinal);
    const node: OutlineNode = { ...heading, key: `${identity}:${ordinal}`, depth: stack.length, children: [] };
    if (parent) parent.children.push(node); else roots.push(node);
    stack.push(node);
  }
  return roots;
}

export function visibleOutline(nodes: OutlineNode[], collapsed: ReadonlySet<string>): OutlineNode[] {
  const visible: OutlineNode[] = [];
  function visit(node: OutlineNode) {
    visible.push(node);
    if (!collapsed.has(node.key)) node.children.forEach(visit);
  }
  nodes.forEach(visit);
  return visible;
}
