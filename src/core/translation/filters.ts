import {getSiteBaseDomain} from '@/src/core/site-rules/domain';

export type TranslationFilterRuleAction = 'exclude' | 'include';

export interface TranslationFilterRule {
    action: TranslationFilterRuleAction;
    selector: string;
    label?: string;
}

export interface TranslationFilterGlobalConfig {
    excludeHidden: boolean;
    excludeEditable: boolean;
    rules: TranslationFilterRule[];
}

export interface TranslationFilterSiteConfig {
    domain: string;
    rules: TranslationFilterRule[];
}

export interface TranslationFilterConfig {
    global: TranslationFilterGlobalConfig;
    sites: TranslationFilterSiteConfig[];
}

export type TranslationFilterDecision =
    | {action: 'pass'}
    | {action: TranslationFilterRuleAction; reason: string};

export interface TranslationFilterPolicy {
    readonly config: TranslationFilterConfig;
    readonly site: TranslationFilterSiteConfig | null;
    readonly observedAttributes: readonly string[];
    evaluateElement(element: Element): TranslationFilterDecision;
    isExcludedSelf(element: Element): boolean;
    isIncludedSelf(element: Element): boolean;
}

export const MAX_TRANSLATION_FILTER_RULES = 100;
export const MAX_TRANSLATION_FILTER_SITES = 50;
export const MAX_TRANSLATION_FILTER_SELECTOR_LENGTH = 500;
export const MAX_TRANSLATION_FILTER_LABEL_LENGTH = 80;

const defaultGlobalRules: readonly TranslationFilterRule[] = [
    {
        action: 'exclude',
        label: '脚本、表单与媒体',
        selector: [
            'head', 'script', 'style', 'noscript', 'iframe', 'input', 'textarea',
            'select', 'option', 'math', 'svg', 'canvas', 'audio', 'video', 'object',
            'template', 'xmp',
        ].join(', '),
    },
    {
        action: 'exclude',
        label: '代码与等宽文本',
        selector: 'pre, code, kbd, samp, var',
    },
    {
        action: 'exclude',
        label: '网页声明不翻译',
        selector: '.notranslate, [translate="no"], [data-notranslate="true"]',
    },
    {
        action: 'exclude',
        label: '数学公式渲染结果',
        selector: 'mjx-container, .MathJax_Display, .MathJax, .MathJax_Preview, .katex',
    },
];

const githubDefaultRules: readonly TranslationFilterRule[] = [
    {
        action: 'exclude',
        label: 'GitHub 交互式对话框',
        selector: [
            'dialog', '[role="dialog"]', '[data-testid="search-modal"]',
            '[data-target="query-builder.queryBuilder"]',
            '[data-target="qbsearch-input.queryBuilder"]',
            '.js-command-palette-dialog', '#command-palette-pjax-container',
        ].join(', '),
    },
    {
        action: 'exclude',
        label: 'GitHub 快速搜索',
        selector: [
            'form[role="search"]', '.js-site-search-form',
            'input[data-target="qbsearch-input.inputButton"]',
        ].join(', '),
    },
    {
        action: 'include',
        label: 'GitHub Markdown 标题',
        selector: '.markdown-title',
    },
    {
        action: 'include',
        label: 'GitHub Issue 与 PR 标题',
        selector: [
            'h1.gh-header-title .js-issue-title', '[data-testid="issue-title"]',
            '[data-testid="pull-request-title"]', '[data-testid="issue-pr-title-link"]',
        ].join(', '),
    },
    {
        action: 'include',
        label: 'GitHub Markdown 正文',
        selector: [
            '.markdown-body p', '.markdown-body h1', '.markdown-body h2',
            '.markdown-body h3', '.markdown-body h4', '.markdown-body h5',
            '.markdown-body h6', '.markdown-body li', '.markdown-body blockquote',
            '.markdown-body figcaption', '.markdown-body summary', '.markdown-body dt',
            '.markdown-body dd', '.markdown-body th', '.markdown-body td',
        ].join(', '),
    },
    {
        action: 'include',
        label: 'GitHub 仓库描述',
        selector: [
            '[itemprop="about"]', '[itemprop="description"]',
            '[data-testid="repository-description"]', '.repo-description p',
            '.repos-list-description', 'p.f4.my-3',
        ].join(', '),
    },
    {
        action: 'exclude',
        label: 'GitHub 动态状态',
        selector: [
            '[aria-live]', '[role="status"]', '[role="alert"]',
            '[data-turbo-permanent]', '[data-turbo-temporary]',
            'relative-time', 'time-ago', 'local-time',
        ].join(', '),
    },
];

