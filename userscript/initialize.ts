import {Config, normalizeConfig} from '@/src/core/config/model';
import {getApiKeyRequirementKey} from '@/src/core/config/validation';
import {customModelString, defaultModels, models, services, servicesType} from '@/src/core/config/catalog';
import {
    type TranslationServiceInstance,
} from '@/src/core/config/translationServices';
import {getStoredValue, setStoredValue} from './storage';

const CONFIG_STORAGE_KEY = 'local:config';

const legacyServiceMap: Record<string, string> = {
    microsoft: services.microsoft,
    deepL: services.deepL,
    openai: services.openai,
    gemini: services.gemini,
    yiyan: services.yiyan,
    tongyi: services.tongyi,
    zhipu: services.zhipu,
    moonshot: services.moonshot,
    ollama: services.custom,
};

const legacyDefaultModels: Record<string, ReadonlySet<string>> = {
    openai: new Set(['gpt-3.5-turbo']),
    gemini: new Set(['gemini-pro']),
    yiyan: new Set(['completions']),
    tongyi: new Set(['qwen-turbo']),
    zhipu: new Set(['glm-3-turbo']),
    moonshot: new Set(['moonshot-v1-8', 'moonshot-v1-8k']),
};

const supportedUserscriptServices = new Set([
    ...servicesType.machine,
    ...servicesType.AI,
]);
supportedUserscriptServices.delete(services.chromeTranslator);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function isUserscriptServiceSupported(service: unknown): service is string {
    return typeof service === 'string' && supportedUserscriptServices.has(service);
}

export function getEnabledUserscriptServices(config: Pick<Config, 'translationServices'>): TranslationServiceInstance[] {
    return config.translationServices.filter((instance) => (
        instance.enabled && isUserscriptServiceSupported(instance.provider)
    ));
}

/** Keep extension-only capabilities disabled even when an existing GM config enables them. */
export function normalizeUserscriptConfig(value: unknown): Config {
    const source = value && typeof value === 'object'
        ? value as {service?: unknown; videoService?: unknown}
        : {};
    const next = normalizeConfig(value);
    let enabledServices = getEnabledUserscriptServices(next);
    if (!enabledServices.length) {
        const fallback = next.translationServices.find((instance) => (
            instance.id === services.microsoft && isUserscriptServiceSupported(instance.provider)
        )) || next.translationServices.find((instance) => isUserscriptServiceSupported(instance.provider));
        if (fallback) fallback.enabled = true;
        enabledServices = getEnabledUserscriptServices(next);
    }
    const enabledIds = new Set(enabledServices.map((instance) => instance.id));
    const fallbackId = enabledServices.find((instance) => instance.id === services.microsoft)?.id
        || enabledServices[0]?.id
        || services.microsoft;
    const originalService = typeof source.service === 'string'
        ? getServiceById(next, source.service)
        : undefined;
    const originalVideoService = typeof source.videoService === 'string'
        ? getServiceById(next, source.videoService)
        : undefined;
    const originalServiceUnsupported = typeof source.service === 'string'
        && (!originalService || !isUserscriptServiceSupported(originalService.provider));
    const originalVideoServiceUnsupported = typeof source.videoService === 'string'
        && (!originalVideoService || !isUserscriptServiceSupported(originalVideoService.provider));
    if (originalServiceUnsupported || !enabledIds.has(next.service)) next.service = fallbackId;
    if (originalVideoServiceUnsupported || !enabledIds.has(next.videoService)) next.videoService = fallbackId;
    next.translationCenterServices = next.translationCenterServices.filter((serviceId) => enabledIds.has(serviceId));
    next.contextMenuEnabled = false;
    next.selectionAreaEnabled = false;
    next.disableImageTranslator = true;
    next.videoTranslationEnabled = false;
    next.maxConcurrentTranslations = Math.max(1, Number(next.maxConcurrentTranslations) || 6);
    return next;
}

function getServiceById(config: Pick<Config, 'translationServices'>, serviceId: string): TranslationServiceInstance | undefined {
    return config.translationServices.find((instance) => instance.id === serviceId);
}

