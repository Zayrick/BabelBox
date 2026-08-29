import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {parseHTML} from "linkedom";

const runtime = vi.hoisted(() => ({
    candidates: [] as Array<{
        element: HTMLElement;
        kind: "content";
        reason: string;
        nodes?: readonly Node[];
        adapterId?: string;
    }>,
    pointCandidate: null as {
        element: HTMLElement;
        kind: "content";
        reason: string;
        nodes?: readonly Node[];
        adapterId?: string;
    } | null,
    requests: vi.fn<(origins: readonly string[]) => Promise<string[]>>(async (origins) =>
        origins.map((origin) => `译:${origin}`),
    ),
    retryCallbacks: [] as Array<() => void>,
    config: {service: "microsoft", display: 0, to: "zh", fullPageTranslationMode: "viewport" as "viewport" | "all"},
    ensureTranslationTruncationLayout: vi.fn(() => true),
}));
const browserMocks = vi.hoisted(() => ({sendMessage: vi.fn(async () => undefined)}));

vi.mock('wxt/browser', () => ({browser: {runtime: {sendMessage: browserMocks.sendMessage}}}));
vi.mock('@/src/features/full-page-translation/content/configCheck', () => ({checkConfig: () => true}));
vi.mock("@/src/core/config/constants", () => ({
    styles: {singleTranslation: 0, bilingualTranslation: 1},
}));
vi.mock("@/src/services/config/store", () => ({
    config: runtime.config,
}));
vi.mock("@/src/core/language/detect", () => ({detectlang: () => ""}));
vi.mock('@/src/services/translation/client', () => ({
    translateText: async (origin: string) => (await runtime.requests([origin]))[0],
    translateTextBatch: (origins: readonly string[]) => runtime.requests(origins),
}));
vi.mock("@/src/services/translation/queue", () => ({
    createTranslationQueueSession: () => ({}),
    cancelTranslationQueueSession: () => undefined,
}));
vi.mock('@/src/features/full-page-translation/ui/translationIndicators', () => ({
    insertLoadingSpinner: (node: HTMLElement) => {
        const spinner = node.ownerDocument.createElement("span");
        spinner.setAttribute("data-babelbox-translation-owned", "true");
        node.appendChild(spinner);
        return spinner;
    },
    removeLoadingSpinner: (node: HTMLElement, spinner?: HTMLElement) => {
        node.removeAttribute('data-babelbox-translation-shimmer');
        spinner?.remove();
    },
    insertFailedTip: (node: HTMLElement, _message: string, onRetry: () => void) => {
        runtime.retryCallbacks.push(onRetry);
        return node.ownerDocument.createElement("span");
    },
}));
vi.mock("@/src/features/full-page-translation/content/renderer", () => ({
    appendBilingualTranslation: (node: HTMLElement, text: string) => {
        const wrapper = node.ownerDocument.createElement("span");
        wrapper.className = "babelbox-bilingual-content";
        wrapper.setAttribute("data-babelbox-translation-owned", "true");
        wrapper.textContent = text;
        node.appendChild(wrapper);
        return wrapper;
    },
}));
vi.mock("@/src/features/full-page-translation/content/layout", () => ({
    ensureTranslationTruncationLayout: runtime.ensureTranslationTruncationLayout,
    isTranslationLayoutOverrideMutation: () => false,
    releaseTranslationTruncationLayout: () => undefined,
}));
vi.mock("@/src/core/translation/public", () => {
    const protectedSelector = [
        "head", "script", "style", "noscript", "iframe", "input", "textarea", "select", "option",
        "math", "svg", "canvas", "audio", "video", "object", "template", "xmp", "pre", "code",
        "kbd", "samp", "var", "mjx-container", ".MathJax_Display", ".MathJax", ".MathJax_Preview",
        ".katex", ".notranslate", "[translate='no']", "[data-notranslate='true']", "[hidden]",
        "[inert]", "[aria-hidden='true']",
    ].join(",");
    const isProtected = (element: Element) => Boolean(element.closest(protectedSelector));
    const textSlots = (element: HTMLElement) => {
        const slots: Array<{node: Text; prefix: string; source: string; suffix: string}> = [];
        const walker = element.ownerDocument.createTreeWalker(element, 4);
        let current = walker.nextNode();
        while (current) {
            const node = current as Text;
            const source = node.nodeValue ?? "";
            if (source.trim() && node.parentElement && !isProtected(node.parentElement) &&
                !node.parentElement.closest('[data-babelbox-translation-owned="true"]')) {
                slots.push({node, prefix: "", source, suffix: ""});
            }
            current = walker.nextNode();
        }
        return slots;
    };

    return {
        extractTranslationText: (element: HTMLElement) => textSlots(element).map(({source}) => source).join(""),
        extractTranslationTextFromNodes: (nodes: readonly Node[]) =>
            nodes.map((node) => node.textContent ?? "").join(""),
        applyTranslationsToSnapshot: (_snapshot: unknown, translations: readonly string[]) => translations.join(""),
        collectLiveTranslationTextSlots: textSlots,
        createTranslationSourceSnapshot: (element: HTMLElement) => ({
            slots: textSlots(element).map(({source}) => ({source})),
        }),
        evaluateHardGuard: (element: Element) => ({prune: isProtected(element)}),
        getComposedParent: (element: Element) => element.parentElement ??
            ((element.getRootNode?.() as {host?: Element})?.host ?? null),
        isProtectedDescendantElement: (element: Element) => element.matches(protectedSelector),
        getCurrentTranslationCore: () => ({
            shouldStayOriginal: () => false,
            shouldIgnoreMutation: () => false,
            inspect: (element: HTMLElement) => ({
                candidate: [...runtime.candidates].reverse().find((candidate) =>
                    candidate.element === element && !isProtected(candidate.element)),
            }),
            resolve: (start: Node | null | undefined) => [...runtime.candidates].reverse().find((candidate) => {
                if (!start || isProtected(candidate.element)) return false;
                const key = candidate.nodes?.[0] ?? candidate.element;
                return key === start || candidate.element === start || candidate.element.contains(start);
            }),
            *discoverSteps() {
                for (const segment of document.querySelectorAll<HTMLElement>(
                    '[data-babelbox-translation-segment="true"]',
                )) {
                    yield {phase: "enter", element: segment};
                }
                for (const candidate of runtime.candidates) {
                    if (isProtected(candidate.element)) continue;
                    if (candidate.element.matches('[data-babelbox-translation-segment="true"]') ||
                        candidate.element.querySelector('[data-babelbox-translation-segment="true"]')) continue;
                    yield {
                        phase: "exit",
                        element: candidate.element,
                        candidate,
                    };
                }
            },
        }),
        getOpenShadowRoots: () => [],
        getTranslationCandidateKey: (candidate: {element: HTMLElement; nodes?: readonly Node[]}) =>
            candidate.nodes?.[0] ?? candidate.element,
        isClearlyTargetLanguage: () => false,
        parseTranslationSlots: () => null,
        resolveTranslationCandidate: (start: Node | null | undefined) =>
            [...runtime.candidates].reverse().find((candidate) => candidate.element === start),
        resolveTranslationCandidateAtPoint: () => runtime.pointCandidate,
        selectPreferredTranslationCandidate: (
            existing: {element: HTMLElement; adapterId?: string},
            candidate: {element: HTMLElement; adapterId?: string},
        ) => candidate.adapterId ? candidate : existing,
        serializeTranslationSlots: (origins: readonly string[]) => ({payload: origins.join("\n")}),
    };
});

