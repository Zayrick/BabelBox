export interface UserscriptMetadataOptions {
    version: string;
    iconDataUrl?: string;
}
const grants = [
    'GM_getValue',
    'GM_setValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_xmlhttpRequest',
    'GM_registerMenuCommand',
    'GM_addStyle',
];

export function createUserscriptMetadata({version, iconDataUrl}: UserscriptMetadataOptions): string {
    const lines = [
        '// ==UserScript==',
        '// @name         翻译机',
        '// @name:en      BabelBox',
        '// @namespace    https://github.com/Zayrick/BabelBox',
        `// @version      ${version}`,
        '// @description  双语网页翻译、悬浮翻译与划词翻译的 BabelBox userscript 版本。',
        '// @description:en BabelBox bilingual page, hover, and selection translation userscript.',
        '// @author       Zayrick and BabelBox contributors',
        '// @license      GPL-3.0-only',
        '// @homepageURL  https://github.com/Zayrick/BabelBox',
        '// @supportURL   https://github.com/Zayrick/BabelBox/issues',
        '// @match        http://*/*',
        '// @match        https://*/*',
        '// @run-at       document-start',
        '// @inject-into  content',
        '// @noframes',
        '// @connect      *',
        ...grants.map((grant) => `// @grant        ${grant}`),
        ...(iconDataUrl ? [`// @icon         ${iconDataUrl}`] : []),
        '// ==/UserScript==',
    ];
    return `${lines.join('\n')}\n`;
}