const xDefaultRules: readonly TranslationFilterRule[] = [
    {
        action: 'exclude',
        label: 'X 编辑器',
        selector: '[data-testid="tweetTextarea_0"], [data-testid="DMComposerTextInput"]',
    },
    {
        action: 'exclude',
        label: 'X 用户名',
        selector: '[data-testid="User-Name"], [data-testid="UserName"]',
    },
    {action: 'include', label: 'X 帖子正文', selector: '[data-testid="tweetText"]'},
    {action: 'include', label: 'X 用户简介', selector: '[data-testid="UserDescription"]'},
    {
        action: 'include',
        label: 'X 长文章正文',
        selector: '[data-testid="twitterArticleReadView"] p',
    },
    {
        action: 'exclude',
        label: 'X 动态界面',
        selector: 'time, [role="progressbar"], [data-testid="app-bar-back"]',
    },
];

const redditDefaultRules: readonly TranslationFilterRule[] = [
    {
        action: 'exclude',
        label: 'Reddit 编辑器',
        selector: 'reddit-composer, [data-testid="comment-submission-form"]',
    },
    {
        action: 'include',
        label: 'Reddit 帖子标题',
        selector: 'shreddit-post [slot="title"], h1[id^="post-title-"]',
    },
    {
        action: 'include',
        label: 'Reddit 帖子正文',
        selector: [
            'shreddit-post [slot="text-body"] p', '[data-testid="post-content"] p',
            '[data-click-id="text"] p',
        ].join(', '),
    },
    {
        action: 'include',
        label: 'Reddit 评论正文',
        selector: 'shreddit-comment [slot="comment"] p, [data-testid="comment"] p',
    },
    {
        action: 'exclude',
        label: 'Reddit 动态元数据',
        selector: 'faceplate-timeago, [data-testid="post_timestamp"], [data-testid="vote-arrows"]',
    },
];

const hackerNewsDefaultRules: readonly TranslationFilterRule[] = [
    {action: 'include', label: 'Hacker News 标题', selector: '.titleline > a'},
    {action: 'include', label: 'Hacker News 评论', selector: 'span.commtext, .toptext'},
    {
        action: 'exclude',
        label: 'Hacker News 元数据',
        selector: '.rank, .sitestr, .score, .hnuser, .age, .subtext, .pagetop',
    },
];

const youtubeDefaultRules: readonly TranslationFilterRule[] = [
    {
        action: 'exclude',
        label: 'YouTube 播放器与直播界面',
        selector: '#movie_player, ytd-live-chat-frame, yt-live-chat-app, ytd-video-preview',
    },
    {
        action: 'exclude',
        label: 'YouTube 输入区域',
        selector: 'input#search, ytd-comment-simplebox-renderer',
    },
    {
        action: 'include',
        label: 'YouTube 视频标题',
        selector: 'ytd-watch-metadata h1 yt-formatted-string',
    },
    {
        action: 'include',
        label: 'YouTube 视频简介',
        selector: '#description-inline-expander yt-attributed-string, ytd-text-inline-expander yt-attributed-string',
    },
    {
        action: 'include',
        label: 'YouTube 评论',
        selector: 'ytd-comment-view-model #content-text, ytd-comment-renderer #content-text',
    },
    {
        action: 'include',
        label: 'YouTube 转录文本',
        selector: 'ytd-transcript-segment-renderer .segment-text',
    },
    {
        action: 'exclude',
        label: 'YouTube 动态元数据',
        selector: '#owner-sub-count, #info span, yt-formatted-string#vote-count-middle',
    },
];

