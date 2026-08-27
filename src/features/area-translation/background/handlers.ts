import type {AreaTranslationSelection} from '@/src/features/area-translation/core';

export const AREA_CAPTURE_MESSAGE_TYPE = 'fluentReadAreaCapture' as const;
export const AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE = 'fluentReadAreaTranslateCapture' as const;

export interface AreaTranslationBackgroundContext {
    sender?: {
        tab?: {
            windowId?: number;
        };
    };
}

export interface AreaCaptureMessage {
    type: typeof AREA_CAPTURE_MESSAGE_TYPE;
}

export interface AreaTranslateCaptureMessage {
    type: typeof AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE;
    image?: unknown;
    selection?: unknown;
    sourceLanguage?: unknown;
    title?: unknown;
}

export type AreaTranslationBackgroundMessage = AreaCaptureMessage | AreaTranslateCaptureMessage;

export interface AreaCaptureResponse {
    success: true;
    image: string;
}

export interface AreaTranslationBackgroundDependencies<TResult extends object> {
    readonly captureVisibleTab: (windowId: number) => Promise<string | undefined>;
    readonly getDefaultSourceLanguage: () => string;
    readonly assertLanguagesDownloaded: (sourceLanguage: string) => Promise<void>;
    readonly translateArea: (
        image: string,
        sourceLanguage: string,
        title: string,
        selection: AreaTranslationSelection,
    ) => Promise<TResult>;
}

export interface AreaTranslationBackgroundHandler<
    TMessage extends AreaTranslationBackgroundMessage,
    TResponse,
> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: AreaTranslationBackgroundContext): Promise<TResponse>;
}

export function isAreaTranslationSelection(value: unknown): value is AreaTranslationSelection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const selection = value as Record<string, unknown>;
    const numericFields = ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight'] as const;
    return numericFields.every((key) => typeof selection[key] === 'number' && Number.isFinite(selection[key]))
        && Number(selection.width) >= 12
        && Number(selection.height) >= 12
        && Number(selection.viewportWidth) > 0
        && Number(selection.viewportHeight) > 0;
}

function parseWindowId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError('无法确定当前页面窗口');
    }
    return value;
}

function parseDataImage(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) {
        throw new TypeError('圈选截图数据无效');
    }
    return value;
}

function parseSourceLanguage(value: unknown, fallback: string): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new TypeError('圈选翻译 sourceLanguage 必须是非空字符串');
    }
    return candidate;
}

function parseTitle(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new TypeError('圈选翻译 title 必须是字符串');
    return value;
}

/** 创建区域截图与翻译 handlers；tabs/offscreen/config 均由 app composition root 注入。 */
export function createAreaTranslationBackgroundHandlers<TResult extends object>(
    dependencies: AreaTranslationBackgroundDependencies<TResult>,
): [
    AreaTranslationBackgroundHandler<AreaCaptureMessage, AreaCaptureResponse>,
    AreaTranslationBackgroundHandler<AreaTranslateCaptureMessage, {success: true} & TResult>,
] {
    return [
        {
            type: AREA_CAPTURE_MESSAGE_TYPE,
            async handle(_message, context) {
                const windowId = parseWindowId(context.sender?.tab?.windowId);
                const image = await dependencies.captureVisibleTab(windowId);
                if (typeof image !== 'string' || !image) throw new Error('当前页面截图为空');
                return {success: true, image};
            },
        },
        {
            type: AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE,
            async handle(message) {
                // 严格验证截图、视口选区和字符串字段，再进入 OCR/offscreen 边界。
                const image = parseDataImage(message.image);
                if (!isAreaTranslationSelection(message.selection)) throw new TypeError('圈选区域无效');
                const sourceLanguage = parseSourceLanguage(
                    message.sourceLanguage,
                    dependencies.getDefaultSourceLanguage(),
                );
                const title = parseTitle(message.title);

                // 先确认语言包，再复用同一个 offscreen 区域翻译事务。
                await dependencies.assertLanguagesDownloaded(sourceLanguage);
                const result = await dependencies.translateArea(image, sourceLanguage, title, message.selection);
                return {success: true, ...result};
            },
        },
    ];
}
