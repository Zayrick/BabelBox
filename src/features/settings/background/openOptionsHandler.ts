export const OPEN_OPTIONS_PAGE_MESSAGE_TYPE = 'openOptionsPage' as const;

export const OPTIONS_SECTION_IDS = [
    'settings-general',
    'settings-services',
    'settings-translation-center',
    'settings-vocabulary',
    'settings-shortcuts',
    'settings-image-translation',
    'settings-video',
    'settings-advanced',
    'settings-data',
    'settings-about',
    'settings-sites',
] as const;

export type OptionsSectionId = typeof OPTIONS_SECTION_IDS[number];

export interface OpenOptionsPageMessage {
    type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    section?: unknown;
}

export interface OpenOptionsPageResponse {
    success: true;
}

export interface OpenOptionsPageDependencies {
    readonly openDefaultPage: () => Promise<void>;
    readonly openSection: (section: OptionsSectionId) => Promise<void>;
}

export interface OpenOptionsPageHandler {
    readonly type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    handle(message: OpenOptionsPageMessage): Promise<OpenOptionsPageResponse>;
}

const OPTIONS_SECTIONS = new Set<string>(OPTIONS_SECTION_IDS);

function parseSection(value: unknown): OptionsSectionId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !OPTIONS_SECTIONS.has(value)) {
        throw new TypeError('无效的设置页面');
    }
    return value as OptionsSectionId;
}

/** 创建设置页导航 handler；URL 与 tabs API 由 WXT composition root 负责。 */
export function createOpenOptionsPageHandler(
    dependencies: OpenOptionsPageDependencies,
): OpenOptionsPageHandler {
    return {
        type: OPEN_OPTIONS_PAGE_MESSAGE_TYPE,
        async handle(message) {
            const section = parseSection(message.section);
            if (section === undefined) {
                await dependencies.openDefaultPage();
            } else {
                await dependencies.openSection(section);
            }
            return {success: true};
        },
    };
}
