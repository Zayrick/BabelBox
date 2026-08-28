import type {TranslationSiteAdapter} from './types';
import {createDeclarativeAdapter} from './adapters/declarative';

const declaredAdapters = [
    // Reddit updates these live regions at high frequency. This adapter only
    // controls mutation scheduling; all translate/exclude selectors live in
    // the user-editable default filter configuration.
    createDeclarativeAdapter({
        id: 'reddit-runtime',
        priority: 390,
        hosts: [
            {hostname: 'reddit.com', includeSubdomains: true},
            {hostname: 'redd.it', includeSubdomains: true},
        ],
        mutationExclude: [{
            selector: ['shreddit-status', '[aria-live]'],
            reason: 'reddit-controlled-mutation',
        }],
    }),
] as const satisfies readonly TranslationSiteAdapter[];

export const defaultTranslationAdapters: readonly TranslationSiteAdapter[] =
    Object.freeze([...declaredAdapters]);