const defaultSiteRules: readonly TranslationFilterSiteConfig[] = [
    {domain: 'github.com', rules: [...githubDefaultRules]},
    {domain: 'x.com', rules: [...xDefaultRules]},
    {domain: 'twitter.com', rules: [...xDefaultRules]},
    {domain: 'reddit.com', rules: [...redditDefaultRules]},
    {domain: 'redd.it', rules: [...redditDefaultRules]},
    {domain: 'ycombinator.com', rules: [...hackerNewsDefaultRules]},
    {domain: 'youtube.com', rules: [...youtubeDefaultRules]},
    {domain: 'youtu.be', rules: [...youtubeDefaultRules]},
    {
        domain: 'gnu.org',
        rules: [
            {action: 'exclude', label: 'GNU 手册导航', selector: '.nav-panel'},
            {
                action: 'include',
                label: 'GNU 手册正文',
                selector: [
                    '.section-level-extent > p', '.chapter-level-extent > p',
                    '.subsection-level-extent > p',
                ].join(', '),
            },
        ],
    },
    {
        domain: 'learnopengl.com',
        rules: [{action: 'exclude', label: 'LearnOpenGL 固定导航', selector: '#nav'}],
    },
    {
        domain: 'discord.com',
        rules: [{
            action: 'include',
            label: 'Discord 频道分组',
            selector: '[data-list-item-id^="channels___"][role="button"][aria-expanded]',
        }],
    },
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneRule(rule: TranslationFilterRule): TranslationFilterRule {
    return rule.label
        ? {action: rule.action, selector: rule.selector, label: rule.label}
        : {action: rule.action, selector: rule.selector};
}

function normalizeRule(value: unknown): TranslationFilterRule | null {
    if (!isRecord(value)) return null;
    const action = value.action;
    if (action !== 'exclude' && action !== 'include') return null;
    if (typeof value.selector !== 'string') return null;
    const selector = value.selector.trim().slice(0, MAX_TRANSLATION_FILTER_SELECTOR_LENGTH);
    if (!selector) return null;
    const label = typeof value.label === 'string'
        ? value.label.trim().slice(0, MAX_TRANSLATION_FILTER_LABEL_LENGTH)
        : '';
    return label ? {action, selector, label} : {action, selector};
}

export function normalizeTranslationFilterRules(
    value: unknown,
    fallback: readonly TranslationFilterRule[] = [],
): TranslationFilterRule[] {
    if (!Array.isArray(value)) return fallback.map(cloneRule);

    // A later rule wins when selectors overlap. Keep the last occurrence of an
    // exact selector so changing its action cannot leave a hidden stale rule.
    const rules: TranslationFilterRule[] = [];
    const seen = new Set<string>();
    const candidates = value.slice(-MAX_TRANSLATION_FILTER_RULES);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const rule = normalizeRule(candidates[index]);
        if (!rule || seen.has(rule.selector)) continue;
        seen.add(rule.selector);
        rules.unshift(rule);
    }
    return rules;
}

export function createDefaultTranslationFilterConfig(): TranslationFilterConfig {
    return {
        global: {
            excludeHidden: true,
            excludeEditable: true,
            rules: defaultGlobalRules.map(cloneRule),
        },
        sites: defaultSiteRules.map((site) => ({
            domain: site.domain,
            rules: site.rules.map(cloneRule),
        })),
    };
}

export function normalizeTranslationFilterConfig(value: unknown): TranslationFilterConfig {
    const defaults = createDefaultTranslationFilterConfig();
    if (!isRecord(value)) return defaults;

    const globalValue = isRecord(value.global) ? value.global : {};
    const globalRules = Object.prototype.hasOwnProperty.call(globalValue, 'rules')
        ? normalizeTranslationFilterRules(globalValue.rules)
        : defaults.global.rules;
    const global: TranslationFilterGlobalConfig = {
        excludeHidden: typeof globalValue.excludeHidden === 'boolean'
            ? globalValue.excludeHidden
            : defaults.global.excludeHidden,
        excludeEditable: typeof globalValue.excludeEditable === 'boolean'
            ? globalValue.excludeEditable
            : defaults.global.excludeEditable,
        rules: globalRules,
    };

    if (!Object.prototype.hasOwnProperty.call(value, 'sites')) {
        return {global, sites: defaults.sites};
    }
    if (!Array.isArray(value.sites)) return {global, sites: []};

    const sites: TranslationFilterSiteConfig[] = [];
    const seenDomains = new Set<string>();
    for (const item of value.sites.slice(0, MAX_TRANSLATION_FILTER_SITES)) {
        if (!isRecord(item) || typeof item.domain !== 'string') continue;
        const domain = getSiteBaseDomain(item.domain);
        if (!domain || seenDomains.has(domain)) continue;
        seenDomains.add(domain);
        sites.push({
            domain,
            rules: normalizeTranslationFilterRules(item.rules),
        });
    }
    return {global, sites};
}

export function getTranslationFilterSite(
    config: TranslationFilterConfig,
    input: string | URL,
): TranslationFilterSiteConfig | null {
    const domain = getSiteBaseDomain(input);
    if (!domain) return null;
    return config.sites.find((site) => site.domain === domain) ?? null;
}

export function createTranslationFilterSite(domainInput: string | URL): TranslationFilterSiteConfig | null {
    const domain = getSiteBaseDomain(domainInput);
    return domain ? {domain, rules: []} : null;
}

export function upsertTranslationFilterSite(
    config: TranslationFilterConfig,
    siteValue: TranslationFilterSiteConfig,
): TranslationFilterConfig {
    const site = createTranslationFilterSite(siteValue.domain);
    if (!site) return normalizeTranslationFilterConfig(config);
    site.rules = normalizeTranslationFilterRules(siteValue.rules);
    const normalized = normalizeTranslationFilterConfig(config);
    const existingIndex = normalized.sites.findIndex((item) => item.domain === site.domain);
    if (existingIndex < 0) normalized.sites.push(site);
    else normalized.sites.splice(existingIndex, 1, site);
    return normalized;
}

