type HttpStatus = Pick<Response, 'status' | 'statusText'>;
type JsonResponse = Pick<Response, 'json'>;

const MAX_PROVIDER_CODE_LENGTH = 16;

/**
 * 构造不回显第三方响应正文的 HTTP 错误。
 * 正文可能包含原文、译文、provider 诊断或代理回显的凭据，因此只暴露协议状态码。
 */
export function createHttpStatusError(response: HttpStatus, label = '请求失败'): Error {
    return new Error(`${label}: ${response.status}`);
}

/** 只有短小且确实形似数字错误码的 provider 字段可以回显。 */
export function getSafeProviderErrorCode(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;

    const code = String(value).trim();
    if (
        code.length === 0
        || code.length > MAX_PROVIDER_CODE_LENGTH
        || !/^\d+$/.test(code)
    ) {
        return undefined;
    }
    return code;
}

export function createProviderCodeError(label: string, value: unknown): Error {
    const code = getSafeProviderErrorCode(value);
    return new Error(code ? `${label}（错误码 ${code}）` : label);
}

/**
 * 解析第三方 JSON，但不传播 parser 自带的输入预览。
 * V8 的 SyntaxError 可能包含损坏 JSON 的片段，其中可能有原文或代理诊断。
 */
export async function readJsonResponse<T = unknown>(
    response: JsonResponse,
    label = '返回的不是有效 JSON',
): Promise<T> {
    try {
        return await response.json() as T;
    } catch {
        throw new Error(label);
    }
}
