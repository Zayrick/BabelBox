export type CustomBody = Record<string, unknown>;

// 留空表示不启用自定义请求体；非空值必须是 JSON 对象。
export function parseCustomBody(raw?: unknown): CustomBody | undefined {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'string') return undefined;
    if (!raw.trim()) return {};

    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as CustomBody;
        }
    } catch {
        // 由调用方决定如何提示非法配置。
    }

    return undefined;
}

export function isValidCustomBody(raw?: unknown): boolean {
    return parseCustomBody(raw) !== undefined;
}

// 顶层浅合并，用户字段优先；返回新对象以避免修改原始 payload。
export function mergeCustomBody<T extends Record<string, unknown>>(payload: T, raw?: unknown): T {
    const customBody = parseCustomBody(raw);
    if (customBody === undefined) {
        console.warn('[BabelBox] 自定义请求体必须是合法的 JSON 对象，已忽略');
        return payload;
    }

    return {...payload, ...customBody};
}
