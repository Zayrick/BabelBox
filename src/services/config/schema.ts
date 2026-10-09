export function isConfigRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    if (!['service', 'from', 'to'].every((key) => key in parsed)) return null;
    return parsed;
}

export function serializeConfig(value: unknown): string {
    return JSON.stringify(value);
}
