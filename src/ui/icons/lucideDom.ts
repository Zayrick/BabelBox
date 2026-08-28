import { type IconNode, type SVGProps } from 'lucide';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DEFAULT_ATTRIBUTES: SVGProps = {
  xmlns: SVG_NAMESPACE,
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

type RecursiveIconNode = [tag: string, attributes: SVGProps, children?: RecursiveIconNode[]];

function createSvgNode(ownerDocument: Document, node: RecursiveIconNode): SVGElement {
  const [tag, attributes, children] = node;
  const element = ownerDocument.createElementNS(SVG_NAMESPACE, tag);

  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, String(value));
  }
  for (const child of children ?? []) element.appendChild(createSvgNode(ownerDocument, child));

  return element;
}

/** 为非 Vue 的内容脚本创建与应用界面一致的 Lucide SVG。 */
export function createLucideIconElement(
  icon: IconNode,
  attributes: SVGProps = {},
  ownerDocument: Document = document,
): SVGElement {
  return createSvgNode(ownerDocument, [
    'svg',
    {
      ...DEFAULT_ATTRIBUTES,
      width: '1em',
      height: '1em',
      'aria-hidden': 'true',
      focusable: 'false',
      ...attributes,
    },
    icon as RecursiveIconNode[],
  ]);
}

/** 更新纯 DOM 图标槽；传入 null 时清空当前状态图标。 */
export function replaceLucideIcon(
  container: Element,
  icon: IconNode | null,
  attributes: SVGProps = {},
): void {
  const ownerDocument = container.ownerDocument ?? document;
  container.replaceChildren(...(icon ? [createLucideIconElement(icon, attributes, ownerDocument)] : []));
}
