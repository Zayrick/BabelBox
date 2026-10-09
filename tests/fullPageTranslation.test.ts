import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseHTML} from "linkedom";

/**
 * 全文/悬浮翻译的行为测试。使用真实候选核心、真实节点状态和 linkedom 的
 * 真实 MutationObserver，插件自己的 DOM 写入与宿主写入都会按浏览器语义
 * 产生 mutation；只替换网络、视口和扩展消息边界。
 */
const env = vi.hoisted(() => ({
    translate: vi.fn(async (origins: readonly string[]) => origins.map((origin) => `译:${origin}`)),
    config: {
        service: "microsoft",
        display: 0,
        to: "zh",
        fullPageTranslationMode: "all" as "all" | "viewport",
        style: 0,
        animationMode: "default",
        useCache: false,
    },
}));

vi.mock("wxt/browser", () => ({browser: {runtime: {sendMessage: async () => undefined}}}));
vi.mock("@/src/features/full-page-translation/content/configCheck", () => ({checkConfig: () => true}));
vi.mock("@/src/services/config/store", () => ({config: env.config}));
vi.mock("@/src/core/language/detect", () => ({detectlang: () => ""}));
vi.mock("@/src/features/page-notice/public", () => ({sendErrorMessage: () => undefined}));
vi.mock("@/src/services/translation/client", () => ({
    translateText: async (origin: string) => (await env.translate([origin]))[0],
    translateTextBatch: (origins: readonly string[]) => env.translate(origins),
}));

