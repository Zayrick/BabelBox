export const CONFIG_COUNT_INCREMENT_MESSAGE = 'incrementConfigCount' as const;

export function parseConfigCountIncrement(value: unknown): number | null {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        ? value
        : null;
}
