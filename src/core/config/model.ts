import { defaultOption, services } from "./catalog";
import { normalizeSelectionTtsVoiceOrder } from "./selectionTts";
import {
    DEFAULT_ANIMATION_MODE,
    normalizeAnimationMode,
    type AnimationMode,
} from './animation';
import {
    normalizeAlwaysTranslateDomains,
    normalizeDisabledExtensionDomains,
} from "@/src/core/site-rules/domain";
import {
    createDefaultTranslationFilterConfig,
    normalizeTranslationFilterConfig,
    type TranslationFilterConfig,
} from '@/src/core/translation/filters';
import {
    createDefaultTranslationServices,
    normalizeTranslationServices,
    reconcileTranslationServiceReferences,
    type TranslationServiceCredential,
    type TranslationServiceInstance,
} from './translationServices';

export type {DeepSeekApiType, DeepSeekThinkingMode, TranslationServiceCredential} from './translationServices';
export type VideoSubtitleDisplayMode = 'bilingual' | 'translation-only' | 'original-only';
export type FullPageTranslationMode = 'viewport' | 'all';
export const DEFAULT_VIDEO_SUBTITLE_FONT_SIZE = 100;
export const VIDEO_SUBTITLE_FONT_SIZE_OPTIONS = [80, 90, 100, 110, 120, 140, 160] as const;
export const DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY = 50;
export const MOUSE_HOVER_TRANSLATION_DELAY_MIN = 0;
export const MOUSE_HOVER_TRANSLATION_DELAY_MAX = 2000;
export const MOUSE_HOVER_TRANSLATION_DELAY_STEP = 10;
export const DEFAULT_SELECTION_TRANSLATOR_DELAY = 300;
export const SELECTION_TRANSLATOR_DELAY_MIN = 0;
export const SELECTION_TRANSLATOR_DELAY_MAX = 2000;
export const SELECTION_TRANSLATOR_DELAY_STEP = 50;

export function normalizeVideoSubtitleFontSize(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return DEFAULT_VIDEO_SUBTITLE_FONT_SIZE;
    return Math.min(160, Math.max(80, Math.round(number / 10) * 10));
}

export function normalizeMouseHoverTranslationDelay(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY;
    const rounded = Math.round(number / MOUSE_HOVER_TRANSLATION_DELAY_STEP) * MOUSE_HOVER_TRANSLATION_DELAY_STEP;
    return Math.min(
        MOUSE_HOVER_TRANSLATION_DELAY_MAX,
        Math.max(MOUSE_HOVER_TRANSLATION_DELAY_MIN, rounded),
    );
}

export function normalizeSelectionTranslatorDelay(value: unknown): number {
    const number = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN;
    if (!Number.isFinite(number)) return DEFAULT_SELECTION_TRANSLATOR_DELAY;
    const rounded = Math.round(number / SELECTION_TRANSLATOR_DELAY_STEP) * SELECTION_TRANSLATOR_DELAY_STEP;
    return Math.min(
        SELECTION_TRANSLATOR_DELAY_MAX,
        Math.max(SELECTION_TRANSLATOR_DELAY_MIN, rounded),
    );
}