export function removeTranslationFilterSite(
    config: TranslationFilterConfig,
    domainInput: string | URL,
): TranslationFilterConfig {
    const domain = getSiteBaseDomain(domainInput);
    const normalized = normalizeTranslationFilterConfig(config);
    if (!domain) return normalized;
    normalized.sites = normalized.sites.filter((site) => site.domain !== domain);
    return normalized;
}

function safeMatches(element: Element, selector: string): boolean {
    try {
        return element.matches(selector);
    } catch {
        return false;
    }
}

function matchingRuleDecision(
    element: Element,
    rules: readonly TranslationFilterRule[],
    scope: 'global' | 'site',
): TranslationFilterDecision {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
        const rule = rules[index]!;
        if (!safeMatches(element, rule.selector)) continue;
        return {
            action: rule.action,
            reason: `${scope}-filter:${rule.label || rule.selector}`,
        };
    }
    return {action: 'pass'};
}

function hasHiddenMarker(element: Element): boolean {
    const htmlElement = element as HTMLElement;
    if (htmlElement.hidden || htmlElement.inert || element.hasAttribute('inert')) return true;
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.classList.contains('sr-only') || element.classList.contains('visually-hidden')) return true;

    try {
        const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
        if (!style) return false;
        return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
    } catch {
        return false;
    }
}

function hasContentEditableMarker(element: Element): boolean {
    const attribute = element.getAttribute('contenteditable');
    return (attribute !== null && attribute.toLowerCase() !== 'false') ||
        (element as HTMLElement).isContentEditable;
}

function parsePolicyUrl(input?: string | URL): URL {
    if (input instanceof URL) return new URL(input.href);
    try {
        return new URL(input ?? globalThis.location?.href ?? 'https://invalid.local/');
    } catch {
        return new URL('https://invalid.local/');
    }
}

const baseObservedAttributes = [
    'style', 'class', 'id', 'role', 'hidden', 'inert', 'contenteditable',
    'aria-hidden', 'translate', 'data-notranslate',
] as const;

function collectObservedAttributes(
    config: TranslationFilterConfig,
    site: TranslationFilterSiteConfig | null,
): string[] {
    const attributes = new Set<string>(baseObservedAttributes);
    const rules = [
        ...config.global.rules,
        ...(site?.rules ?? []),
    ];
    const attributePattern = /\[\s*([^\s~|^$*=\]]+)/gu;
    for (const rule of rules) {
        attributePattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = attributePattern.exec(rule.selector))) {
            const attribute = match[1]?.trim().toLowerCase();
            if (attribute && /^[a-z_][\w:.-]*$/u.test(attribute)) attributes.add(attribute);
        }
        if (rule.selector.includes('#')) attributes.add('id');
        if (/:checked\b/u.test(rule.selector)) attributes.add('checked');
        if (/:disabled\b/u.test(rule.selector)) attributes.add('disabled');
        if (/:enabled\b/u.test(rule.selector)) attributes.add('disabled');
        if (/:open\b/u.test(rule.selector)) attributes.add('open');
        if (/:lang\(/u.test(rule.selector)) attributes.add('lang');
        if (/:dir\(/u.test(rule.selector)) attributes.add('dir');
    }
    return [...attributes];
}

export function createTranslationFilterPolicy(
    value?: TranslationFilterConfig,
    urlInput?: string | URL,
): TranslationFilterPolicy {
    const config = normalizeTranslationFilterConfig(value);
    const site = getTranslationFilterSite(config, parsePolicyUrl(urlInput));

    const evaluateElement = (element: Element): TranslationFilterDecision => {
        if (site) {
            const siteDecision = matchingRuleDecision(element, site.rules, 'site');
            if (siteDecision.action !== 'pass') return siteDecision;
        }

        const globalDecision = matchingRuleDecision(element, config.global.rules, 'global');
        if (globalDecision.action !== 'pass') return globalDecision;
        if (config.global.excludeEditable && hasContentEditableMarker(element)) {
            return {action: 'exclude', reason: 'contenteditable'};
        }
        if (config.global.excludeHidden && hasHiddenMarker(element)) {
            return {action: 'exclude', reason: 'hidden'};
        }
        return {action: 'pass'};
    };

    return {
        config,
        site,
        observedAttributes: collectObservedAttributes(config, site),
        evaluateElement,
        isExcludedSelf: (element) => evaluateElement(element).action === 'exclude',
        isIncludedSelf: (element) => evaluateElement(element).action === 'include',
    };
}

export const defaultTranslationFilterPolicy = createTranslationFilterPolicy(
    createDefaultTranslationFilterConfig(),
    'https://invalid.local/',
);

export function translationFilterConfigSignature(value: unknown): string {
    return JSON.stringify(normalizeTranslationFilterConfig(value));
}
