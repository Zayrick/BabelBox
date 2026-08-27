export const CONFIG_REVISION_FIELD = '__fluentConfigRevision' as const;

export function isConfigRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getStoredConfigRevision(value: unknown): number {
    if (!isConfigRecord(value)) return 0;
    const revision = value[CONFIG_REVISION_FIELD];
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
        ? revision
        : 0;
}

export function parseStoredConfig(value: unknown): Record<string, unknown> | null {
    let parsed = value;

    if (typeof parsed === 'string') {
        if (!parsed.trim()) return null;
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return null;
        }
    }

    if (!isConfigRecord(parsed)) return null;
    if (!['on', 'service', 'from', 'to'].every((key) => key in parsed)) return null;
    return parsed;
}

export function serializeConfig(value: unknown): string {
    return JSON.stringify(value);
}
