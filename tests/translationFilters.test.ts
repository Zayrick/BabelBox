import {parseHTML} from 'linkedom';
import {describe, expect, it} from 'vitest';
import {normalizeConfig} from '@/src/core/config/model';
import {
    createDefaultTranslationFilterConfig,
    createTranslationCore,
    createTranslationFilterPolicy,
    configureCurrentTranslationFilters,
    extractTranslationText,
    getTranslationFilterSite,
    getCurrentTranslationCore,
    normalizeTranslationFilterConfig,
    normalizeTranslationFilterRules,
    removeTranslationFilterSite,
    reorderTranslationFilterRules,
    type TranslationFilterConfig,
} from '@/src/core/translation/public';

function documentWith(html: string): Document {
    return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

function emptyFilters(): TranslationFilterConfig {
    return {
        global: {excludeHidden: false, excludeEditable: false, rules: []},
        sites: [],
    };
}

describe('translation filter configuration', () => {
    it('exposes the global protections as editable defaults', () => {
        const defaults = createDefaultTranslationFilterConfig();

        expect(defaults.global.excludeHidden).toBe(true);
        expect(defaults.global.excludeEditable).toBe(true);
        expect(defaults.global.rules.map((rule) => rule.label)).toEqual([
            '脚本、表单与媒体',
            '代码与等宽文本',
            '网页声明不翻译',
            '数学公式渲染结果',
        ]);
    });

    it('backfills defaults only when fields are missing and preserves explicit empty lists', () => {
        expect(normalizeTranslationFilterConfig(undefined).sites.map((site) => site.domain))
            .toContain('discord.com');
        expect(normalizeTranslationFilterConfig({global: {rules: []}, sites: []})).toMatchObject({
            global: {rules: []},
            sites: [],
        });

        expect(normalizeConfig({}).translationFilter.sites.map((site) => site.domain))
            .toContain('discord.com');
        expect(normalizeConfig({
            translationFilter: {
                global: {excludeHidden: false, excludeEditable: false, rules: []},
                sites: [],
            },
        }).translationFilter).toEqual(emptyFilters());
    });

    it('normalizes domains and keeps the first action for an exact selector', () => {
        const normalized = normalizeTranslationFilterConfig({
            global: {
                excludeHidden: true,
                excludeEditable: true,
                rules: [
                    {action: 'exclude', selector: '.duplicate'},
                    {action: 'invalid', selector: '.ignored'},
                    {action: 'include', selector: ' .duplicate ', label: 'Latest'},
                ],
            },
            sites: [
                {domain: 'https://chat.docs.example.com/path', rules: []},
                {domain: 'example.com', rules: [{action: 'exclude', selector: '.ignored-duplicate-site'}]},
                {domain: 'not a domain', rules: []},
            ],
        });

        expect(normalized.global.rules).toEqual([{
            action: 'exclude',
            selector: '.duplicate',
        }]);
        expect(normalized.sites).toEqual([{domain: 'example.com', rules: []}]);
        expect(normalizeTranslationFilterRules('invalid')).toEqual([]);
    });

    it('derives mutation attributes from configurable selectors', () => {
        const policy = createTranslationFilterPolicy({
            global: {
                excludeHidden: true,
                excludeEditable: true,
                rules: [{action: 'exclude', selector: '#panel[data-state="closed"]:lang(en)'}],
            },
            sites: [{domain: 'discord.com', rules: [{
                action: 'include',
                selector: '[data-list-item-id^="channels___"][aria-expanded]',
            }]}],
        }, 'https://discord.com/channels/1/2');

        expect(policy.observedAttributes).toEqual(expect.arrayContaining([
            'id', 'data-state', 'lang', 'data-list-item-id', 'aria-expanded',
        ]));
    });

    it('keeps a deleted default website deleted after normalization', () => {
        const withoutDiscord = removeTranslationFilterSite(
            createDefaultTranslationFilterConfig(),
            'discord.com',
        );

        expect(getTranslationFilterSite(withoutDiscord, 'https://discord.com/channels/1/2')).toBeNull();
        expect(getTranslationFilterSite(
            normalizeTranslationFilterConfig(withoutDiscord),
            'https://discord.com/channels/1/2',
        )).toBeNull();
    });
});

describe('translation filter policy', () => {
    it('persists reordered rules and gives the earlier matching rule priority', () => {
        const document = documentWith('<button class="target">Channel category</button>');
        const rules = [
            {action: 'exclude' as const, selector: '.target', label: 'Exclude target'},
            {action: 'include' as const, selector: 'button', label: 'Include buttons'},
        ];
        const target = document.querySelector('.target')!;

        expect(createTranslationFilterPolicy({
            ...emptyFilters(),
            global: {...emptyFilters().global, rules},
        }).evaluateElement(target).action).toBe('exclude');

        const reordered = reorderTranslationFilterRules(rules, 1, 0);
        const restored = normalizeTranslationFilterConfig(JSON.parse(JSON.stringify({
            ...emptyFilters(),
            global: {...emptyFilters().global, rules: reordered},
        })));

        expect(reordered.map((rule) => rule.label)).toEqual(['Include buttons', 'Exclude target']);
        expect(createTranslationFilterPolicy(restored).evaluateElement(target).action).toBe('include');
    });

    it('invalidates the shared URL core when runtime filter configuration changes', () => {
        const initial = getCurrentTranslationCore();
        const custom = {
            ...emptyFilters(),
            global: {
                excludeHidden: false,
                excludeEditable: false,
                rules: [{action: 'include' as const, selector: '.shared-filter-target'}],
            },
        };

        try {
            expect(configureCurrentTranslationFilters(custom)).toBe(true);
            const configured = getCurrentTranslationCore();
            const document = documentWith('<nav><div class="shared-filter-target">Shared target</div></nav>');

            expect(configured).not.toBe(initial);
            expect(configured.inspect(document.querySelector('.shared-filter-target')!).candidate)
                .toMatchObject({adapterId: 'translation-filter'});
            expect(configureCurrentTranslationFilters(custom)).toBe(false);
        } finally {
            configureCurrentTranslationFilters(createDefaultTranslationFilterConfig());
        }
    });

    it('lets users remove the default code protection instead of enforcing it in DOM code', () => {
        const document = documentWith('<main><p id="copy">Run <code>npm test now</code> safely.</p></main>');
        const core = createTranslationCore({
            url: new URL('https://example.com/'),
            filterConfig: emptyFilters(),
        });
        const paragraph = document.querySelector('#copy')!;

        expect(core.discover(document).map((candidate) => candidate.element)).toContain(paragraph);
        expect(extractTranslationText(paragraph, core.shouldStayOriginal)).toBe('Run npm test now safely.');
    });

    it('does not reapply deleted website defaults through a hardcoded adapter', () => {
        const document = documentWith(`
          <main>
            <dialog open><p id="search-result">Search suggestion text.</p></dialog>
            <p id="body-copy">Repository body sentence.</p>
          </main>
        `);
        const core = createTranslationCore({
            url: new URL('https://github.com/example/project'),
            filterConfig: emptyFilters(),
        });

        expect(core.discover(document).map((candidate) => candidate.element.id))
            .toEqual(expect.arrayContaining(['search-result', 'body-copy']));
    });

    it('applies custom global exclusions to discovery and provider text', () => {
        const document = documentWith(`
            <main>
              <p id="copy">Visible prose <span class="secret">PRIVATE TOKEN</span> continues.</p>
              <p class="secret" id="whole">Whole private paragraph.</p>
            </main>
        `);
        const core = createTranslationCore({
            url: new URL('https://example.com/'),
            filterConfig: {
                ...emptyFilters(),
                global: {
                    excludeHidden: false,
                    excludeEditable: false,
                    rules: [{action: 'exclude', selector: '.secret'}],
                },
            },
        });
        const copy = document.querySelector('#copy')!;

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual(['copy']);
        expect(extractTranslationText(copy, core.shouldStayOriginal)).toBe('Visible prose continues.');
    });

    it('lets a website rule override a global rule on the same element', () => {
        const document = documentWith('<nav><div class="target" role="button">Channel category</div></nav>');
        const core = createTranslationCore({
            url: new URL('https://chat.example.com/room'),
            filterConfig: {
                global: {
                    excludeHidden: false,
                    excludeEditable: false,
                    rules: [{action: 'exclude', selector: '.target'}],
                },
                sites: [{
                    domain: 'example.com',
                    rules: [{action: 'include', selector: '.target', label: 'Channel category'}],
                }],
            },
        });
        const target = document.querySelector('.target')!;

        expect(core.inspect(target).candidate).toMatchObject({
            element: target,
            kind: 'control',
            adapterId: 'translation-filter',
            reason: 'site-filter:Channel category',
        });
    });

    it('does not reopen a child below an excluded parent', () => {
        const document = documentWith('<nav class="shell"><div class="target">Channel category</div></nav>');
        const core = createTranslationCore({
            url: new URL('https://example.com/room'),
            filterConfig: {
                global: {
                    excludeHidden: false,
                    excludeEditable: false,
                    rules: [{action: 'exclude', selector: '.shell'}],
                },
                sites: [{domain: 'example.com', rules: [{action: 'include', selector: '.target'}]}],
            },
        });

        expect(core.inspect(document.querySelector('.target')!).candidate).toBeNull();
        expect(core.discover(document)).toEqual([]);
    });

    it('fails closed for an invalid selector without aborting valid rules', () => {
        const document = documentWith('<main><p class="skip">Skip this prose.</p><p id="keep">Keep this prose.</p></main>');
        const core = createTranslationCore({
            url: new URL('https://example.com/'),
            filterConfig: {
                ...emptyFilters(),
                global: {
                    excludeHidden: false,
                    excludeEditable: false,
                    rules: [
                        {action: 'exclude', selector: '::not-valid('},
                        {action: 'exclude', selector: '.skip'},
                    ],
                },
            },
        });

        expect(core.discover(document).map((candidate) => candidate.element.id)).toEqual(['keep']);
    });

    it('translates Discord conversation content without translating identity metadata', () => {
        const document = documentWith(`
          <nav>
            <div id="channel-category" data-list-item-id="channels___category" role="button" aria-expanded="true">
              <h3>Language Specific</h3>
            </div>
          </nav>
          <div data-list-id="members-channel">Member Name</div>
          <ol data-list-id="chat-messages">
            <div id="chat-messages-thread"><h3 id="thread-title">Thread setup guide</h3></div>
            <li>
              <div role="article" data-list-item-id="chat-messages___chat-messages-channel-message">
                <h3><span id="message-username-message">User Name <span>MOD</span></span></h3>
                <div id="message-content-message">
                  Message before <span class="mention">@Mentioned User</span> message after.
                </div>
                <div id="message-accessories-message">
                  <div class="embedAuthor__hash">Bot Name</div>
                  <div id="embed-title" class="embedTitle__hash">Release notes</div>
                  <div class="embedFooter__hash">By Bot Name</div>
                </div>
              </div>
            </li>
          </ol>
          <div role="grid">
            <li>
              <div role="gridcell"></div>
              <div>
                <a role="link" aria-label="Gallery Author, post author">Gallery Author</a>
                <h3 id="gallery-title">Gallery post title</h3>
              </div>
            </li>
          </div>
          <div role="list">
            <li>
              <div>
                <div role="button" aria-label="Post List post title"></div>
                <div>
                  <h3 id="list-title">List post title</h3>
                  <a role="link" aria-label="List Author, post author">List Author</a>
                </div>
              </div>
            </li>
          </div>
        `);
        const core = createTranslationCore({
            url: new URL('https://discord.com/channels/699861463375937578/1071250182664093706'),
            filterConfig: createDefaultTranslationFilterConfig(),
        });
        const candidates = core.discover(document);
        const candidateIds = candidates
            .map((candidate) => candidate.element.id)
            .filter(Boolean);
        const category = document.querySelector('#channel-category')!;

        expect(extractTranslationText(category, core.shouldStayOriginal)).toBe('Language Specific');
        expect(candidateIds).toEqual(expect.arrayContaining([
            'channel-category',
            'thread-title',
            'message-content-message',
            'embed-title',
            'gallery-title',
            'list-title',
        ]));
        expect(extractTranslationText(
            document.querySelector('#message-content-message')!,
            core.shouldStayOriginal,
        )).toBe('Message before message after.');

        const translatedText = candidates
            .map((item) => extractTranslationText(item.element, core.shouldStayOriginal))
            .join('\n');
        expect(translatedText).not.toMatch(
            /Member Name|User Name|Mentioned User|MOD|Bot Name|Gallery Author|List Author/,
        );
    });
});
