/**
 * The DOM node members the Turndown rules read. The backend compiles without
 * the DOM lib, so Turndown's `HTMLElement` carries none of them.
 */
export type DomNode = {
  nodeName: string;
  parentNode: DomNode | null;
  previousElementSibling: DomNode | null;
  nextElementSibling: DomNode | null;
  nextSibling: DomNode | null;
  children: ArrayLike<DomNode>;
  getAttribute(name: string): string | null;
};

export function domNode(node: HTMLElement): DomNode {
  return node as unknown as DomNode;
}