function migrateLegacyModel(next: Config, legacyName: string, service: string, selectedModel: string): void {
    if (legacyName === 'ollama') {
        const knownModels = models.get(service) || [];
        if (knownModels.includes(selectedModel) && selectedModel !== customModelString) {
            next.model[service] = selectedModel;
        } else {
            next.model[service] = customModelString;
            next.customModel[service] = selectedModel;
        }
        return;
    }

    const defaultModel = defaultModels.get(service);
    next.model[service] = defaultModel && legacyDefaultModels[legacyName]?.has(selectedModel)
        ? defaultModel
        : selectedModel;
}

function preserveLegacyYiyanCredentials(next: Config, value: unknown): void {
    if (!isRecord(value)) return;
    const accessToken = nonEmptyString(value.token);
    const ak = nonEmptyString(value.ak);
    const sk = nonEmptyString(value.sk);
    if (accessToken) next.token[services.yiyan] = accessToken;
    if (ak) next.ak = ak;
    if (sk) next.sk = sk;
}

function allowLegacyOllamaWithoutApiKey(next: Config): void {
    next.requireApiKey[getApiKeyRequirementKey(services.custom, next)] = false;
}

async function migrateLegacyConfig(): Promise<Config> {
    const next = new Config();
    next.disableFloatingBall = false;
    next.contextMenuEnabled = false;
    next.disableImageTranslator = true;
    next.selectionAreaEnabled = false;
    next.videoTranslationEnabled = false;

    const legacyService = String(await getStoredValue('model') || '');
    if (legacyService) next.service = legacyServiceMap[legacyService] || services.microsoft;
    const from = await getStoredValue<string>('from');
    const to = await getStoredValue<string>('to');
    const hotkey = await getStoredValue<string>('hotkey');
    if (from) next.from = from;
    if (to) next.to = to;
    if (hotkey) next.hotkey = hotkey;

    for (const [legacyName, service] of Object.entries(legacyServiceMap)) {
        const selectedModel = await getStoredValue<string>(`model_${legacyName}`);
        if (selectedModel) migrateLegacyModel(next, legacyName, service, selectedModel);
        const token = await getStoredValue<unknown>(`token_${legacyName}`);
        if (typeof token === 'string' && token) next.token[service] = token;
        if (legacyName === 'yiyan') preserveLegacyYiyanCredentials(next, token);
        if (legacyName === 'zhipu' && token && typeof token === 'object') {
            const apiKey = (token as {apikey?: unknown}).apikey;
            if (typeof apiKey === 'string') next.token[service] = apiKey;
        }
    }

    const systemRole = await getStoredValue<string>('systemMsg');
    const userRole = await getStoredValue<string>('userMsg');
    const legacyAiServices = new Set(Object.values(legacyServiceMap).filter(service => servicesType.isAI(service)));
    legacyAiServices.forEach((service) => {
        if (systemRole) next.system_role[service] = systemRole;
        if (userRole) next.user_role[service] = userRole;
    });

    const legacyOpenAiUrl = await getStoredValue<string>('openai_url');
    if (legacyOpenAiUrl && legacyOpenAiUrl !== 'https://api.openai.com/v1/chat/completions') {
        next.proxy[services.openai] = legacyOpenAiUrl;
    }
    const legacyOllamaUrl = await getStoredValue<string>('ollama_url');
    if (legacyOllamaUrl) next.custom = legacyOllamaUrl;
    if (legacyOllamaUrl || await getStoredValue<string>('model_ollama')) {
        allowLegacyOllamaWithoutApiKey(next);
    }

    // Config() already contains the new machine-only inventory. Omitting that
    // field here lets normalizeConfig infer the AI instances genuinely present
    // in the legacy provider-keyed data before the inventory becomes explicit.
    const legacyConfig = {...next, translationServices: undefined};
    return normalizeUserscriptConfig(legacyConfig);
}

/** Seed or migrate once, then enforce the userscript capability boundary on every startup. */
export async function ensureUserscriptConfig(): Promise<void> {
    const existing = await getStoredValue(CONFIG_STORAGE_KEY);
    if (existing === null || existing === undefined) {
        await setStoredValue(CONFIG_STORAGE_KEY, await migrateLegacyConfig());
        return;
    }

    const normalized = normalizeConfig(existing);
    const safe = normalizeUserscriptConfig(existing);
    if (JSON.stringify(normalized) !== JSON.stringify(safe)) {
        await setStoredValue(CONFIG_STORAGE_KEY, safe);
    }
}