export class Config {
    autoTranslate: boolean; // 是否即时翻译
    alwaysTranslateDomains: string[]; // 始终自动翻译的可注册域名（eTLD+1）
    disabledExtensionDomains: string[]; // 禁用扩展的可注册域名（eTLD+1）
    translationFilter: TranslationFilterConfig; // 全局与网站级网页内容过滤规则
    from: string;
    to: string;
    hotkey: string;
    style: number;
    display: number;
    service: string;
    translationServices: TranslationServiceInstance[]; // 已添加的翻译服务实例
    serviceCredentials: Record<string, TranslationServiceCredential>; // 按实例隔离的凭据
    documentService: string; // 文档翻译独立翻译服务
    videoTranslationEnabled: boolean; // 是否启用视频字幕翻译 Beta
    videoService: string; // 视频字幕独立翻译服务
    videoSubtitleVisible: boolean; // 是否显示 BabelBox 视频字幕
    videoSubtitleDisplayMode: VideoSubtitleDisplayMode; // 视频字幕显示模式
    videoSubtitleFontSize: number; // 视频字幕字号百分比
    count: number;  // 翻译次数
    theme: string;  // 主题模式：'auto' | 'light' | 'dark'
    useCache: boolean; // 是否使用缓存
    enableAIContext: boolean; // 是否为 AI 翻译附加网页上下文
    contextMenuEnabled: boolean; // 是否显示右键全文翻译菜单
    fullPageTranslationMode: FullPageTranslationMode; // 全文翻译按视口加载或立即处理整页
    disableFloatingBall: boolean; // 是否禁用悬浮球
    floatingBallPosition: 'left' | 'right'; // 悬浮球位置
    floatingBallHotkey: string; // 悬浮球快捷键
    customFloatingBallHotkey: string; // 自定义悬浮球快捷键
    customHotkey: string; // 自定义鼠标悬浮快捷键
    mouseHoverTranslationDelay: number; // 鼠标悬浮翻译触发延迟（毫秒）
    disableSelectionTranslator: boolean; // 是否禁用划词翻译
    selectionAreaEnabled: boolean; // 是否启用圈选翻译
    disableImageTranslator: boolean; // 是否禁用图片翻译
    selectionTranslatorMode: string; // 划词翻译显示模式: 'disabled' | 'bilingual' | 'translation-only'
    selectionTranslatorTrigger: string; // 划词翻译互斥触发方式: 'direct' | 'icon' | 'dot' | 'Control' | 'Alt' | 'Shift' | 'custom'
    selectionTranslatorHotkey: string; // 旧版快捷键字段；与 selectionTranslatorTrigger 中的快捷键选项保持镜像
    customSelectionTranslatorHotkey: string; // 自定义划词翻译快捷键
    selectionTranslatorDelay: number; // 选区稳定后显示划词翻译入口的延迟（毫秒）
    selectionTtsVoices: string[]; // 划词朗读的 Edge TTS 音色回退顺序
    vocabularyBookEnabled: boolean; // 是否启用本地单词本 Beta
    maxConcurrentTranslations: number; // 最大并发翻译数量
    animationMode: AnimationMode; // 动画效果模式
    translationProgressPanelEnabled: boolean; // 是否显示全文翻译进度面板
    inputBoxTranslationTrigger: string; // 输入框翻译触发方式
    inputBoxTranslationTarget: string; // 输入框翻译目标语言
    translationCenterServices: string[]; // 翻译中心已选服务及其展示顺序
    translationCenterSourceLanguage: string; // 翻译中心源语言
    translationCenterTargetLanguage: string; // 翻译中心目标语言

    constructor() {
        this.autoTranslate = false;
        this.alwaysTranslateDomains = [];
        this.disabledExtensionDomains = [];
        this.translationFilter = createDefaultTranslationFilterConfig();
        this.from = defaultOption.from;
        this.to = defaultOption.to;
        this.style = defaultOption.style;
        this.display = defaultOption.display;
        this.hotkey = defaultOption.hotkey;
        this.service = defaultOption.service;
        this.translationServices = createDefaultTranslationServices();
        this.serviceCredentials = {};
        this.documentService = defaultOption.service;
        this.videoTranslationEnabled = false; // Beta 功能默认关闭
        this.videoService = services.microsoft; // 视频字幕默认使用微软翻译
        this.videoSubtitleVisible = true; // 默认显示视频译文
        this.videoSubtitleDisplayMode = 'bilingual'; // 默认双语显示
        this.videoSubtitleFontSize = DEFAULT_VIDEO_SUBTITLE_FONT_SIZE; // 默认字幕字号
        this.count = 0;
        this.theme = 'auto';  // 默认跟随系统
        this.useCache = true; // 默认开启缓存
        this.enableAIContext = false; // 默认关闭 AI 智能上下文，避免意外增加请求体和费用
        this.contextMenuEnabled = true; // 默认显示右键全文翻译入口
        this.fullPageTranslationMode = 'viewport'; // 默认按阅读进度翻译，避免一次发出过多请求
        this.disableFloatingBall = true; // 默认关闭悬浮球
        this.floatingBallPosition = 'right'; // 默认在右侧
        this.floatingBallHotkey = 'Alt+T'; // 默认快捷键为 Alt+T
        this.customFloatingBallHotkey = ''; // 自定义快捷键为空
        this.customHotkey = ''; // 自定义鼠标悬浮快捷键为空
        this.mouseHoverTranslationDelay = DEFAULT_MOUSE_HOVER_TRANSLATION_DELAY;
        this.disableSelectionTranslator = true; // 默认关闭划词翻译
        this.selectionAreaEnabled = false; // 圈选翻译需要用户主动开启，避免意外截图
        this.disableImageTranslator = true; // 默认关闭图片翻译，避免首次安装后扫描网页图片
        this.selectionTranslatorMode = 'disabled'; // 默认关闭划词翻译
        this.selectionTranslatorTrigger = 'icon'; // 默认显示可发现的操作图标
        this.selectionTranslatorHotkey = 'none'; // 默认不增加额外快捷键，保持原有划词行为
        this.customSelectionTranslatorHotkey = ''; // 自定义划词翻译快捷键为空
        this.selectionTranslatorDelay = DEFAULT_SELECTION_TRANSLATOR_DELAY;
        this.selectionTtsVoices = []; // 默认按当前语言使用内置音色回退顺序
        this.vocabularyBookEnabled = false; // Beta 默认关闭，由用户在单词本页面主动开启
        this.maxConcurrentTranslations = 6; // 默认最大并发数为6
        this.animationMode = DEFAULT_ANIMATION_MODE;
        this.translationProgressPanelEnabled = false; // 默认关闭全文翻译进度面板
        this.inputBoxTranslationTrigger = 'disabled'; // 默认关闭输入框翻译
        this.inputBoxTranslationTarget = 'en'; // 默认翻译成英文
        this.translationCenterServices = [];
        this.translationCenterSourceLanguage = '';
        this.translationCenterTargetLanguage = '';
    }
}