import {
    autoTranslateEnglishPage,
    handleTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from "@/src/features/full-page-translation/content/runtime";
import {getTranslationState} from "@/src/features/full-page-translation/content/state";
import {
    getFullPageTranslationProgress,
    subscribeFullPageTranslationProgress,
    type FullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';

class TestIntersectionObserver {
    static instances: TestIntersectionObserver[] = [];

    readonly observed = new Set<Element>();
    readonly observe = vi.fn((target: Element) => this.observed.add(target));
    readonly unobserve = vi.fn((target: Element) => this.observed.delete(target));
    readonly disconnect = vi.fn(() => this.observed.clear());

    constructor(private readonly callback: IntersectionObserverCallback) {
        TestIntersectionObserver.instances.push(this);
    }

    emit(target: Element, isIntersecting: boolean): void {
        this.callback([{target, isIntersecting} as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
}

class TestMutationObserver {
    static instances: TestMutationObserver[] = [];

    readonly observe = vi.fn();
    readonly disconnect = vi.fn();
    readonly takeRecords = vi.fn(() => [] as MutationRecord[]);

    constructor(private readonly callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    emit(records: MutationRecord[]): void {
        this.callback(records, this as unknown as MutationObserver);
    }
}

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

function setLayoutBox(element: Element, width: number, height: number): void {
    const rect = {width, height, top: 0, right: width, bottom: height, left: 0, x: 0, y: 0};
    Object.defineProperty(element, "getClientRects", {
        configurable: true,
        value: () => width > 0 && height > 0
            ? Object.assign([rect], {item: (index: number) => index === 0 ? rect : null})
            : Object.assign([], {item: () => null}),
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

async function finishScheduledWork(): Promise<void> {
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
}

describe("全文翻译可见性锚点", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        runtime.candidates = [];
        runtime.pointCandidate = null;
        runtime.requests.mockReset();
        runtime.requests.mockImplementation(async (origins) => origins.map((origin) => `译:${origin}`));
        runtime.retryCallbacks = [];
        runtime.config.display = 0;
        runtime.config.fullPageTranslationMode = "viewport";
        runtime.ensureTranslationTruncationLayout.mockClear();
        browserMocks.sendMessage.mockClear();
        TestIntersectionObserver.instances = [];
        TestMutationObserver.instances = [];

        const {window, document} = parseHTML("<html><head><title>Fixture</title></head><body></body></html>");
        replaceGlobal("window", window);
        replaceGlobal("document", document);
        replaceGlobal("Node", window.Node);
        replaceGlobal("Element", window.Element);
        replaceGlobal("HTMLElement", window.HTMLElement);
        replaceGlobal("Text", window.Text);
        replaceGlobal("ShadowRoot", window.ShadowRoot);
        replaceGlobal("DOMParser", window.DOMParser);
        replaceGlobal("MutationObserver", TestMutationObserver);
        replaceGlobal("IntersectionObserver", TestIntersectionObserver);
        Object.defineProperty(window, "setTimeout", {configurable: true, value: globalThis.setTimeout});
        Object.defineProperty(window, "clearTimeout", {configurable: true, value: globalThis.clearTimeout});
    });

    afterEach(() => {
        restoreOriginalContent();
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it("全文会话集中发布启动和结束状态事件", () => {
        const states: string[] = [];
        document.addEventListener("babelbox-translation-started", () => states.push("started"));
        document.addEventListener("babelbox-translation-ended", () => states.push("ended"));

        autoTranslateEnglishPage();
        expect(isFullPageTranslationActive()).toBe(true);
        expect(states).toEqual(["started"]);

        restoreOriginalContent();
        expect(isFullPageTranslationActive()).toBe(false);
        expect(states).toEqual(["started", "ended"]);
    });

    it("全文翻译后按 Ctrl 恢复的单段不会被当前全文会话重新排队", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Restore only this paragraph.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const candidate = {element: paragraph, kind: "content" as const, reason: "paragraph"};
        setLayoutBox(paragraph, 640, 90);
        runtime.candidates = [candidate];
        runtime.pointCandidate = candidate;

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances[0]!.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);

        // This is the same path used by the real Control hover trigger. It
        // restores the current target while leaving the full-page session alive.
        handleTranslation(20, 20);
        await finishScheduledWork();

        expect(isFullPageTranslationActive()).toBe(true);
        expect(getTranslationState(paragraph)).toBeUndefined();
        expect(paragraph.textContent).toBe("Restore only this paragraph.");
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(0);

        // The browser delivers the extension restore as a mutation. A rescan
        // must remember the explicit cancellation instead of translating again.
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: paragraph,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(0);

        // The cancellation is scoped to this session; starting a new full-page
        // session is still allowed to translate the paragraph again.
        restoreOriginalContent();
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances.at(-1)!.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
    });

    it("候选自身有布局盒时直接观察候选，不改用内部标签", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Visible heading</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 320, 48);
        setLayoutBox(label, 200, 28);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(title);
        expect(observer.observe).not.toHaveBeenCalledWith(label);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("立即翻译整页模式绕过可见性门禁并处理当前页面到底部", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = [
            '<p id="visible">Visible paragraph</p>',
            '<p id="below-fold">Paragraph near the page bottom</p>',
        ].join("");
        const visible = document.querySelector<HTMLElement>("#visible")!;
        const belowFold = document.querySelector<HTMLElement>("#below-fold")!;
        setLayoutBox(visible, 600, 80);
        setLayoutBox(belowFold, 600, 80);
        runtime.candidates = [
            {element: visible, kind: "content", reason: "paragraph"},
            {element: belowFold, kind: "content", reason: "paragraph"},
        ];

        autoTranslateEnglishPage();
        await finishScheduledWork();
        await finishScheduledWork();

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests).toHaveBeenCalledWith(["Visible paragraph"]);
        expect(runtime.requests).toHaveBeenCalledWith(["Paragraph near the page bottom"]);
        expect(visible.textContent).toBe("译:Visible paragraph");
        expect(belowFold.textContent).toBe("译:Paragraph near the page bottom");
    });

    it("立即翻译整页会提交全部候选，由统一翻译队列控制请求并发", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="all-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests.forEach((request, index) => request.resolve([`译:${candidates[index]!.textContent}`]));
        await finishScheduledWork();
        expect(candidates.map((candidate) => candidate.textContent)).toEqual([
            "译:One", "译:Two", "译:Three", "译:Four",
        ]);
    });

    it("恢复整页翻译会清空会话，且在途结果不会重新写回页面", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="restore-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        restoreOriginalContent();
        requests.forEach((request, index) => request.resolve([`旧译:${candidates[index]!.textContent}`]));
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(4);
        expect(candidates.map((candidate) => candidate.textContent)).toEqual(["One", "Two", "Three", "Four"]);
        expect(document.querySelectorAll('[data-babelbox-translation-owned="true"]')).toHaveLength(0);
    });

    it("运行中的会话保留启动时模式，修改配置只影响下一次全文翻译", async () => {
        document.body.innerHTML = '<p id="prose">Mode changes apply to the next session.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(TestIntersectionObserver.instances[0]!.observe).toHaveBeenCalledWith(paragraph);

        runtime.config.fullPageTranslationMode = "all";
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        restoreOriginalContent();
        autoTranslateEnglishPage();
        await finishScheduledWork();
        await finishScheduledWork();

        expect(TestIntersectionObserver.instances[1]!.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledWith(["Mode changes apply to the next session."]);
        expect(paragraph.textContent).toBe("译:Mode changes apply to the next session.");
    });

    it("立即翻译整页模式也会直接处理会话中动态追加的内容", async () => {
        runtime.config.fullPageTranslationMode = "all";
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const paragraph = document.createElement("p");
        paragraph.textContent = "A paragraph appended by infinite scroll";
        setLayoutBox(paragraph, 600, 80);
        document.body.appendChild(paragraph);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: document.body,
            addedNodes: [paragraph] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        await finishScheduledWork();
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledWith(["A paragraph appended by infinite scroll"]);
        expect(paragraph.textContent).toBe("译:A paragraph appended by infinite scroll");
        expect(TestIntersectionObserver.instances[0]!.observe).not.toHaveBeenCalled();
    });

    it("观察 display:contents H1 的首个真实布局后代，并在完成后解除该锚点", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label">Pull request title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 240, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(observer.observe).not.toHaveBeenCalledWith(title);
        expect(runtime.requests).not.toHaveBeenCalled();

        observer.emit(label, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledWith(["Pull request title"]);
        expect(title.textContent).toBe("译:Pull request title");
        expect(observer.unobserve).toHaveBeenCalledWith(label);
    });

    it("hydration 替换 display:contents 后代后刷新同候选 anchor，旧 IO 不会丢失或重复调度", async () => {
        document.body.innerHTML = '<h1 id="title"><span id="label-a">Hydrating title</span></h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        const labelA = document.querySelector<HTMLElement>("#label-a")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(labelA, 220, 36);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(labelA);

        const labelB = document.createElement("span");
        labelB.id = "label-b";
        labelB.textContent = "Hydrated title";
        setLayoutBox(labelB, 240, 40);
        labelA.replaceWith(labelB);
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "childList",
            target: title,
            addedNodes: [labelB] as unknown as NodeList,
            removedNodes: [labelA] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);

        expect(observer.unobserve).toHaveBeenCalledWith(labelA);
        expect(observer.observe).toHaveBeenCalledWith(labelB);
        expect(runtime.requests).not.toHaveBeenCalled();

        // A queued callback for the detached target is harmless; only the new
        // live anchor can cross the visibility gate for this stable H1 key.
        observer.emit(labelA, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();

        const request = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => request.promise);
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        // A second IO notification while the first generation is in flight
        // must not create another provider call or displace that generation.
        observer.emit(labelB, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        request.resolve(["译:Hydrated title"]);
        await finishScheduledWork();
        expect(title.textContent).toBe("译:Hydrated title");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("没有任何布局锚点的 H1 仍直接进入受控翻译队列", async () => {
        document.body.innerHTML = '<h1 id="title">Text-only heading</h1>';
        const title = document.querySelector<HTMLElement>("#title")!;
        setLayoutBox(title, 0, 0);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        await finishScheduledWork();

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).not.toHaveBeenCalled();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests).toHaveBeenCalledWith(["Text-only heading"]);
        expect(title.textContent).toBe("译:Text-only heading");
    });

    it("全部可见候选都会启动，并在 settle 后从 inFlightCandidates 释放", async () => {
        document.body.innerHTML = ["One", "Two", "Three", "Four"]
            .map((label, index) => `<p id="candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const observer = TestIntersectionObserver.instances[0]!;
        candidates.forEach((candidate) => observer.emit(candidate, true));
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests[0]!.resolve(["译:One"]);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(runtime.requests).toHaveBeenCalledTimes(4);

        requests[1]!.resolve(["译:Two"]);
        requests[2]!.resolve(["译:Three"]);
        requests[3]!.resolve(["译:Four"]);
        await finishScheduledWork();
        expect(candidates.map((candidate) => candidate.textContent)).toEqual([
            "译:One", "译:Two", "译:Three", "译:Four",
        ]);
    });

    it("全文进度只把预取窗口内的等待候选计入 queued，并保留离屏 remaining", async () => {
        document.body.innerHTML = ["One", "Two", "Three", "Four", "Five"]
            .map((label, index) => `<p id="progress-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        const snapshots: FullPageTranslationProgress[] = [];
        const unsubscribe = subscribeFullPageTranslationProgress((progress) => {
            snapshots.push(progress);
        });
        const expectCurrentProgress = (expected: Pick<
            FullPageTranslationProgress,
            "active" | "running" | "remaining" | "queued" | "offscreen"
        >) => {
            expect(getFullPageTranslationProgress()).toMatchObject(expected);
            expect(snapshots.at(-1)).toMatchObject(expected);
        };

        try {
            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            await Promise.resolve();

            expectCurrentProgress({
                active: true,
                running: 0,
                remaining: 5,
                queued: 0,
                offscreen: 5,
            });

            const observer = TestIntersectionObserver.instances[0]!;
            candidates.slice(0, 4).forEach((candidate) => observer.emit(candidate, true));
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(4);
            expectCurrentProgress({
                active: true,
                running: 4,
                remaining: 1,
                queued: 0,
                offscreen: 1,
            });

            requests[0]!.resolve(["译:One"]);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(4);
            expectCurrentProgress({
                active: true,
                running: 3,
                remaining: 1,
                queued: 0,
                offscreen: 1,
            });

            observer.emit(candidates[4]!, true);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();

            expect(runtime.requests).toHaveBeenCalledTimes(5);
            expectCurrentProgress({
                active: true,
                running: 4,
                remaining: 0,
                queued: 0,
                offscreen: 0,
            });

            requests[1]!.resolve(["译:Two"]);
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();
            expect(runtime.requests).toHaveBeenCalledTimes(5);

            requests[2]!.resolve(["译:Three"]);
            requests[3]!.resolve(["译:Four"]);
            requests[4]!.resolve(["译:Five"]);
            await finishScheduledWork();

            expect(candidates.map((candidate) => candidate.textContent)).toEqual([
                "译:One", "译:Two", "译:Three", "译:Four", "译:Five",
            ]);
            expectCurrentProgress({
                active: true,
                running: 0,
                remaining: 0,
                queued: 0,
                offscreen: 0,
            });

            restoreOriginalContent();
            expectCurrentProgress({
                active: false,
                running: 0,
                remaining: 0,
                queued: 0,
                offscreen: 0,
            });
        } finally {
            unsubscribe();
        }
    });

    it("立即翻译整页时把所有未启动候选计入 queued，不产生离屏计数", async () => {
        runtime.config.fullPageTranslationMode = "all";
        document.body.innerHTML = ["One", "Two", "Three", "Four", "Five"]
            .map((label, index) => `<p id="all-progress-candidate-${index}">${label}</p>`)
            .join("");
        const candidates = Array.from(document.querySelectorAll<HTMLElement>("p"));
        candidates.forEach((candidate) => setLayoutBox(candidate, 400, 40));
        runtime.candidates = candidates.map((element) => ({
            element,
            kind: "content" as const,
            reason: "paragraph",
        }));
        const requests = candidates.map(() => deferred<string[]>());
        let nextRequest = 0;
        runtime.requests.mockImplementation(() => requests[nextRequest++]!.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(51);
        await Promise.resolve();
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(5);
        expect(TestIntersectionObserver.instances[0]!.observe).not.toHaveBeenCalled();
        expect(getFullPageTranslationProgress()).toMatchObject({
            active: true,
            running: 5,
            remaining: 0,
            queued: 0,
            offscreen: 0,
        });

        restoreOriginalContent();
        requests.forEach((request, index) => request.resolve([`译:${candidates[index]!.textContent}`]));
        await finishScheduledWork();
        expect(getFullPageTranslationProgress()).toMatchObject({active: false});
    });

    it("不会把扩展生成的布局节点当成候选可见性锚点", async () => {
        document.body.innerHTML = `
            <h1 id="title">
                <span id="owned" data-babelbox-translation-owned="true">Loading</span>
                <span id="host-label">Host title</span>
            </h1>
        `;
        const title = document.querySelector<HTMLElement>("#title")!;
        const owned = document.querySelector<HTMLElement>("#owned")!;
        const hostLabel = document.querySelector<HTMLElement>("#host-label")!;
        setLayoutBox(title, 0, 0);
        setLayoutBox(owned, 100, 20);
        setLayoutBox(hostLabel, 180, 30);
        runtime.candidates = [{element: title, kind: "content", reason: "heading"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(hostLabel);
        expect(observer.observe).not.toHaveBeenCalledWith(owned);
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("替换同 key 候选时解除旧 anchor、切换 owner，并在 stop 后不再调度", async () => {
        document.body.innerHTML = `
            <div id="generic"><h1 id="title"><span id="label">Exact title</span></h1></div>
        `;
        const generic = document.querySelector<HTMLElement>("#generic")!;
        const title = document.querySelector<HTMLElement>("#title")!;
        const label = document.querySelector<HTMLElement>("#label")!;
        setLayoutBox(generic, 640, 120);
        setLayoutBox(title, 0, 0);
        setLayoutBox(label, 220, 36);
        runtime.candidates = [
            {element: generic, nodes: [title], kind: "content", reason: "inline-run"},
            {element: title, kind: "content", reason: "site-title", adapterId: "site"},
        ];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);

        const observer = TestIntersectionObserver.instances[0]!;
        expect(observer.observe).toHaveBeenCalledWith(generic);
        expect(observer.unobserve).toHaveBeenCalledWith(generic);
        expect(observer.observe).toHaveBeenCalledWith(label);
        expect(isFullPageTranslationActive()).toBe(true);

        restoreOriginalContent();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(isFullPageTranslationActive()).toBe(false);

        observer.emit(label, true);
        await finishScheduledWork();
        expect(runtime.requests).not.toHaveBeenCalled();
    });

    it("失败 UI 注入的重试回调会按点击时的当前显示模式重新解析候选", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Retry with the latest display mode.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];
        runtime.requests.mockRejectedValueOnce(new Error("provider unavailable"));

        runtime.pointCandidate = runtime.candidates[0]!;
        handleTranslation(20, 20);
        await finishScheduledWork();

        expect(getTranslationState(paragraph)?.phase).toBe("error");
        expect(runtime.retryCallbacks).toHaveLength(1);

        runtime.config.display = 0;
        runtime.retryCallbacks[0]!();
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(getTranslationState(paragraph)).toMatchObject({phase: "translated", mode: "single"});
        expect(paragraph.querySelector(".babelbox-bilingual-content")).toBeNull();
        expect(paragraph.textContent).toBe("译:Retry with the latest display mode.");
    });

    it("全文会话登记启动前 hover 状态的祖先索引，新增 translate=no 会恢复且 stop 后不再响应", async () => {
            runtime.config.display = 1;
            document.body.innerHTML = `
                <section id="ancestor">
                    <p id="prose">Hover translation exists before full-page discovery.</p>
                </section>
            `;
            const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            runtime.pointCandidate = runtime.candidates[0]!;
            handleTranslation(20, 20);
            await finishScheduledWork();

            const hoverState = getTranslationState(paragraph)!;
            expect(hoverState.phase).toBe("translated");
            expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);

            // Discovery must only register the existing hover state in the
            // current full session. It must not replace the state or request it
            // again before an authoritative ancestor guard changes.
            expect(getTranslationState(paragraph)).toBe(hoverState);
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            ancestor.setAttribute("translate", "no");
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: "translate",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();

            expect(hoverState.controller.signal.aborted).toBe(true);
            expect(getTranslationState(paragraph)).toBeUndefined();
            expect(paragraph.textContent).toBe("Hover translation exists before full-page discovery.");
            expect(paragraph.querySelectorAll('[data-babelbox-translation-owned="true"]')).toHaveLength(0);
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            restoreOriginalContent();
            expect(isFullPageTranslationActive()).toBe(false);
            ancestor.removeAttribute("translate");
            mutationObserver.emit([{
                type: "attributes",
                target: ancestor,
                attributeName: "translate",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("全文 discovery enter 会登记启动前 in-flight hover synthetic 状态且旧结果不可覆盖", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        runtime.pointCandidate = runtime.candidates[0]!;
        handleTranslation(20, 20);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const segment = host.querySelector<HTMLElement>('[data-babelbox-translation-segment="true"]')!;
        const hoverState = getTranslationState(segment)!;
        expect(hoverState.phase).toBe("loading");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(segment)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(segment.isConnected).toBe(false);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();

        expect(ancestor.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(0);
        expect(ancestor.querySelectorAll('[data-babelbox-translation-owned="true"]')).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("共享 key 状态会按 candidate owner 到实际 keyedTarget 登记祖先索引", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="owner"><p id="prose">Exact hover target shares a later full-page key.</p></div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const owner = document.querySelector<HTMLElement>("#owner")!;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(owner, 640, 120);
        setLayoutBox(paragraph, 600, 80);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "exact-hover"}];

        runtime.pointCandidate = runtime.candidates[0]!;
        handleTranslation(20, 20);
        await finishScheduledWork();
        const hoverState = getTranslationState(paragraph)!;
        expect(hoverState.phase).toBe("translated");
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        runtime.candidates = [{
            element: owner,
            nodes: [paragraph],
            kind: "content",
            reason: "shared-key-inline-run",
        }];
        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        expect(getTranslationState(paragraph)).toBe(hoverState);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(hoverState.controller.signal.aborted).toBe(true);
        expect(getTranslationState(paragraph)).toBeUndefined();
        expect(paragraph.textContent).toBe("Exact hover target shares a later full-page key.");
        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it("异步 nodes 候选忽略自身的 materialization 与 spinner 记录", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                <p>Independent block child.</p>
            </div>
        `;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceText = host.firstChild as Text;
        const emphasis = document.querySelector<HTMLElement>("#emphasis")!;
        const sourceNodes = [sourceText, emphasis] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const pendingRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => pendingRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const segment = host.querySelector<HTMLElement>('[data-babelbox-translation-segment="true"]')!;
        const spinner = segment.querySelector<HTMLElement>('[data-babelbox-translation-owned="true"]')!;
        expect(Array.from(segment.childNodes).filter((node) => node !== spinner)).toEqual(sourceNodes);

        // These are the actual live Node identities produced by materialization:
        // the host gains the segment, its source nodes move into that segment,
        // and the same segment receives the one state-owned spinner.
        TestMutationObserver.instances.at(-1)!.emit([
            {
                type: "childList",
                target: host,
                addedNodes: [segment] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
            ...sourceNodes.map((node) => ({
                type: "childList",
                target: host,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [node] as unknown as NodeList,
            })),
            {
                type: "childList",
                target: segment,
                addedNodes: [...sourceNodes, spinner] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            },
        ] as unknown as MutationRecord[]);
        await vi.advanceTimersByTimeAsync(100);

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(segment.isConnected).toBe(true);
        pendingRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `译:${origin}`));
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(segment.isConnected).toBe(true);
        expect(segment.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
    });

    it("in-flight synthetic inline-run 的祖先 hidden 会 abort，旧结果不可覆盖且解除后可翻译", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <section id="ancestor">
                <div id="mixed">Readable inline prefix <strong id="emphasis">with emphasized prose.</strong>
                    <p>Independent block child.</p>
                </div>
            </section>
        `;
        const ancestor = document.querySelector<HTMLElement>("#ancestor")!;
        const host = document.querySelector<HTMLElement>("#mixed")!;
        const sourceNodes = [host.firstChild as Text, document.querySelector<HTMLElement>("#emphasis")!] as const;
        setLayoutBox(host, 640, 120);
        runtime.candidates = [{element: host, nodes: sourceNodes, kind: "content", reason: "inline-run"}];
        const firstRequest = deferred<string[]>();
        runtime.requests.mockImplementationOnce(() => firstRequest.promise);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(host, true);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();

        const firstSegment = host.querySelector<HTMLElement>('[data-babelbox-translation-segment="true"]')!;
        const firstState = getTranslationState(firstSegment)!;
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstState.phase).toBe("loading");

        ancestor.hidden = true;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);

        expect(firstState.controller.signal.aborted).toBe(true);
        expect(firstSegment.isConnected).toBe(false);
        expect(ancestor.querySelectorAll(
            '[data-babelbox-translation-segment="true"], [data-babelbox-translation-owned="true"]',
        )).toHaveLength(0);

        firstRequest.resolve(runtime.requests.mock.calls[0]![0].map((origin) => `旧译:${origin}`));
        await finishScheduledWork();
        expect(ancestor.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(0);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        ancestor.hidden = false;
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: ancestor,
            attributeName: "hidden",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(host, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('[data-babelbox-translation-segment="true"]')).toHaveLength(1);
        expect(host.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
        expect(host.textContent).not.toContain("旧译:");
    });

    it("显式 unchanged 在同一全文会话形成 source 签名墓碑，普通 rescan 不重复请求", async () => {
        document.body.innerHTML = '<h1 id="brand">Microsoft</h1>';
        const brand = document.querySelector<HTMLElement>("#brand")!;
        setLayoutBox(brand, 300, 48);
        runtime.candidates = [{element: brand, kind: "content", reason: "heading"}];
        runtime.requests.mockImplementation(async (origins) => [...origins]);

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        TestIntersectionObserver.instances[0]!.emit(brand, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(brand.textContent).toBe("Microsoft");

        brand.className = "layout-only-change";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: brand,
            attributeName: "class",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
    });

    it.each([
        {display: 0, expectedLayoutChecks: 0, label: "single"},
        {display: 1, expectedLayoutChecks: 1, label: "bilingual"},
    ] as const)(
        "$label 已译内容发生纯布局 mutation 时只为双语 wrapper 续租 unclamp",
        async ({display, expectedLayoutChecks}) => {
            runtime.config.display = display;
            document.body.innerHTML = '<p id="prose">Stable source under a layout-only mutation.</p>';
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            TestIntersectionObserver.instances[0]!.emit(paragraph, true);
            await finishScheduledWork();
            expect(getTranslationState(paragraph)?.phase).toBe("translated");

            paragraph.classList.add("host-layout-update");
            TestMutationObserver.instances.at(-1)!.emit([{
                type: "attributes",
                target: paragraph,
                attributeName: "class",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();

            expect(runtime.ensureTranslationTruncationLayout)
                .toHaveBeenCalledTimes(expectedLayoutChecks);
            expect(runtime.requests).toHaveBeenCalledTimes(1);
        },
    );

    it("已译 prose 忽略 MathJax/code 等保护后代 churn，但外层 source mutation 会重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Readable prose before protected renderers. </span>
                <span id="math-v2-root" class="MathJax_Display"><span id="math-v2">x + y</span></span>
                <code id="code">const answer = 42;</code>
                <span id="tail"> Readable prose after protected renderers.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const math = document.querySelector<HTMLElement>("#math-v2")!;
        const code = document.querySelector<HTMLElement>("#code")!;
        setLayoutBox(paragraph, 700, 140);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        const firstWrapper = paragraph.querySelector<HTMLElement>(".babelbox-bilingual-content")!;
        expect(firstWrapper?.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);

        const mathText = math.firstChild as Text;
        mathText.nodeValue = "host math churn";
        code.setAttribute("style", "--render-pass: 1");
        TestMutationObserver.instances.at(-1)!.emit([
            {
                type: "characterData",
                target: mathText,
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "attributes",
                target: code,
                attributeName: "style",
                addedNodes: [] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord,
        ]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);

        lead.firstChild!.nodeValue = "Updated readable prose before protected renderers. ";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
    });

    it("离屏 MathJax v2 父 P staging 事务保留 wrapper，真实 prose/slot 变化仍重启", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span id="lead">Perspective projection prose stays translatable. </span>
                <span id="preview" class="MathJax_Preview">FORMULA_PREVIEW_SECRET</span>
                <script id="tex" type="math/tex; mode=display">FORMULA_TEX_SECRET</script>
                <span id="tail"> The explanation continues around the equation.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const lead = document.querySelector<HTMLElement>("#lead")!;
        const preview = document.querySelector<HTMLElement>("#preview")!;
        setLayoutBox(paragraph, 750, 338);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        const mutationObserver = TestMutationObserver.instances.at(-1)!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).not.toMatch(
            /FORMULA_PREVIEW_SECRET|FORMULA_TEX_SECRET/u,
        );
        const firstWrapper = paragraph.querySelector<HTMLElement>(".babelbox-bilingual-content")!;
        expect(firstWrapper.isConnected).toBe(true);

        // The candidate has left IO. MathJax v2 first inserts an unclassified,
        // detached staging span at the direct P boundary, then replaces it with
        // its protected Display/MathJax tree while the TeX source script stays.
        // No second positive IO event is allowed to repair a lost wrapper.
        visibilityObserver.emit(paragraph, false);
        const staging = document.createElement("span");
        preview.replaceWith(staging);
        const display = document.createElement("span");
        display.className = "MathJax_Display";
        const renderedMath = document.createElement("span");
        renderedMath.className = "MathJax";
        renderedMath.textContent = "FORMULA_RENDERED_SECRET";
        display.append(renderedMath);
        staging.replaceWith(display);
        mutationObserver.emit([
            {
                type: "childList",
                target: paragraph,
                addedNodes: [staging] as unknown as NodeList,
                removedNodes: [preview] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: paragraph,
                addedNodes: [display] as unknown as NodeList,
                removedNodes: [staging] as unknown as NodeList,
            } as unknown as MutationRecord,
            {
                type: "childList",
                target: display,
                addedNodes: [renderedMath] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord,
        ]);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(firstWrapper.isConnected).toBe(true);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);

        // A real source edit uses the existing restart path. Lazy full-page
        // scheduling still waits for visibility; once re-entered it requests
        // exactly one fresh payload and continues excluding renderer content.
        lead.firstChild!.nodeValue = "Updated perspective projection prose must be translated. ";
        mutationObserver.emit([{
            type: "characterData",
            target: lead.firstChild!,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await finishScheduledWork();
        expect(firstWrapper.isConnected).toBe(false);
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).toContain(
            "Updated perspective projection prose must be translated.",
        );
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toMatch(
            /FORMULA_RENDERED_SECRET|FORMULA_TEX_SECRET/u,
        );
    });

    it("宿主篡改译文 wrapper 不会被 hard guard 当成可忽略 mutation", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);

        const firstWrapper = paragraph.querySelector<HTMLElement>(".babelbox-bilingual-content")!;
        const translatedText = firstWrapper.firstChild as Text;
        translatedText.nodeValue = "Host overwrote the extension translation.";
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "characterData",
            target: translatedText,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
    });

    it("宿主向译文 wrapper append 文本后会恢复并重译", async () => {
            runtime.config.display = 1;
            document.body.innerHTML = '<p id="prose">Host prose remains authoritative.</p>';
            const paragraph = document.querySelector<HTMLElement>("#prose")!;
            setLayoutBox(paragraph, 620, 90);
            runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

            autoTranslateEnglishPage();
            await vi.advanceTimersByTimeAsync(50);
            const visibilityObserver = TestIntersectionObserver.instances[0]!;
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);

            const firstWrapper = paragraph.querySelector<HTMLElement>(".babelbox-bilingual-content")!;
            const mutationObserver = TestMutationObserver.instances.at(-1)!;

            // MutationObserver delivers the extension's own wrapper insertion
            // asynchronously. Its intact snapshot must remain a no-op.
            mutationObserver.emit([{
                type: "childList",
                target: paragraph,
                addedNodes: [firstWrapper] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await finishScheduledWork();
            expect(runtime.requests).toHaveBeenCalledTimes(1);
            expect(firstWrapper.isConnected).toBe(true);

            const appended = document.createTextNode("Host appended translation text.");
            firstWrapper.appendChild(appended);
            mutationObserver.emit([{
                type: "childList",
                target: firstWrapper,
                addedNodes: [appended] as unknown as NodeList,
                removedNodes: [] as unknown as NodeList,
            } as unknown as MutationRecord]);
            await vi.advanceTimersByTimeAsync(50);
            visibilityObserver.emit(paragraph, true);
            await finishScheduledWork();

            expect(runtime.requests).toHaveBeenCalledTimes(2);
            expect(firstWrapper.isConnected).toBe(false);
            expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
    });

    it("普通后代新增 translate=no 会重启，且新 payload 排除受保护文本", async () => {
        runtime.config.display = 1;
        document.body.innerHTML = `
            <p id="prose">
                <span>Readable prefix. </span>
                <span id="dynamic">This text becomes protected.</span>
                <span> Readable suffix.</span>
            </p>
        `;
        const paragraph = document.querySelector<HTMLElement>("#prose")!;
        const dynamic = document.querySelector<HTMLElement>("#dynamic")!;
        setLayoutBox(paragraph, 620, 90);
        runtime.candidates = [{element: paragraph, kind: "content", reason: "paragraph"}];

        autoTranslateEnglishPage();
        await vi.advanceTimersByTimeAsync(50);
        const visibilityObserver = TestIntersectionObserver.instances[0]!;
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();
        expect(runtime.requests).toHaveBeenCalledTimes(1);
        expect(runtime.requests.mock.calls[0]![0].join(" ")).toContain("This text becomes protected.");

        const firstWrapper = paragraph.querySelector<HTMLElement>(".babelbox-bilingual-content")!;
        dynamic.setAttribute("translate", "no");
        TestMutationObserver.instances.at(-1)!.emit([{
            type: "attributes",
            target: dynamic,
            attributeName: "translate",
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord]);
        await vi.advanceTimersByTimeAsync(50);
        visibilityObserver.emit(paragraph, true);
        await finishScheduledWork();

        expect(runtime.requests).toHaveBeenCalledTimes(2);
        expect(runtime.requests.mock.calls[1]![0].join(" ")).not.toContain("This text becomes protected.");
        expect(firstWrapper.isConnected).toBe(false);
        expect(paragraph.querySelectorAll(".babelbox-bilingual-content")).toHaveLength(1);
    });

});
