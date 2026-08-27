import {
    imageBufferToDataUrl,
    MAX_REMOTE_IMAGE_BYTES,
    normalizeRemoteImageUrl,
} from '@/src/features/image-translation/services/remoteImage';

export interface RemoteImageResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: {
        get(name: string): string | null;
    };
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type RemoteImageRequest = (
    url: string,
    init: {credentials: 'omit'; redirect: 'follow'},
) => Promise<RemoteImageResponse>;

/** 读取远程图片；URL、响应状态、声明大小和实际 MIME/大小逐层验证。 */
export async function fetchRemoteImageForOcr(
    source: string,
    request: RemoteImageRequest,
): Promise<string> {
    const url = normalizeRemoteImageUrl(source);
    const response = await request(url, {credentials: 'omit', redirect: 'follow'});
    if (!response.ok) throw new Error(`图片服务器返回 ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片文件过大');

    const contentType = response.headers.get('content-type') || '';
    const buffer = await response.arrayBuffer();
    return imageBufferToDataUrl(buffer, contentType);
}
