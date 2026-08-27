/** 从当前元素向上查找第一个匹配 selector 的元素。 */
export function findMatchingElement(element: Element, selector: string): Element | false {
    let current: Element | null = element;
    while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
    }
    return false;
}
