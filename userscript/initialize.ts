import {Config, normalizeConfig} from '@/src/core/config/model';
import {services, servicesType} from '@/src/core/config/catalog';
import {type TranslationServiceInstance} from '@/src/core/config/translationServices';
import {getStoredValue, setStoredValue} from './storage';

const CONFIG_STORAGE_KEY = 'local:config';

const supportedUserscriptServices = new Set([
    ...servicesType.machine,
    ...servicesType.AI,
]);
supportedUserscriptServices.delete(services.chromeTranslator);

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

function createUserscriptDefaultConfig(): Config {
    const next = new Config();
    next.disableFloatingBall = false;
    return normalizeUserscriptConfig(next);
}

/** Seed once, then enforce the userscript capability boundary on every startup. */
export async function ensureUserscriptConfig(): Promise<void> {
    const existing = await getStoredValue(CONFIG_STORAGE_KEY);
    if (existing === null || existing === undefined) {
        await setStoredValue(CONFIG_STORAGE_KEY, createUserscriptDefaultConfig());
        return;
    }

    const normalized = normalizeConfig(existing);
    const safe = normalizeUserscriptConfig(existing);
    if (JSON.stringify(normalized) !== JSON.stringify(safe)) {
        await setStoredValue(CONFIG_STORAGE_KEY, safe);
    }
}