/**
 * Config fields removed by the instance-based translation service model.
 * Stored or imported snapshots may still carry them; they are dropped on load.
 */
export const RETIRED_CONFIG_FIELDS = [
    'token', 'requireApiKey', 'ak', 'sk', 'appid', 'key', 'extra',
    'model', 'customModel', 'documentModel', 'documentCustomModel',
    'customBody', 'proxy', 'custom', 'robot_id', 'system_role', 'user_role',
    'deeplx', 'newApiUrl', 'azureOpenaiEndpoint',
    'youdaoAppKey', 'youdaoAppSecret', 'tencentSecretId', 'tencentSecretKey',
    'deepseekApiType', 'deepseekThinkingMode',
    'minimaxBillingPlan', 'minimaxRegion', 'mimoBillingPlan', 'mimoRegion',
    'videoServiceDefaultMigrated', 'persistCredentials',
] as const;

/** 将存储或导入的普通对象补齐为当前配置结构。 */
export function normalizeConfig(value: unknown): Config {
    const normalized = new Config();
    // Vue 的响应式对象是 Proxy。Chrome 的 runtime 通道有时会替调用方
    // 做隐式转换，但 Firefox 会严格按 structured clone 处理并直接抛出
    // DataCloneError，所以配置边界必须先落成纯对象。
    const source = value && typeof value === 'object'
        ? cloneConfigValue(value) as Partial<Config>
        : {};
    Object.assign(normalized, source);
    const legacyAnimations = (source as unknown as Record<string, unknown>).animations;
    normalized.animationMode = normalizeAnimationMode(source.animationMode, legacyAnimations);
    delete (normalized as unknown as Record<string, unknown>).animations;
    const legacyTranslationStatus = (source as unknown as Record<string, unknown>).translationStatus;
    if (typeof source.translationProgressPanelEnabled !== 'boolean') {
        normalized.translationProgressPanelEnabled = typeof legacyTranslationStatus === 'boolean'
            ? legacyTranslationStatus
            : false;
    }
    delete (normalized as unknown as Record<string, unknown>).translationStatus;
    // 旧版的全局启用开关已由浏览器的扩展启用状态取代；残留的 false 不能再暂停功能。
    delete (normalized as unknown as Record<string, unknown>).on;
    // __babelboxConfigRevision 只用于 storage 的写入顺序判断，不能进入运行时
    // 配置或历史快照，否则默认配置与同值的页面快照会因内部字段不同而无法去重。
    delete (normalized as unknown as Record<string, unknown>).__babelboxConfigRevision;

    for (const field of RETIRED_CONFIG_FIELDS) {
        delete (normalized as unknown as Record<string, unknown>)[field];
    }

    normalized.translationServices = normalizeTranslationServices(source.translationServices);
    normalized.serviceCredentials = normalizeServiceCredentials(source.serviceCredentials);

    if (typeof normalized.videoTranslationEnabled !== 'boolean') {
        normalized.videoTranslationEnabled = false;
    }
    if (typeof normalized.videoSubtitleVisible !== 'boolean') {
        normalized.videoSubtitleVisible = true;
    }
    if (!['bilingual', 'translation-only', 'original-only'].includes(normalized.videoSubtitleDisplayMode)) {
        normalized.videoSubtitleDisplayMode = 'bilingual';
    }
    normalized.videoSubtitleFontSize = normalizeVideoSubtitleFontSize(normalized.videoSubtitleFontSize);

    normalized.mouseHoverTranslationDelay = normalizeMouseHoverTranslationDelay(
        source.mouseHoverTranslationDelay,
    );
    normalized.alwaysTranslateDomains = normalizeAlwaysTranslateDomains(source.alwaysTranslateDomains);
    normalized.disabledExtensionDomains = normalizeDisabledExtensionDomains(source.disabledExtensionDomains);
    normalized.translationFilter = normalizeTranslationFilterConfig(source.translationFilter);

    if (!['disabled', 'bilingual', 'translation-only'].includes(normalized.selectionTranslatorMode)) {
        normalized.selectionTranslatorMode = 'disabled';
    }
    const selectionTriggerValues = ['direct', 'icon', 'dot', 'Control', 'Alt', 'Shift', 'custom'];
    const selectionShortcutValues = ['Control', 'Alt', 'Shift', 'custom'];
    const hasExplicitSelectionTrigger = typeof source.selectionTranslatorTrigger === 'string'
        && selectionTriggerValues.includes(source.selectionTranslatorTrigger);
    if (!selectionTriggerValues.includes(normalized.selectionTranslatorTrigger)) {
        normalized.selectionTranslatorTrigger = 'icon';
    }
    if (!['none', 'Control', 'Alt', 'Shift', 'custom'].includes(normalized.selectionTranslatorHotkey)) {
        normalized.selectionTranslatorHotkey = 'none';
    }
    if (typeof normalized.customSelectionTranslatorHotkey !== 'string') {
        normalized.customSelectionTranslatorHotkey = '';
    }
    normalized.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(
        source.selectionTranslatorDelay,
    );
    // 兼容上一版“触发方式 + 可选快捷键”配置，并将最终状态收敛为单一触发方式。
    if (!hasExplicitSelectionTrigger
        && ['direct', 'icon', 'dot'].includes(normalized.selectionTranslatorTrigger)
        && normalized.selectionTranslatorHotkey !== 'none') {
        normalized.selectionTranslatorTrigger = normalized.selectionTranslatorHotkey;
    }
    if (selectionShortcutValues.includes(normalized.selectionTranslatorTrigger)) {
        if (normalized.selectionTranslatorTrigger === 'custom'
            && (!normalized.customSelectionTranslatorHotkey.trim() || normalized.customSelectionTranslatorHotkey === 'none')) {
            normalized.selectionTranslatorTrigger = 'icon';
            normalized.selectionTranslatorHotkey = 'none';
        } else {
            normalized.selectionTranslatorHotkey = normalized.selectionTranslatorTrigger;
        }
    } else {
        normalized.selectionTranslatorHotkey = 'none';
    }
    normalized.selectionTtsVoices = normalizeSelectionTtsVoiceOrder(normalized.selectionTtsVoices);
    normalized.disableSelectionTranslator = normalized.selectionTranslatorMode === 'disabled';
    if (typeof normalized.vocabularyBookEnabled !== 'boolean') {
        normalized.vocabularyBookEnabled = false;
    }
    if (typeof normalized.selectionAreaEnabled !== 'boolean') {
        normalized.selectionAreaEnabled = false;
    }
    if (typeof normalized.contextMenuEnabled !== 'boolean') {
        normalized.contextMenuEnabled = true;
    }
    if (!['viewport', 'all'].includes(normalized.fullPageTranslationMode)) {
        normalized.fullPageTranslationMode = 'viewport';
    }
    normalized.translationCenterServices = normalizeStringList(source.translationCenterServices);
    normalized.translationCenterSourceLanguage = normalizeConfigLanguage(source.translationCenterSourceLanguage);
    normalized.translationCenterTargetLanguage = normalizeConfigLanguage(source.translationCenterTargetLanguage);
    reconcileTranslationServiceReferences(normalized);

    return normalized;
}

function cloneConfigValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneConfigValue);
    if (!isRecord(value)) return value;

    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) cloned[key] = cloneConfigValue(value[key]);
    return cloned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeServiceCredentials(value: unknown): Record<string, TranslationServiceCredential> {
    if (!isRecord(value)) return {};
    const result: Record<string, TranslationServiceCredential> = {};
    for (const [serviceId, credential] of Object.entries(value)) {
        if (!credential || typeof credential !== 'object' || Array.isArray(credential)) continue;
        const source = credential as Record<string, unknown>;
        result[serviceId] = {
            apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
            appKey: typeof source.appKey === 'string' ? source.appKey : '',
            appSecret: typeof source.appSecret === 'string' ? source.appSecret : '',
            secretId: typeof source.secretId === 'string' ? source.secretId : '',
            secretKey: typeof source.secretKey === 'string' ? source.secretKey : '',
        };
    }
    return result;
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean))];
}

function normalizeConfigLanguage(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