import {
    autoTranslateEnglishPage,
    handleTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from "@/src/features/full-page-translation/content/runtime";
import {getFullPageTranslationProgress} from "@/src/features/full-page-translation/progress";

const SINGLE = 0;
const BILINGUAL = 1;

class TestIntersectionObserver {
    static last: TestIntersectionObserver | null = null;
    readonly observed = new Set<Element>();
    constructor(private readonly callback: IntersectionObserverCallback) {
        TestIntersectionObserver.last = this;
    }
    observe(target: Element) { this.observed.add(target); }
    unobserve(target: Element) { this.observed.delete(target); }
    disconnect() { this.observed.clear(); }
    enter(target: Element) {
        this.callback([{target, isIntersecting: true} as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

const replaced = new Map<PropertyKey, PropertyDescriptor | undefined>();
function replaceGlobal(name: string, value: unknown): void {
    if (!replaced.has(name)) replaced.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

let window: Window & typeof globalThis;
let document: Document;

function loadPage(body: string): void {
    ({window, document} = parseHTML(`<html><head><title>Fixture</title></head><body>${body}</body></html>`) as never);
    for (const name of ["Node", "Element", "HTMLElement", "Text", "ShadowRoot", "MutationObserver", "CustomEvent"]) {
        replaceGlobal(name, (window as unknown as Record<string, unknown>)[name]);
    }
    replaceGlobal("window", window);
    replaceGlobal("document", document);
    replaceGlobal("location", {href: "https://example.com/article"});
    replaceGlobal("IntersectionObserver", TestIntersectionObserver);
    const ParsedDOMParser = (window as unknown as {DOMParser: typeof DOMParser}).DOMParser;
    replaceGlobal("DOMParser", class {
        parseFromString(source: string, type: DOMParserSupportedType) {
            return new ParsedDOMParser().parseFromString(`<html><body>${source}</body></html>`, type);
        }
    });
    Object.defineProperty(window, "setTimeout", {configurable: true, value: globalThis.setTimeout});
    Object.defineProperty(window, "clearTimeout", {configurable: true, value: globalThis.clearTimeout});
}

/** 宿主框架：观察自己的子树，并在条件满足时改写 DOM。 */
function hostObserver(callback: () => void, options: MutationObserverInit = {childList: true, subtree: true, characterData: true}): void {
    new window.MutationObserver(callback).observe(document.body, options);
}

function countMutations(): () => number {
    let count = 0;
    new window.MutationObserver((records) => { count += records.length; })
        .observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true});
    return () => count;
}

async function settle(ms = 1000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

function requestedSources(): string[] {
    return env.translate.mock.calls.flatMap(([origins]) => [...origins]);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return {promise, resolve};
}

const html = () => document.body.innerHTML;
const translationsShown = () => document.querySelectorAll(".babelbox-bilingual-content").length;

beforeEach(() => {
    vi.useFakeTimers();
    env.translate.mockReset();
    env.translate.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
    env.config.display = SINGLE;
    env.config.fullPageTranslationMode = "all";
    TestIntersectionObserver.last = null;
});

afterEach(() => {
    // 译文永远不能被当成原文再次提交给服务。
    expect(requestedSources().filter((source) => source.includes("译:"))).toEqual([]);
    restoreOriginalContent();
    vi.useRealTimers();
    for (const [name, descriptor] of replaced) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    }
    replaced.clear();
});

describe.each([
    {label: "单语", display: SINGLE},
    {label: "双语", display: BILINGUAL},
])("全文翻译（$label）", ({display}) => {
    beforeEach(() => { env.config.display = display; });

    it("翻译段落、内联片段和控件，恢复后 DOM 与原页面一致", async () => {
        const original = [
            "<p>Plain paragraph with enough english words.</p>",
            "<div>Inline lead with <b>bold words</b> here<p>Block child paragraph text.</p></div>",
            "<p>Click <button>Save changes</button> to persist the settings.</p>",
            '<li><a href="/x">Read the article</a> by someone else</li>',
        ].join("");
        loadPage(original);

        autoTranslateEnglishPage();
        await settle();

        const text = document.body.textContent ?? "";
        expect(text).toContain("译:Plain paragraph with enough english words.");
        expect(text).toContain("译:Block child paragraph text.");
        expect(text).toContain("译:Save changes");
        const requestsAfterTranslation = env.translate.mock.calls.length;

        await settle(3000);
        expect(env.translate).toHaveBeenCalledTimes(requestsAfterTranslation);

        restoreOriginalContent();
        expect(html()).toBe(original);
    });

    it("宿主每次发现外来节点就重置子树时，不会无限重译或闪烁", async () => {
        loadPage('<div id="app"><p>Owned by a strict framework.</p></div>');
        const app = document.querySelector("#app")!;
        hostObserver(() => {
            if (app.querySelector('[data-babelbox-translation-owned], [data-babelbox-translation-segment]') ||
                app.textContent?.includes("译:")) {
                app.innerHTML = "<p>Owned by a strict framework.</p>";
            }
        });
        const mutations = countMutations();

        autoTranslateEnglishPage();
        await settle(2000);
        const churn = mutations();
        await settle(5000);

        expect(env.translate).toHaveBeenCalledTimes(1);
        expect(mutations()).toBe(churn);
        expect(churn).toBeLessThan(40);
    });

    it("宿主同原文重渲染时立即沿用译文，不重新请求", async () => {
        loadPage('<div id="app"><p>Hello stable world text.</p></div>');
        const app = document.querySelector("#app")!;
        autoTranslateEnglishPage();
        await settle();
        expect(env.translate).toHaveBeenCalledTimes(1);

        app.innerHTML = "<p>Hello stable world text.</p>";
        await settle();

        expect(env.translate).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).toContain("译:Hello stable world text.");
    });

    it("宿主改写原文后翻译新内容，在途的旧结果不会写回", async () => {
        loadPage('<p id="message">Original host message.</p>');
        const message = document.querySelector<HTMLElement>("#message")!;
        const first = deferred<string[]>();
        env.translate.mockImplementationOnce(() => first.promise);

        autoTranslateEnglishPage();
        await settle();
        expect(env.translate).toHaveBeenCalledTimes(1);

        message.firstChild!.nodeValue = "Updated host message.";
        await settle();
        first.resolve(["旧译文"]);
        await settle();

        expect(document.body.textContent).not.toContain("旧译文");
        expect(document.body.textContent).toContain("译:Updated host message.");
        restoreOriginalContent();
        expect(message.textContent).toBe("Updated host message.");
    });

    it("祖先新增 translate=no 会撤销译文，临时隐藏保留译文", async () => {
        loadPage('<section id="hidden"><p>Temporarily hidden prose.</p></section><section id="optout"><p>Prose that opts out later.</p></section>');
        autoTranslateEnglishPage();
        await settle();
        expect(document.body.textContent).toContain("译:Temporarily hidden prose.");
        expect(document.body.textContent).toContain("译:Prose that opts out later.");

        document.querySelector("#hidden")!.setAttribute("aria-hidden", "true");
        document.querySelector("#optout")!.setAttribute("translate", "no");
        await settle();

        expect(document.body.textContent).toContain("译:Temporarily hidden prose.");
        expect(document.querySelector("#optout")!.textContent).toBe("Prose that opts out later.");
        expect(env.translate).toHaveBeenCalledTimes(2);
    });
});

describe("宿主与插件争夺同一文本", () => {
    it("宿主持续把原文写回时，有限次重试后让出该段落", async () => {
        loadPage('<p id="label">Counter label text here.</p>');
        const label = document.querySelector("#label")!;
        hostObserver(() => {
            const text = label.firstChild as Text;
            if (text.nodeValue !== "Counter label text here.") text.nodeValue = "Counter label text here.";
        });
        const mutations = countMutations();

        autoTranslateEnglishPage();
        await settle(2000);
        const churn = mutations();
        await settle(5000);

        expect(env.translate).toHaveBeenCalledTimes(1);
        expect(mutations()).toBe(churn);
        expect(churn).toBeLessThan(20);
        expect(label.textContent).toBe("Counter label text here.");
    });

    it("嵌套目标不会把另一个目标的译文当成自己的原文", async () => {
        loadPage('<article id="outer">Outer lead sentence here <span id="inner">inner hovered words</span> outer tail.</article>');
        const inner = document.querySelector<HTMLElement>("#inner")!;
        Object.defineProperty(document, "elementsFromPoint", {configurable: true, value: () => [inner]});

        handleTranslation(1, 1);
        await settle();
        autoTranslateEnglishPage();
        await settle(3000);

        restoreOriginalContent();
        expect(html()).toBe('<article id="outer">Outer lead sentence here <span id="inner">inner hovered words</span> outer tail.</article>');
    });
});

describe("全文会话调度", () => {
    function setLayoutBox(element: Element, width: number, height: number): void {
        const rect = {width, height};
        Object.defineProperty(element, "getClientRects", {configurable: true, value: () => [rect]});
    }

    it("视口模式只翻译进入预取窗口的段落，display:contents 观察首个布局后代", async () => {
        env.config.fullPageTranslationMode = "viewport";
        loadPage('<p id="near">Paragraph near the viewport.</p><h1 id="title"><span id="label">Contents heading title</span></h1>');
        const near = document.querySelector("#near")!;
        const title = document.querySelector("#title")!;
        const label = document.querySelector("#label")!;
        setLayoutBox(near, 600, 40);
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 300, 40);

        autoTranslateEnglishPage();
        await settle();
        const visibility = TestIntersectionObserver.last!;
        expect(env.translate).not.toHaveBeenCalled();
        expect([...visibility.observed]).toEqual([near, label]);
        expect(getFullPageTranslationProgress()).toMatchObject({remaining: 2, offscreen: 2});

        visibility.enter(near);
        await settle();
        expect(requestedSources()).toEqual(["Paragraph near the viewport."]);

        visibility.enter(label);
        await settle();
        expect(title.textContent).toBe("译:Contents heading title");
        expect(visibility.observed.size).toBe(0);
        expect(getFullPageTranslationProgress()).toMatchObject({running: 0, remaining: 0});
    });

    it("恢复原文会结束会话，在途请求完成后也不写回页面", async () => {
        const original = "<p>First paragraph text.</p><p>Second paragraph text.</p>";
        loadPage(original);
        const pending = [deferred<string[]>(), deferred<string[]>()];
        env.translate.mockImplementationOnce(() => pending[0]!.promise).mockImplementationOnce(() => pending[1]!.promise);

        autoTranslateEnglishPage();
        await settle();
        expect(env.translate).toHaveBeenCalledTimes(2);

        restoreOriginalContent();
        expect(isFullPageTranslationActive()).toBe(false);
        pending.forEach((request) => request.resolve(["迟到的译文"]));
        await settle();

        expect(html()).toBe(original);
    });

    it("全文会话中按快捷键恢复的段落不会被重新排队", async () => {
        loadPage('<p id="prose">Restore only this paragraph.</p><p>Keep this one translated.</p>');
        const prose = document.querySelector<HTMLElement>("#prose")!;
        Object.defineProperty(document, "elementsFromPoint", {configurable: true, value: () => [prose]});

        autoTranslateEnglishPage();
        await settle();
        handleTranslation(1, 1);
        await settle(3000);

        expect(prose.textContent).toBe("Restore only this paragraph.");
        expect(document.body.textContent).toContain("译:Keep this one translated.");
        expect(env.translate).toHaveBeenCalledTimes(2);
    });

    it("已是目标语言或服务原样返回的文本只请求一次", async () => {
        loadPage("<p>这一段已经是中文内容。</p><h1>Microsoft</h1>");
        env.translate.mockImplementation(async (origins) => [...origins]);

        autoTranslateEnglishPage();
        await settle();
        document.querySelector("h1")!.className = "layout-only-change";
        await settle();

        expect(requestedSources()).toEqual(["Microsoft"]);
    });

    it("失败后显示重试，重试按点击时的显示模式渲染", async () => {
        env.config.display = BILINGUAL;
        loadPage('<p id="prose">Retry with the latest display mode.</p>');
        env.translate.mockRejectedValueOnce(new Error("provider unavailable"));

        autoTranslateEnglishPage();
        await settle();
        const retry = document.querySelector<HTMLElement>(".babelbox-retry")!;
        expect(retry).not.toBeNull();

        env.config.display = SINGLE;
        retry.dispatchEvent(new window.CustomEvent("click") as Event);
        await settle();

        expect(translationsShown()).toBe(0);
        expect(document.querySelector("#prose")!.textContent).toBe("译:Retry with the latest display mode.");
    });
});
