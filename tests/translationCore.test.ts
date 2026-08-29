import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createDeclarativeAdapter,
    createTranslationCore,
    createTranslationSourceSnapshot,
    extractTranslationText,
    getCurrentTranslationCore,
    getOpenShadowRoots,
    isClearlyTargetLanguage,
    isMeaningfulTranslationText,
    parseTranslationSlots,
    selectPreferredTranslationCandidate,
    serializeTranslationSlots,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
} from '@/src/core/translation/public';
import {
    evaluateHardGuard,
    findElementsAtPoint,
    findNodeAtPoint,
} from '@/src/core/translation/dom';

function page(html: string, url = 'https://example.test/article') {
    const {document} = parseHTML(`<html><head></head><body>${html}</body></html>`);
    const core = createTranslationCore({url: new URL(url)});
    return {document, core};
}

function candidateIds(document: Document, url?: string): string[] {
    const core = createTranslationCore({url: new URL(url ?? 'https://example.test/article')});
    return core.discover(document).map((candidate) => candidate.element.id).filter(Boolean);
}

describe('translation candidate core', () => {
    it('keeps inline links and emphasis inside one paragraph candidate', () => {
        const {document, core} = page(`
            <main><p id="prose">Read <a id="link">the guide</a> with <strong>care</strong>.</p></main>
        `);
        const prose = document.querySelector('#prose')!;
        const link = document.querySelector('#link')!;

        expect(core.discover(document).map((item) => item.element)).toEqual([prose]);
        expect(core.resolve(link)?.element).toBe(prose);
    });

    it('uses the same candidate for full discovery and hover resolution', () => {
        const {document, core} = page('<main><section><p id="target"><span id="hit">A complete sentence to translate.</span></p></section></main>');
        const full = core.discover(document).find((item) => item.element.id === 'target');
        const hover = core.resolve(document.querySelector('#hit'));

        expect(full).toBeDefined();
        expect(hover?.element).toBe(full?.element);
        expect(hover?.kind).toBe(full?.kind);
    });

    it('reclassifies a candidate when its interactive role changes', () => {
        const {document, core} = page('<main><p id="target">A complete sentence to translate.</p></main>');
        const target = document.querySelector('#target')!;

        expect(core.inspect(target).candidate?.kind).toBe('content');
        target.setAttribute('role', 'button');
        expect(core.inspect(target).candidate?.kind).toBe('control');
    });

    it('does not duplicate parent containers around paragraph children', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><article id="article"><div id="wrapper">
                <p id="first">First readable paragraph.</p>
                <p id="second">Second readable paragraph.</p>
            </div></article></body></html>
        `).document);

        expect(ids).toEqual(['first', 'second']);
    });

    it('segments direct inline runs around block children for full and hover', () => {
        const {document, core} = page(`
            <main><div id="mixed">Intro <strong>text</strong>
                <p id="child">Child paragraph.</p>
                Tail <em>text</em>
            </div></main>
        `);
        const mixed = document.querySelector('#mixed')!;
        const child = document.querySelector('#child')!;
        const intro = Array.from(mixed.childNodes).find((node) => node.textContent?.includes('Intro'))!;
        const tail = Array.from(mixed.childNodes).find((node) => node.textContent?.includes('Tail'))!;
        const candidates = core.discover(document);
        const runs = candidates.filter((candidate) => candidate.element === mixed && candidate.nodes);

        expect(candidates.map((candidate) => candidate.element)).toContain(child);
        expect(runs).toHaveLength(2);
        expect(runs.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Intro text', 'Tail text']);
        expect(core.resolve(intro)?.nodes).toEqual(runs[0]?.nodes);
        expect(core.resolve(tail)?.nodes).toEqual(runs[1]?.nodes);
    });

    it('keeps an inline-styled semantic paragraph out of a parent run', () => {
        const {document, core} = page(`
            <main><div id="mixed">
                <p id="semantic-leaf" style="display:inline">A semantic paragraph kept in place.</p>
                <ul><li>A separate block child.</li></ul>
            </div></main>
        `);
        const paragraph = document.querySelector('#semantic-leaf')!;
        const candidates = core.discover(document);

        expect(candidates.find((candidate) => candidate.element === paragraph)).toBeDefined();
        expect(candidates.some((candidate) => candidate.nodes?.includes(paragraph as ChildNode))).toBe(false);
    });

    it('keeps an inline direct-child subtree out of an ancestor run when its descendant owns a candidate', () => {
        const {document, core} = page(`
            <main><div id="theorem">
                <h6 id="definition">Definition 2.4.</h6>
                <div id="paragraph-shell"><p id="statement">
                    A bounded operator has a unique continuous extension.
                </p></div>
            </div></main>
        `);
        const view = document.defaultView!;
        Object.defineProperty(view, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: ['paragraph-shell', 'statement'].includes(element.id)
                    ? 'inline'
                    : ['MAIN', 'DIV', 'H6'].includes(element.tagName) ? 'block' : 'inline',
            }),
        });
        const theorem = document.querySelector('#theorem')!;
        const paragraphShell = document.querySelector('#paragraph-shell')!;
        const statement = document.querySelector('#statement')!;
        const candidates = core.discover(document);

        expect(candidates.find((candidate) => candidate.element === statement)).toBeDefined();
        expect(candidates.some((candidate) => candidate.element === theorem &&
            candidate.nodes?.some((node) => node === paragraphShell ||
                (node.nodeType === 1 && (node as Element).contains(statement))))).toBe(false);
        expect(candidates.map((candidate) => candidate.element.id)).toEqual(['definition', 'statement']);
    });

    it('resolves parent direct text to the same run that full discovery splits around a candidate subtree', () => {
        const {document, core} = page(`
            <main><div id="theorem">
                <h6 id="definition">Definition 2.4.</h6>
                Context before
                <div id="paragraph-shell"><p id="statement">
                    A bounded operator has a unique continuous extension.
                </p></div>
                Context after
            </div></main>
        `);
        const view = document.defaultView!;
        Object.defineProperty(view, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: ['paragraph-shell', 'statement', 'added-shell', 'added-statement'].includes(element.id)
                    ? 'inline'
                    : ['MAIN', 'DIV', 'H6'].includes(element.tagName) ? 'block' : 'inline',
            }),
        });
        const theorem = document.querySelector('#theorem')!;
        const paragraphShell = document.querySelector('#paragraph-shell')!;
        const statement = document.querySelector('#statement')!;
        const contextBefore = Array.from(theorem.childNodes).find((node) =>
            node.nodeType === 3 && node.textContent?.includes('Context before'))!;
        const contextAfter = Array.from(theorem.childNodes).find((node) =>
            node.nodeType === 3 && node.textContent?.includes('Context after'))!;
        const parentHoverBeforeDiscovery = core.resolve(contextBefore);
        const childHoverBeforeDiscovery = core.resolve(statement.firstChild);
        const fullRuns = core.discover(document).filter((candidate) =>
            candidate.element === theorem && candidate.nodes);
        const parentHoverBefore = core.resolve(contextBefore);
        const parentHoverAfter = core.resolve(contextAfter);

        expect(fullRuns.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Context before', 'Context after']);
        expect(parentHoverBeforeDiscovery?.nodes).toEqual(fullRuns[0]?.nodes);
        expect(parentHoverBeforeDiscovery?.nodes).not.toContain(paragraphShell);
        expect(childHoverBeforeDiscovery)
            .toMatchObject({element: statement, reason: 'generic-readable-block'});
        expect(parentHoverBefore).toMatchObject({element: theorem, reason: 'generic-inline-run'});
        expect(parentHoverBefore?.nodes).toEqual(fullRuns[0]?.nodes);
        expect(parentHoverAfter?.nodes).toEqual(fullRuns[1]?.nodes);
        expect(parentHoverBefore?.nodes).not.toContain(paragraphShell);

        const addedShell = document.createElement('div');
        addedShell.id = 'added-shell';
        const addedStatement = document.createElement('p');
        addedStatement.id = 'added-statement';
        addedStatement.textContent = 'A dynamically inserted statement remains independently translatable.';
        addedShell.append(addedStatement);
        theorem.append(addedShell);

        const parentHoverAfterMutation = core.resolve(contextAfter);
        expect(parentHoverAfterMutation?.nodes).toEqual(fullRuns[1]?.nodes);
        expect(parentHoverAfterMutation?.nodes).not.toContain(addedShell);
    });

    it('revalidates stale child barriers before resolving a mutated inline run', () => {
        const {document, core} = page(`
            <main><div id="parent">
                Before
                <span id="changed-shell"><p id="changed-candidate">
                    The first nested paragraph starts as its own candidate.
                </p></span>
                Middle
                <span id="live-shell"><p id="live-candidate">
                    The second nested paragraph remains independently translatable.
                </p></span>
                After
            </div></main>
        `);
        const view = document.defaultView!;
        Object.defineProperty(view, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: element.tagName === 'SPAN' ? 'inline' : 'block',
            }),
        });
        const parent = document.querySelector('#parent')!;
        const changedShell = document.querySelector('#changed-shell')!;
        const liveShell = document.querySelector('#live-shell')!;
        const liveCandidate = document.querySelector('#live-candidate')!;

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual([
            'changed-candidate',
            'live-candidate',
            'parent',
            'parent',
            'parent',
        ]);

        changedShell.textContent = 'The first subtree is now ordinary inline prose.';
        const changedText = changedShell.firstChild!;
        const hover = core.resolve(changedText);

        expect(hover).toMatchObject({element: parent, reason: 'generic-inline-run'});
        expect(hover?.nodes).toContain(changedShell);
        expect(hover?.nodes).not.toContain(liveShell);
        expect(
            hover?.nodes?.some((node) => node.nodeType === 1 && (node as Element).contains(liveCandidate)),
            'The refreshed parent run must not overlap the still-live descendant candidate',
        ).toBe(false);

        const dirtyCandidates = core.discover(parent);
        const dirtyRun = dirtyCandidates.find((candidate) =>
            candidate.element === parent && candidate.nodes?.includes(changedShell));
        expect(dirtyCandidates.find((candidate) => candidate.element === liveCandidate)).toBeDefined();
        expect(dirtyRun).toMatchObject({element: parent, reason: 'generic-inline-run'});
        expect(dirtyRun?.nodes).toEqual(hover?.nodes);
        expect(core.resolve(changedText)?.nodes).toEqual(dirtyRun?.nodes);
    });

    it.each(['main', 'article', 'section', 'div'])('never reparents display:contents <%s> regions', (tag) => {
        const {document, core} = page(`
            <div id="layout">Parent before
                <${tag} id="semantic" style="display:contents">
                    Semantic before <strong id="direct">direct text</strong>
                    <p id="child">Nested paragraph.</p>
                    Semantic after
                </${tag}>
                Parent after <p id="sibling">Sibling paragraph.</p>
            </div>
        `);
        const view = document.defaultView!;
        Object.defineProperty(view, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({
                display: element.getAttribute('style')?.includes('display:contents') ? 'contents' :
                    ['P', 'DIV'].includes(element.tagName) ? 'block' : 'inline',
            }),
        });
        const semantic = document.querySelector('#semantic')!;
        const child = document.querySelector('#child')!;
        const direct = document.querySelector('#direct')!;
        const layout = document.querySelector('#layout')!;
        const candidates = core.discover(document);
        const semanticRuns = candidates.filter((candidate) => candidate.element === semantic && candidate.nodes);
        const layoutRuns = candidates.filter((candidate) => candidate.element === layout && candidate.nodes);

        expect(candidates.some((candidate) => candidate.nodes?.includes(semantic as ChildNode))).toBe(false);
        expect(candidates.find((candidate) => candidate.element === child)).toBeDefined();
        expect(layoutRuns.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Parent before', 'Parent after']);
        expect(semanticRuns).toHaveLength(2);
        expect(semanticRuns.map((candidate) => candidate.nodes?.map((node) => node.textContent).join('').trim()))
            .toEqual(['Semantic before direct text', 'Semantic after']);
        expect(core.resolve(direct)?.nodes).toEqual(semanticRuns[0]?.nodes);
        expect(core.resolve(child)?.element).toBe(child);
    });

    it('offers lazy discovery steps with the same candidates as synchronous discovery', () => {
        const {document} = parseHTML(`<html><body><main>${Array.from({length: 200}, (_, index) =>
            `<p id="p-${index}">Readable paragraph number ${index} for incremental discovery.</p>`).join('')}</main></body></html>`);
        let decisions = 0;
        const countingAdapter = {
            id: 'counting',
            matches: () => true,
            decide: () => {
                decisions += 1;
                return {kind: 'pass'} as const;
            },
        };
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [countingAdapter],
        });
        const steps = core.discoverSteps(document);
        const first = steps.next();

        expect(first.done).toBe(false);
        expect(decisions).toBeLessThan(100);

        const incremental = [first.value, ...steps]
            .flatMap((step) => step?.candidate ? [step.candidate.element.id] : []);
        expect(incremental).toEqual(core.discover(document).map((candidate) => candidate.element.id));
        expect(incremental).toHaveLength(200);
    });

    it('does not climb from structural chrome into an app-shell container', () => {
        const {document, core} = page(`
            <main id="app-shell"><header><p id="page-description">A header description.</p></header>
            <section><p id="article-copy">Actual article prose.</p></section></main>
        `);

        expect(core.resolve(document.querySelector('#page-description'))).toBeNull();
        expect(core.resolve(document.querySelector('#article-copy'))?.element.id).toBe('article-copy');
        expect(core.discover(document).map((item) => item.element.id)).toEqual(['article-copy']);
    });

    it('inherits translate=no and contenteditable hard guards', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><main>
                <section translate="no"><p id="no-translate">Do not translate this sentence.</p></section>
                <div contenteditable="true"><p id="editor">Editable sentence.</p></div>
                <p id="allowed">Translate this ordinary sentence.</p>
            </main></body></html>
        `).document);

        expect(ids).toEqual(['allowed']);
    });

    it('preserves inline code/no-translate text without rejecting the outer prose', () => {
        const {document, core} = page(`
            <main><p id="issue-127">Set <code class="notranslate">xxx</code> to enable the feature safely.</p></main>
        `);
        const paragraph = document.querySelector('#issue-127')!;

        expect(core.discover(document).map((item) => item.element)).toContain(paragraph);
        expect(extractTranslationText(paragraph, core.shouldStayOriginal)).toBe('Set to enable the feature safely.');
        expect(core.resolve(document.querySelector('code'))?.element).toBe(paragraph);
    });

    it('keeps MathJax and KaTeX render trees atomic while translating surrounding prose', () => {
        const {document, core} = page(`
            <main><p id="prose">
                Projection prose remains translatable.
                <span id="preview" class="MathJax_Preview">FORMULA_PREVIEW</span>
                <span id="display" class="MathJax_Display" role="math">
                    <span id="mathjax" class="MathJax"><span id="glyph">out=(x/w,y/w,z/w)</span></span>
                </span>
                <script id="tex-source" type="math/tex; mode=display">out = \\begin{pmatrix} x/w \\ y/w \\ z/w \\end{pmatrix}</script>
                <mjx-container id="mathjax-v3"><span>V_clip=M_projection V_local</span></mjx-container>
                <span id="katex" class="katex"><span>KATEX_RENDERED_FORMULA</span></span>
                The explanation continues.
            </p></main>
        `);
        const prose = document.querySelector('#prose') as HTMLElement;
        const protectedNodes = [
            document.querySelector('#preview')!,
            document.querySelector('#display')!,
            document.querySelector('#mathjax')!,
            document.querySelector('#mathjax-v3')!,
            document.querySelector('#katex')!,
            document.querySelector('#tex-source')!,
        ];
        const originalParents = protectedNodes.map((node) => node.parentNode);
        const candidates = core.discover(document);
        const full = candidates.find((candidate) => candidate.element === prose);

        expect(full).toBeDefined();
        expect(full?.nodes).toBeUndefined();
        expect(candidates.filter((candidate) => protectedNodes.includes(candidate.element))).toEqual([]);
        expect(core.resolve(document.querySelector('#glyph'))?.element).toBe(prose);
        expect(evaluateHardGuard(document.querySelector('#glyph')!).reason).toBe('global-filter:数学公式渲染结果');
        expect(evaluateHardGuard(document.querySelector('#mathjax-v3 span')!).reason).toBe('global-filter:数学公式渲染结果');
        expect(evaluateHardGuard(document.querySelector('#katex span')!).reason).toBe('global-filter:数学公式渲染结果');
        expect(evaluateHardGuard(document.querySelector('#tex-source')!).reason).toBe('global-filter:脚本、表单与媒体');

        const readable = extractTranslationText(prose, core.shouldStayOriginal).replace(/\s+/gu, ' ').trim();
        const liveSlots = collectLiveTranslationTextSlots(prose, core.shouldStayOriginal);
        const snapshot = createTranslationSourceSnapshot(prose, core.shouldStayOriginal);
        const payload = snapshot.slots.map((slot) => slot.source).join(' ');

        expect(readable).toBe('Projection prose remains translatable. The explanation continues.');
        expect(liveSlots.map((slot) => slot.source).join(' ')).not.toMatch(
            /FORMULA_PREVIEW|out=|begin\{pmatrix\}|V_clip|KATEX_RENDERED_FORMULA/u,
        );
        expect(payload).not.toMatch(/FORMULA_PREVIEW|out=|begin\{pmatrix\}|V_clip|KATEX_RENDERED_FORMULA/u);

        const rendered = applyTranslationsToSnapshot(
            snapshot,
            snapshot.slots.map((slot) => `译:${slot.source}`),
        );
        const {document: renderedDocument} = parseHTML(`<html><body><p>${rendered}</p></body></html>`);
        expect(renderedDocument.querySelector('#display')?.textContent).toContain('out=(x/w,y/w,z/w)');
        expect(renderedDocument.querySelector('#tex-source')?.textContent).toContain('begin{pmatrix}');
        expect(renderedDocument.querySelector('#mathjax-v3')?.textContent).toBe('V_clip=M_projection V_local');
        expect(renderedDocument.querySelector('#katex')?.textContent).toBe('KATEX_RENDERED_FORMULA');

        // Snapshot/render work is clone-only: live math renderer identities and
        // parents remain untouched for restore and a second translation pass.
        expect(protectedNodes.map((node) => document.getElementById(node.id))).toEqual(protectedNodes);
        expect(protectedNodes.map((node) => node.parentNode)).toEqual(originalParents);
        expect(core.discover(document).find((candidate) => candidate.element === prose)?.nodes).toBeUndefined();
    });

    it('keeps every nested opt-out subtree out of provider text slots', () => {
        const {document, core} = page(`
            <main><p id="target">Translate this
                <span translate="no">API_SECRET</span>
                <span data-notranslate="true">TOKEN</span>
                <span hidden>HIDDEN_TEXT</span>
                <span contenteditable="true">DRAFT_TEXT</span>
                <code>npm publish --token SECRET</code>
                <a href="/original">linked prose</a>
            </p></main>
        `);
        const target = document.querySelector('#target') as HTMLElement;
        const text = extractTranslationText(target, core.shouldStayOriginal);
        const snapshot = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const providerPayload = snapshot.slots.map((slot) => slot.source).join('|');

        expect(text).toContain('Translate this');
        expect(text).toContain('linked prose');
        expect(text).not.toMatch(/API_SECRET|TOKEN|HIDDEN_TEXT|DRAFT_TEXT|npm publish|SECRET/u);
        expect(providerPayload).not.toMatch(/API_SECRET|TOKEN|HIDDEN_TEXT|DRAFT_TEXT|npm publish|SECRET|original/u);

        const rendered = applyTranslationsToSnapshot(
            snapshot,
            snapshot.slots.map((slot) => `译:${slot.source}`),
        );
        const {document: renderedDocument} = parseHTML(`<html><body><p>${rendered}</p></body></html>`);
        expect(renderedDocument.querySelector('code')?.textContent).toBe('npm publish --token SECRET');
        expect(renderedDocument.querySelector('a')?.getAttribute('href')).toBe('/original');
    });

    it('can re-evaluate a synthetic owner without disabling descendant safety guards', () => {
        const {document, core} = page(`
            <span id="synthetic" data-fr-translation-segment="true">
                Visible source
                <span hidden>HIDDEN_TEXT</span>
                <span translate="no">PROTECTED_TEXT</span>
            </span>
        `);
        const synthetic = document.querySelector('#synthetic') as HTMLElement;

        expect(collectLiveTranslationTextSlots(synthetic, core.shouldStayOriginal)).toEqual([]);
        const slots = collectLiveTranslationTextSlots(
            synthetic,
            core.shouldStayOriginal,
            synthetic,
        );

        expect(slots.map((slot) => slot.source)).toEqual(['Visible source']);
        expect(extractTranslationText(synthetic, core.shouldStayOriginal, synthetic)).toBe('Visible source');
    });

    it('applies provider slots to a fresh safe snapshot so current link attributes win', () => {
        const {document, core} = page(`
            <p id="target">Read <a href="/a">the current guide</a>.</p>
        `);
        const target = document.querySelector('#target') as HTMLElement;
        const initial = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const sources = initial.slots.map((slot) => slot.source);

        target.querySelector('a')!.setAttribute('href', '/b');
        const fresh = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const rendered = applyTranslationsToSnapshot(
            fresh,
            sources.map((source) => `译:${source}`),
        );
        const {document: renderedDocument} = parseHTML(`<html><body>${rendered}</body></html>`);

        expect(fresh.slots.map((slot) => slot.source)).toEqual(sources);
        expect(renderedDocument.querySelector('a')?.getAttribute('href')).toBe('/b');
    });

    it('evaluates provider slots against live external ancestors before cloning', () => {
        const {document} = parseHTML(`
            <html><body><div class="private"><p id="target">Translate this
                <span class="secret">EXTERNAL_SECRET</span> safely.</p></div></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'external-private-boundary',
            hosts: ['example.test'],
            keepOriginal: [{selector: '.private .secret', reason: 'private'}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});
        const snapshot = createTranslationSourceSnapshot(
            document.querySelector('#target') as HTMLElement,
            core.shouldStayOriginal,
        );

        expect(snapshot.slots.map((slot) => slot.source).join('|')).not.toContain('EXTERNAL_SECRET');
        expect(snapshot.clone.querySelector('.secret')?.textContent).toBe('EXTERNAL_SECRET');
    });

    it('round-trips several text slots through one strict provider packet', () => {
        const packet = serializeTranslationSlots(['Click ', 'here', ' to continue.'], 'test_nonce');
        const translated = packet.starts.map((start, index) =>
            `${start}${['点击', '这里', '以继续。'][index]}${packet.ends[index]}`).join('\n');

        expect(parseTranslationSlots(packet, translated)).toEqual(['点击', '这里', '以继续。']);
        expect(parseTranslationSlots(packet, `Provider note\n${translated}`)).toBeNull();
        expect(parseTranslationSlots({...packet, ends: packet.ends.slice(1)}, translated)).toBeNull();
        expect(parseTranslationSlots(
            {payload: packet.payload, starts: ['', packet.starts[1]!, packet.starts[2]!], ends: packet.ends},
            translated,
        )).toBeNull();
        expect(serializeTranslationSlots([
            '___FLUENTREAD_test_nonce_0_BEGIN___ collision',
        ], 'test_nonce').starts[0]).toBe('___FLUENTREAD_test_nonce_1_0_BEGIN___');
        expect(serializeTranslationSlots(['Plain text'], '!!!').starts[0])
            .toBe('___FLUENTREAD_slots_0_BEGIN___');
    });

    it('serializes only live readable slots', () => {
        const {document, core} = page(`
            <main><p id="target">
                Leading source
                <span class="fluent-read-loading">Loading state</span>
                <span data-fr-translation-owned="true">Owned output</span>
                <span translate="no">Do not translate</span>
                trailing source
            </p></main>
        `);
        const target = document.querySelector('#target') as HTMLElement;
        const snapshot = createTranslationSourceSnapshot(target, core.shouldStayOriginal);
        const rendered = applyTranslationsToSnapshot(snapshot, ['译:leading']);

        expect(snapshot.slots.map((slot) => slot.source)).toEqual(['Leading source', 'trailing source']);
        expect(snapshot.clone.querySelector('.fluent-read-loading')).toBeNull();
        expect(snapshot.clone.querySelector('[data-fr-translation-owned="true"]')).toBeNull();
        expect(rendered).toContain('译:leading');
        expect(rendered).toContain('trailing source');
        expect(rendered).toContain('Do not translate');
    });

    it('discovers readable content in an open shadow root', () => {
        const {document, core} = page('<main><article-card id="host"></article-card></main>');
        const host = document.querySelector('#host')!;
        const shadowRoot = host.attachShadow({mode: 'open'});
        shadowRoot.innerHTML = '<section><p id="shadow-prose">A sentence rendered by a web component.</p></section>';

        expect(core.discover(document).map((item) => item.element.id)).toContain('shadow-prose');
        expect(core.resolve(shadowRoot.querySelector('#shadow-prose'))?.element.id).toBe('shadow-prose');
    });

    it('translates GitHub PR titles instead of pruning repository-content', () => {
        const {document, core} = page(`
            <main id="repo-content-pjax-container" class="repository-content">
                <div role="group" aria-label="Issues">
                    <a id="pr-title" class="markdown-title" data-hovercard-type="pull_request">
                        Fix quick search during full page translation
                    </a>
                </div>
            </main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const title = document.querySelector('#pr-title')!;
        const candidate = core.discover(document).find((item) => item.element === title);

        expect(candidate).toMatchObject({
            adapterId: 'translation-filter',
            reason: 'site-filter:GitHub Markdown 标题',
        });
        expect(core.resolve(title)?.element).toBe(title);
    });

    it('keeps X usernames out of full and hover translation candidates', () => {
        const {document, core} = page(`
            <main>
                <article>
                    <div id="user-name" data-testid="User-Name">
                        <a href="/example-user">
                            <span>Example User</span>
                            <span>@example_user</span>
                        </a>
                    </div>
                    <div id="tweet-text" data-testid="tweetText">Translate this X post.</div>
                </article>
            </main>
        `, 'https://x.com/home');
        const userName = document.querySelector('#user-name')!;
        const tweetText = document.querySelector('#tweet-text')!;

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual(['tweet-text']);
        expect(core.discover(document).find((candidate) => candidate.element === tweetText))
            .toMatchObject({adapterId: 'translation-filter', reason: 'site-filter:X 帖子正文'});
        expect(core.resolve(userName.querySelector('span')?.firstChild)).toBeNull();
        expect(core.resolve(tweetText.firstChild)?.element).toBe(tweetText);
    });

    it('keeps an exact adapter target out of an ancestor inline run', () => {
        const {document, core} = page(`
            <main><div id="row">
                <a id="pr-title" class="markdown-title">Fix partial pull-request translation</a>
                <p>Block child that makes the row produce an inline run.</p>
            </div></main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const candidates = [...core.discoverSteps(document)]
            .flatMap((step) => step.candidate ? [step.candidate] : []);
        const explicit = candidates.find((candidate) => candidate.adapterId === 'translation-filter')!;
        const generic = candidates.find((candidate) =>
            candidate.nodes?.includes(document.querySelector('#pr-title') as ChildNode));
        const genericEquivalent = {...explicit, adapterId: undefined, reason: 'generic-inline-run'};

        expect(explicit).toBeDefined();
        expect(generic).toBeUndefined();
        expect(selectPreferredTranslationCandidate(explicit, genericEquivalent)).toBe(explicit);
        expect(selectPreferredTranslationCandidate(genericEquivalent, explicit)).toBe(explicit);
        expect(core.discover(document).find((candidate) => candidate.element.id === 'pr-title'))
            .toMatchObject({
                adapterId: 'translation-filter',
                reason: 'site-filter:GitHub Markdown 标题',
            });
    });

    it('keeps ordinary inline siblings when an atomic target is the only barrier', () => {
        const {document, core} = page(`
            <main><div id="row">Readable prose before the title.
                <a id="pr-title" class="markdown-title">Fix partial pull-request translation</a>
                Readable prose after the title.</div></main>
        `, 'https://github.com/immersive-translate/immersive-translate/pulls');
        const row = document.querySelector('#row')!;
        const title = document.querySelector('#pr-title')!;
        const before = row.childNodes[0]!;
        const after = row.childNodes[2]!;
        const candidates = core.discover(document);
        const inlineRuns = candidates.filter((candidate) => candidate.reason === 'generic-inline-run');

        expect(candidates.find((candidate) => candidate.element === title))
            .toMatchObject({
                adapterId: 'translation-filter',
                reason: 'site-filter:GitHub Markdown 标题',
            });
        expect(inlineRuns.map((candidate) => candidate.nodes)).toEqual([[before], [after]]);
        expect(core.resolve(before)?.nodes).toEqual([before]);
        expect(core.resolve(title)?.element).toBe(title);
        expect(core.resolve(after)?.nodes).toEqual([after]);
    });

    it('prefers an atomic self target over inline runs inside that target', () => {
        const {document} = parseHTML(`
            <html><body><main><div id="forced">Readable direct introduction.
                <p>Readable nested block.</p></div></main></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'atomic-mixed-target',
            hosts: ['example.test'],
            targets: [{selector: '#forced', reason: 'atomic-mixed-target', atomic: true}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});
        const forced = document.querySelector('#forced')!;
        const directText = forced.firstChild!;

        expect(core.discover(document)).toEqual([
            expect.objectContaining({element: forced, adapterId: 'atomic-mixed-target'}),
        ]);
        expect(core.resolve(directText)).toMatchObject({
            element: forced,
            adapterId: 'atomic-mixed-target',
        });
        expect(core.resolve(directText)?.nodes).toBeUndefined();
    });

    it('prunes GitHub quick-search controlled UI', () => {
        const {document, core} = page(`
            <main><dialog open aria-label="Quick search"><p id="search-result">Search suggestion text.</p></dialog>
            <p id="body-copy">Repository body sentence.</p></main>
        `, 'https://github.com/FluentRead/FluentRead/pulls');

        const ids = core.discover(document).map((item) => item.element.id);
        expect(ids).not.toContain('search-result');
        expect(ids).toContain('body-copy');
        expect(core.resolve(document.querySelector('#search-result')?.firstChild)).toBeNull();
    });

    it('translates GitHub markdown prose inside live-updatable conversation containers', () => {
        const {document, core} = page(`
            <main>
                <div class="js-socket-channel js-updatable-content">
                    <div class="comment-body markdown-body">
                        <h2 id="change-heading">What changed</h2>
                        <ul><li id="change-item">Preserve Quick Search during translation.</li></ul>
                        <p id="change-reason">GitHub mounts the search interface dynamically.</p>
                    </div>
                </div>
            </main>
        `, 'https://github.com/immersive-translate/immersive-translate/pull/4038');

        const candidates = core.discover(document);
        const ids = candidates.map((item) => item.element.id);
        expect(ids).toEqual(expect.arrayContaining(['change-heading', 'change-item', 'change-reason']));
        expect(candidates.filter((item) => item.adapterId === 'translation-filter')).toHaveLength(3);
        expect(core.shouldStayOriginal(document.querySelector('#change-heading')!)).toBe(false);
        expect(core.shouldIgnoreMutation(document.querySelector('#change-heading')!)).toBe(false);
    });

    it.each(['header', 'nav', 'aside', 'footer'])(
        'keeps a linked H1 translatable inside structural <%s> chrome',
        (containerTag) => {
            const {document, core} = page(`
                <${containerTag}>
                    <h1 id="page-heading"><a href="/guide"><span>Project setup guide</span></a></h1>
                    <p id="chrome-copy">Account navigation copy.</p>
                </${containerTag}>
            `, 'https://example.test/docs');
            const heading = document.querySelector('#page-heading')!;

            expect(core.discover(document)).toEqual([
                expect.objectContaining({element: heading, reason: 'generic-readable-block'}),
            ]);
            expect(core.resolve(document.querySelector('#page-heading span')?.firstChild)).toMatchObject({
                element: heading,
                reason: 'generic-readable-block',
            });
            expect(core.resolve(document.querySelector('#chrome-copy')?.firstChild)).toBeNull();
        },
    );

    it('keeps heading text beside an interactive control as its own inline run', () => {
        const {document, core} = page(`
            <main>
                <h1 id="page-heading">Install FluentRead <button id="copy-button">Copy</button></h1>
            </main>
        `, 'https://example.test/docs');
        const headingText = document.querySelector('#page-heading')?.firstChild;
        const button = document.querySelector('#copy-button')!;
        const candidates = core.discover(document);
        const heading = candidates.find((candidate) => candidate.element.id === 'page-heading');

        expect(candidates.map((candidate) => candidate.element.id)).toEqual(['copy-button', 'page-heading']);
        expect(heading?.nodes).toEqual([headingText]);
        expect(heading?.nodes).not.toContain(button);
        expect(core.resolve(headingText)).toMatchObject({element: document.querySelector('#page-heading')});
        expect(core.resolve(button)).toMatchObject({element: button, kind: 'control'});
    });

    it('keeps mutation exclusion separate from translation exclusion', () => {
        const {document} = parseHTML(`
            <html><body><main>
                <div id="ticker"><p id="dynamic-copy">A controlled live result.</p></div>
                <p id="static-copy">A stable article sentence.</p>
            </main></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'controlled-ui',
            hosts: ['example.test'],
            mutationExclude: [{selector: '#ticker', reason: 'controlled-live-region'}],
        });
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [adapter],
        });
        const ticker = document.querySelector('#ticker')!;
        const copy = document.querySelector('#dynamic-copy')!;

        expect(core.shouldIgnoreMutation(ticker)).toBe(true);
        expect(core.shouldIgnoreMutation(copy)).toBe(true);
        expect(core.shouldStayOriginal(copy)).toBe(false);
        expect(core.discover(document).map((item) => item.element.id)).toContain('dynamic-copy');
    });

    it('keeps GNU Texinfo navigation panels original while targeting prose', () => {
        const {document, core} = page(`
            <div class="section-level-extent">
                <div class="nav-panel"><p id="navigation">Next: Definitions, Up: Introduction</p></div>
                <p id="manual-copy">Bash is a command language interpreter for the GNU operating system.</p>
            </div>
        `, 'https://www.gnu.org/software/bash/manual/html_node/What-is-Bash_003f.html');

        expect(core.discover(document).map((item) => item.element.id)).toEqual(['manual-copy']);
        expect(core.resolve(document.querySelector('#navigation'))).toBeNull();
    });

    it('preserves registration order for equal adapter priorities', () => {
        const {document} = parseHTML('<html><body><main><p id="safe">Readable fallback prose.</p></main></body></html>');
        const first = createDeclarativeAdapter({
            id: 'z-first-registered',
            priority: 50,
            hosts: ['example.test'],
            targets: [{selector: '#safe', reason: 'first-wins'}],
        });
        const second = createDeclarativeAdapter({
            id: 'a-second-registered',
            priority: 50,
            hosts: ['example.test'],
            targets: [{selector: '#safe', reason: 'second-loses'}],
        });
        const core = createTranslationCore({
            url: new URL('https://example.test'),
            adapters: [first, second],
        });

        expect(core.discover(document)[0]).toMatchObject({
            adapterId: 'z-first-registered',
            reason: 'first-wins',
        });
    });

    it('continues into children when a forced target is stale or explicitly non-atomic', () => {
        const {document} = parseHTML(`
            <html><body><main><div id="wrapper">Readable direct intro.
                <p id="child">Readable child paragraph.</p></div>
            <div id="empty"></div></main></body></html>
        `);
        const stale = {
            id: 'stale-target',
            matches: () => true,
            decide: (element: Element) => element.id === 'wrapper'
                ? {kind: 'force-target' as const, target: document.querySelector('#empty')!, reason: 'stale'}
                : {kind: 'pass' as const},
        };
        const nonAtomic = {
            id: 'non-atomic-target',
            matches: () => true,
            decide: (element: Element) => element.id === 'wrapper'
                ? {kind: 'force-target' as const, reason: 'container', atomic: false}
                : {kind: 'pass' as const},
        };

        const staleCore = createTranslationCore({url: new URL('https://example.test'), adapters: [stale]});
        expect(staleCore.discover(document).map((candidate) => candidate.element.id)).toContain('child');

        const nonAtomicCore = createTranslationCore({url: new URL('https://example.test'), adapters: [nonAtomic]});
        const candidates = nonAtomicCore.discover(document);
        expect(candidates.map((candidate) => candidate.element.id)).toEqual(['child', 'wrapper']);
        expect(candidates.find((candidate) => candidate.element.id === 'wrapper')?.nodes).toHaveLength(1);
        expect(nonAtomicCore.resolve(document.querySelector('#child'))?.element.id).toBe('child');
        expect(nonAtomicCore.resolve(document.querySelector('#wrapper')?.firstChild)?.nodes)
            .toEqual(candidates.find((candidate) => candidate.element.id === 'wrapper')?.nodes);
    });

    it('allows an adapter to force the same structural target for full and hover', () => {
        const {document} = parseHTML(`
            <html><body><header id="forced"><span id="hit">Readable structural prose.</span></header></body></html>
        `);
        const adapter = createDeclarativeAdapter({
            id: 'forced-header',
            hosts: ['example.test'],
            targets: [{selector: '#forced', reason: 'explicit-header', atomic: true}],
        });
        const core = createTranslationCore({url: new URL('https://example.test'), adapters: [adapter]});

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual(['forced']);
        expect(core.resolve(document.querySelector('#hit'))?.element.id).toBe('forced');
    });

    it('filters identifiers and pure numeric metadata', () => {
        const ids = candidateIds(parseHTML(`
            <html><body><main>
                <p id="hash">a1b2c3d4</p>
                <p id="number">2026-08-18</p>
                <p id="words">A meaningful release description.</p>
            </main></body></html>
        `).document);

        expect(ids).toEqual(['words']);
    });

    it('only skips short text when the target script is clear', () => {
        expect(isClearlyTargetLanguage('翻译设置', 'zh-CN')).toBe(true);
        expect(isClearlyTargetLanguage('設定を翻訳', 'ja-JP')).toBe(true);
        expect(isClearlyTargetLanguage('설정 번역', 'ko-KR')).toBe(true);
        expect(isClearlyTargetLanguage('Pull requests', 'zh-CN')).toBe(false);
        expect(isClearlyTargetLanguage('API', 'zh-CN')).toBe(false);
        expect(isClearlyTargetLanguage('Settings', 'en')).toBe(true);
        expect(isClearlyTargetLanguage('漢字', 'en')).toBe(false);
        expect(isClearlyTargetLanguage('', 'zh-CN')).toBe(true);
        expect(isClearlyTargetLanguage('Paramètres', 'fr')).toBe(false);
        expect(isClearlyTargetLanguage('2026-08-25', 'en')).toBe(true);
        expect(isMeaningfulTranslationText('!!!')).toBe(false);
        expect(isMeaningfulTranslationText('https://example.test/docs')).toBe(false);
        expect(isMeaningfulTranslationText('dev@example.test')).toBe(false);
        expect(isMeaningfulTranslationText('@maintainer')).toBe(false);
        expect(isMeaningfulTranslationText('u/reader')).toBe(false);
        expect(isMeaningfulTranslationText('#1234')).toBe(false);
        expect(isMeaningfulTranslationText('translationCore.ts')).toBe(false);
        expect(isMeaningfulTranslationText('Readable article summary')).toBe(true);
    });

    it('scopes current-core wrappers to the page URL', () => {
        const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
        const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const {document} = parseHTML('<html><body><main><p id="target">Readable current page text.</p></main></body></html>');
        const target = document.querySelector('#target')!;

        try {
            Object.defineProperty(globalThis, 'location', {
                configurable: true,
                value: {href: 'https://example.test/first'},
            });
            const firstCore = getCurrentTranslationCore();
            expect(getCurrentTranslationCore()).toBe(firstCore);
            expect(resolveTranslationCandidate(target.firstChild)?.element).toBe(target);

            Object.defineProperty(globalThis, 'location', {
                configurable: true,
                value: {href: 'https://example.test/second'},
            });
            expect(getCurrentTranslationCore()).not.toBe(firstCore);

            Object.defineProperty(document, 'elementFromPoint', {
                configurable: true,
                value: () => target,
            });
            Object.defineProperty(globalThis, 'document', {
                configurable: true,
                value: document,
            });
            expect(resolveTranslationCandidateAtPoint(1, 2)?.element).toBe(target);
        } finally {
            if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
            else Reflect.deleteProperty(globalThis, 'location');
            if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
            else Reflect.deleteProperty(globalThis, 'document');
        }
    });

    it('resolves DOM points across document and open shadow roots', () => {
        const {document} = parseHTML(`
            <html><body><main>
                <article-card id="host"></article-card>
                <p id="point">Point target text.</p>
            </main></body></html>
        `);
        const host = document.querySelector('#host')!;
        const point = document.querySelector('#point')!;
        const firstShadow = host.attachShadow({mode: 'open'});
        firstShadow.innerHTML = '<nested-card id="nested"></nested-card>';
        const nested = firstShadow.querySelector('#nested')!;
        const secondShadow = nested.attachShadow({mode: 'open'});
        secondShadow.innerHTML = '<p id="shadow-copy">Nested shadow text.</p>';
        expect(getOpenShadowRoots(document)).toEqual([firstShadow, secondShadow]);

        Object.defineProperty(document, 'elementsFromPoint', {
            configurable: true,
            value: () => [point],
        });
        expect(findElementsAtPoint(document, 10, 20)).toEqual([point]);

        Object.defineProperty(document, 'elementsFromPoint', {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: () => point,
        });
        expect(findElementsAtPoint(document, 10, 20)).toEqual([point]);

        Object.defineProperty(document, 'caretPositionFromPoint', {
            configurable: true,
            value: () => ({offsetNode: point.firstChild}),
        });
        expect(findNodeAtPoint(document, 10, 20)).toBe(point.firstChild);

        Object.defineProperty(document, 'caretPositionFromPoint', {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(document, 'caretRangeFromPoint', {
            configurable: true,
            value: () => ({startContainer: point.firstChild}),
        });
        expect(findNodeAtPoint(document, 10, 20)).toBe(point.firstChild);

        const core = createTranslationCore({url: new URL('https://example.test')});
        const shadowTarget = secondShadow.querySelector('#shadow-copy')!;
        Object.defineProperty(firstShadow, 'elementFromPoint', {
            configurable: true,
            value: () => nested,
        });
        Object.defineProperty(secondShadow, 'elementFromPoint', {
            configurable: true,
            value: () => shadowTarget,
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: () => host,
        });
        Object.defineProperty(document, 'caretRangeFromPoint', {
            configurable: true,
            value: () => ({startContainer: shadowTarget.firstChild}),
        });
        expect(core.resolveAtPoint(document, 10, 20)?.element).toBe(shadowTarget);
    });

    it('honors declarative host and path gates', () => {
        const adapter = createDeclarativeAdapter({
            id: 'path-gated',
            hosts: [{hostname: 'example.test', includeSubdomains: true}],
            pathnames: [/^\/docs\//u],
            targets: [{selector: '.article-copy', reason: 'path-copy'}],
            keepOriginal: [{selector: '.token', reason: 'secret'}],
            mutationExclude: [{selector: '.live-widget', reason: 'dynamic'}],
        });
        const {document} = parseHTML(`
            <html><body><main>
                <p class="article-copy" id="copy">Readable article text.</p>
                <code class="token" id="token">API_TOKEN</code>
                <div class="live-widget" id="widget"></div>
            </main></body></html>
        `);

        expect(adapter.matches(new URL('https://sub.example.test/docs/page'))).toBe(true);
        expect(adapter.matches(new URL('https://sub.example.test/blog'))).toBe(false);
        expect(adapter.matches(new URL('https://other.test/docs/page'))).toBe(false);
        expect(adapter.decide(document.querySelector('#copy')!, {url: new URL('https://sub.example.test/docs/page')}))
            .toMatchObject({kind: 'force-target', reason: 'path-copy'});
        expect(adapter.shouldStayOriginal?.(document.querySelector('#token')!, {url: new URL('https://sub.example.test/docs/page')}))
            .toBe(true);
        expect(adapter.shouldIgnoreMutation?.(document.querySelector('#widget')!, {url: new URL('https://sub.example.test/docs/page')}))
            .toBe(true);
    });

    it('keeps hover resolution inside owned wrappers', () => {
        const {document, core} = page(`
            <main><div id="parent">
                Intro text.
                <span data-fr-translation-segment="true" id="owned-run">Owned translated run.</span>
                <span class="fluent-read-bilingual-content" id="bilingual">Existing translation.</span>
                <span class="fluent-read-loading" id="extension-ui"><span id="extension-child">Loading</span></span>
            </div></main>
        `);
        const parent = document.querySelector('#parent')!;
        const ownedRun = document.querySelector('#owned-run')!;
        const bilingual = document.querySelector('#bilingual')!;
        const extensionUi = document.querySelector('#extension-ui')!;
        const extensionChild = document.querySelector('#extension-child')!;

        expect(core.resolve(ownedRun.firstChild)).toMatchObject({element: ownedRun, reason: 'owned-inline-run'});
        expect(core.resolve(bilingual.firstChild)?.element).toBe(parent);
        expect(core.resolve(extensionUi)?.element).toBe(parent);
        expect(core.resolve(extensionUi.firstChild)?.element).toBe(parent);
        expect(core.resolve(extensionChild.firstChild)?.element).toBe(parent);
    });
});

describe('embedded semantic chrome classification', () => {
    it('discovers and hover-resolves both Swift DocC note paragraphs without admitting a top-level aside', () => {
        const {document, core} = page(`
            <aside id="global-aside">
                <p id="global-aside-copy">Related documentation and page tools.</p>
            </aside>
            <main id="app-main">
                <div class="doc-content-wrapper">
                    <div class="primary-content">
                        <div class="content">
                            <aside class="note">
                                <p id="note-label">Note</p>
                                <p id="note-copy">The remainder operator <code>%</code> keeps the sign of the first value.</p>
                            </aside>
                        </div>
                    </div>
                </div>
            </main>
        `, 'https://docs.swift.org/swift-book/documentation/the-swift-programming-language/basicoperators/');
        const noteLabel = document.querySelector('#note-label')!;
        const noteCopy = document.querySelector('#note-copy')!;
        const globalCopy = document.querySelector('#global-aside-copy')!;
        const candidates = core.discover(document);

        expect(
            candidates.map((candidate) => candidate.element.id),
            'Swift DocC callouts must expose both the note label and prose during full-document discovery',
        ).toEqual(['note-label', 'note-copy']);
        expect(core.resolve(noteLabel.firstChild), 'Hover must resolve the Swift note label').toMatchObject({
            element: noteLabel,
            reason: 'generic-readable-block',
        });
        expect(core.resolve(noteCopy.firstChild), 'Hover must resolve the Swift note prose').toMatchObject({
            element: noteCopy,
            reason: 'generic-readable-block',
        });
        expect(
            core.resolve(globalCopy.firstChild),
            'A body-level related-tools aside must remain structural chrome',
        ).toBeNull();
    });

    it('keeps article-owned asides and role=main notes while nav and metadata chrome remain structural', () => {
        const {document, core} = page(`
            <article>
                <header><p id="article-header-copy">A contextual introduction for this chapter.</p></header>
                <aside><p id="article-aside-copy">A related explanation owned by this article.</p></aside>
                <nav><p id="article-nav-copy">Previous and next chapter links.</p></nav>
                <footer><p id="article-footer-copy">A contextual conclusion for this chapter.</p></footer>
            </article>
            <div role="main">
                <aside role="note"><p id="role-main-note-copy">A semantic note inside the main reading surface.</p></aside>
                <aside><p id="role-main-tools-copy">Related tools outside the prose flow.</p></aside>
            </div>
        `);
        const ids = core.discover(document).map((candidate) => candidate.element.id);

        expect(ids, 'Article-owned asides and role=main notes must remain readable').toEqual([
            'article-aside-copy',
            'role-main-note-copy',
        ]);
        for (const chromeId of [
            'article-header-copy',
            'article-nav-copy',
            'article-footer-copy',
            'role-main-tools-copy',
        ]) {
            expect(ids, `${chromeId} must remain structural chrome`).not.toContain(chromeId);
        }
    });
});
