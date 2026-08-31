import { beforeEach, describe, expect, it, vi } from "vitest";
import {parseHTML} from "linkedom";
import {
    beginTranslation,
    getTranslationState,
    markTranslationComplete,
    markTranslationError,
    restoreAllTranslations,
    restoreTranslation,
    setRenderedStyleAttribute,
    setTextSlotsApplied,
} from "@/src/features/full-page-translation/content/state";

/**
 * 用最小的 DOM 替身测试状态机，不把 jsdom 引入生产依赖。
 * 这些对象只实现 translationState.ts 真正使用的节点能力。
 */
class FakeElement {
    isConnected = true;
    textContent = "Original text";
    childNodes: object[] = [{ type: "original-child" }];
    classList = { remove: vi.fn() };
    attributes = new Map<string, string>();
    controller?: AbortController;
    ownerDocument?: Document;

    get firstChild(): object | undefined {
        return this.childNodes[0];
    }

    removeChild(child: object): object {
        const index = this.childNodes.indexOf(child);
        if (index >= 0) this.childNodes.splice(index, 1);
        return child;
    }

    appendChild(child: object): object {
        this.childNodes.push(child);
        return child;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    querySelectorAll(): object[] {
        return [];
    }
}

describe("指定节点翻译状态机", () => {
    let node: FakeElement;

    beforeEach(() => {
        node = new FakeElement();
    });

    it("同一个节点在 loading 期间不会重复发起请求", () => {
        const first = beginTranslation(node as unknown as HTMLElement, "single");

        expect(first).not.toBeNull();
        expect(beginTranslation(node as unknown as HTMLElement, "single")).toBeNull();
        expect(getTranslationState(node as unknown as HTMLElement)).toBe(first?.state);
    });

    it("保存候选提取后的精确 source，而不是包含扩展 artifact 的 textContent", () => {
        const attempt = beginTranslation(
            node as unknown as HTMLElement,
            "bilingual",
            "content",
            false,
            "Exact protected-aware source",
            [],
        );

        expect(attempt?.state.sourceText).toBe("Exact protected-aware source");
        expect(attempt?.state.sourceTextNodes).toEqual([]);
    });

    it("synthetic source children 在 spinner 插入前归档到同一代状态", () => {
        const firstSource = {type: "first-source"};
        const secondSource = {type: "second-source"};
        node.childNodes = [firstSource, secondSource];

        const attempt = beginTranslation(
            node as unknown as HTMLElement,
            "bilingual",
            "content",
            true,
        );
        const spinner = {type: "spinner"};
        node.appendChild(spinner);

        expect(attempt?.state.syntheticSourceNodes).toEqual([firstSource, secondSource]);
        expect(attempt?.state.syntheticSourceNodes).not.toContain(spinner);
    });

    it("旧一代请求在重新开始后不再被视为当前请求", () => {
        const first = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(first).not.toBeNull();

        markTranslationError(
            node as unknown as HTMLElement,
            first!.state,
            first!.generation,
        );
        const second = beginTranslation(node as unknown as HTMLElement, "bilingual");

        expect(second?.generation).toBe(first!.generation + 1);
        expect(markTranslationComplete(
            node as unknown as HTMLElement,
            first!.state,
            first!.generation,
        )).toBe(false);
        expect(markTranslationComplete(
            node as unknown as HTMLElement,
            second!.state,
            second!.generation,
        )).toBe(true);
    });

    it("single 在尚未写入译文时恢复，不会断开宿主子节点", () => {
        const originalChild = node.childNodes[0];
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([originalChild]);
        expect(getTranslationState(node as unknown as HTMLElement)).toBeUndefined();
        expect(attempt!.state.controller.signal.aborted).toBe(true);
    });

    it("站点在异步请求期间重渲染时，全局恢复也不覆盖站点的新节点", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "single");
        expect(attempt).not.toBeNull();

        const hostChild = { type: "host-rerendered-child" };
        node.childNodes = [hostChild];
        attempt!.state.phase = "translated";

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.childNodes).toEqual([hostChild]);
        expect(getTranslationState(node as unknown as HTMLElement)).toBeUndefined();
    });

    it("恢复双语翻译时还原插件临时修改的内联样式", () => {
        node.setAttribute("style", "display: -webkit-box; -webkit-line-clamp: 2; max-height: 4px;");
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "display: -webkit-box; -webkit-line-clamp: unset; max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBe("display: -webkit-box; -webkit-line-clamp: 2; max-height: 4px;");
    });

    it("网站在翻译后更新样式时，恢复不会覆盖网站的新值", () => {
        node.setAttribute("style", "max-height: 4px;");
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);
        node.setAttribute("style", "max-height: none;");

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBe("max-height: none;");
    });

    it("原节点没有 style 属性时，恢复会移除插件临时创建的 style", () => {
        const attempt = beginTranslation(node as unknown as HTMLElement, "bilingual");
        expect(attempt).not.toBeNull();

        node.setAttribute("style", "-webkit-line-clamp: unset; max-height: unset;");
        setRenderedStyleAttribute(node as unknown as HTMLElement);

        expect(restoreTranslation(node as unknown as HTMLElement)).toBe(true);
        expect(node.getAttribute("style")).toBeNull();
    });

    it("live text 恢复保留节点身份，并且不覆盖宿主更新后的文本", () => {
        const {document} = parseHTML('<html><body><p id="target">Open <a href="/guide">the guide</a>.</p></body></html>');
        const target = document.querySelector('#target') as HTMLElement;
        const link = target.querySelector('a')!;
        const attempt = beginTranslation(target, 'single');
        expect(attempt).not.toBeNull();
        const originalNodes = attempt!.state.originalTextValues.map(({node: textNode}) => textNode);

        originalNodes[0]!.nodeValue = '打开 ';
        originalNodes[1]!.nodeValue = '指南';
        setTextSlotsApplied(target, [originalNodes[0]!]);
        expect(attempt!.state.translatedTextNodes).toEqual([originalNodes[0]]);
        originalNodes[1]!.nodeValue = 'Host updated link';

        expect(restoreTranslation(target)).toBe(true);
        expect(target.firstChild).toBe(originalNodes[0]);
        expect(target.querySelector('a')).toBe(link);
        expect(originalNodes[0]!.nodeValue).toBe('Open ');
        expect(originalNodes[1]!.nodeValue).toBe('Host updated link');
    });

    it("synthetic segment restore 会解包原文节点", () => {
        const {document} = parseHTML(`
            <html><body><p id="parent">Before <span id="synthetic">inline segment</span> after.</p></body></html>
        `);
        const parent = document.querySelector("#parent") as HTMLElement;
        const synthetic = document.querySelector("#synthetic") as HTMLElement;
        const attempt = beginTranslation(synthetic, "bilingual", "content", true);
        expect(attempt).not.toBeNull();

        expect(restoreTranslation(synthetic)).toBe(true);

        expect(parent.querySelector("#synthetic")).toBeNull();
        expect(parent.textContent).toContain("inline segment");
    });

    it("text-slot 默认记录所有原始文本节点，restoreAllTranslations 可统一清理活跃状态", () => {
        const {document} = parseHTML(`
            <html><body>
                <p id="first">Open <a href="/guide">the guide</a>.</p>
                <p id="second">Another paragraph.</p>
            </body></html>
        `);
        const first = document.querySelector("#first") as HTMLElement;
        const second = document.querySelector("#second") as HTMLElement;
        const firstAttempt = beginTranslation(first, "single")!;
        beginTranslation(second, "bilingual");
        const originalTextNodes = firstAttempt.state.originalTextValues.map(({node: textNode}) => textNode);

        originalTextNodes.forEach((textNode, index) => {
            textNode.nodeValue = `译文 ${index}`;
        });
        setTextSlotsApplied(first);

        expect(firstAttempt.state.translatedTextNodes).toEqual(originalTextNodes);
        expect(firstAttempt.state.translatedTextValues?.get(originalTextNodes[0]!)).toBe("译文 0");

        restoreAllTranslations();

        expect(getTranslationState(first)).toBeUndefined();
        expect(getTranslationState(second)).toBeUndefined();
        expect(first.textContent).toBe("Open the guide.");
    });

    it("恢复时移除插件 class 且不留下空 class 属性", () => {
        const target = new FakeElement();
        target.classList = {
            remove: vi.fn(() => target.setAttribute("class", "")),
        };
        beginTranslation(target as unknown as HTMLElement, "bilingual");
        target.setAttribute("class", "babelbox-bilingual");
        setRenderedStyleAttribute(target as unknown as HTMLElement);
        target.setAttribute("class", "babelbox-bilingual babelbox-failure");

        expect(restoreTranslation(target as unknown as HTMLElement)).toBe(true);
        expect(target.getAttribute("class")).toBeNull();
    });
});
