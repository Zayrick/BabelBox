import {
    normalizeSelectionTtsVoiceOrder,
    selectionTtsVoiceLocale,
} from '@/src/features/selection-translation/ttsConfig';

export const edgeTtsLimits = Object.freeze({
    chunkBytes: 1_800,
    chunks: 8,
    fallbackTokenLifetimeMs: 8 * 60 * 1_000,
});

const VOICE_CANDIDATES_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
    'en-US': ['en-US-AvaMultilingualNeural', 'en-US-AriaNeural', 'en-US-JennyNeural', 'en-US-GuyNeural'],
    'en-GB': ['en-GB-SoniaNeural', 'en-GB-RyanNeural'],
    'zh-CN': ['zh-CN-XiaoxiaoMultilingualNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunyangNeural'],
    'zh-TW': ['zh-TW-YunJheMultilingualNeural', 'zh-TW-HsiaoChenNeural', 'zh-TW-HsiaoYuNeural'],
    'ja-JP': ['ja-JP-MasaruMultilingualNeural', 'ja-JP-NanamiNeural'],
    'ko-KR': ['ko-KR-HyunsuMultilingualNeural', 'ko-KR-SunHiNeural'],
    'fr-FR': ['fr-FR-RemyMultilingualNeural'],
    'de-DE': ['de-DE-FlorianMultilingualNeural'],
    'es-ES': ['es-ES-TristanMultilingualNeural'],
    'it-IT': ['it-IT-AlessioMultilingualNeural'],
    'pt-BR': ['pt-BR-MacerioMultilingualNeural'],
};

export function normalizeEdgeTtsLanguage(language: string): string {
    const normalized = String(language || '').replace(/_/gu, '-').trim();
    if (!normalized || normalized === 'auto' || normalized === 'detect') return 'en-US';
    if (normalized.toLowerCase() === 'zh-hans') return 'zh-CN';
    if (normalized.toLowerCase() === 'zh-hant') return 'zh-TW';
    if (normalized.toLowerCase() === 'en') return 'en-US';
    return normalized;
}

/** 用户音色优先，同语言的内置候选随后兜底，并保持稳定顺序与去重。 */
export function edgeTtsVoiceCandidatesForLanguage(
    language: string,
    preferredVoices: unknown = [],
): string[] {
    const normalized = normalizeEdgeTtsLanguage(language);
    const base = normalized.split('-')[0];
    const automatic = VOICE_CANDIDATES_BY_LANGUAGE[normalized]
        || Object.entries(VOICE_CANDIDATES_BY_LANGUAGE)
            .find(([locale]) => locale.startsWith(`${base}-`))?.[1]
        || [];
    const preferred = normalizeSelectionTtsVoiceOrder(preferredVoices)
        .filter((voice) => selectionTtsVoiceLocale(voice) === normalized);
    return [...new Set([...preferred, ...automatic])];
}

export function edgeTtsVoiceForLanguage(language: string): string | null {
    return edgeTtsVoiceCandidatesForLanguage(language)[0] ?? null;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

export function buildEdgeTtsSsml(
    text: string,
    voice: string,
    rate = '+0%',
    pitch = '+0Hz',
    volume = '+0%',
): string {
    const locale = voice.split('-').slice(0, 2).join('-') || 'en-US';
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(locale)}"><voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}" volume="${escapeXml(volume)}">${escapeXml(text.trim())}</prosody></voice></speak>`;
}

/** 按 UTF-8 字节预算切分，优先在句号或空格处断开。 */
export function splitEdgeTtsText(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();
    while (remaining) {
        const bytes = new TextEncoder().encode(remaining);
        if (bytes.byteLength <= edgeTtsLimits.chunkBytes) {
            chunks.push(remaining);
            break;
        }
        let end = Math.min(remaining.length, edgeTtsLimits.chunkBytes);
        while (
            end > 1
            && new TextEncoder().encode(remaining.slice(0, end)).byteLength > edgeTtsLimits.chunkBytes
        ) end -= 1;
        const boundary = Math.max(
            remaining.lastIndexOf(' ', end),
            remaining.lastIndexOf('。', end),
            remaining.lastIndexOf('.', end),
        );
        if (boundary > Math.floor(end * 0.6)) end = boundary + 1;
        chunks.push(remaining.slice(0, end).trim());
        remaining = remaining.slice(end).trim();
        if (chunks.length > edgeTtsLimits.chunks) throw new Error('Edge TTS text is too long');
    }
    return chunks;
}

export function concatEdgeTtsAudio(buffers: readonly ArrayBuffer[]): ArrayBuffer {
    const total = buffers.reduce((size, buffer) => size + buffer.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const buffer of buffers) {
        output.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }
    return output.buffer;
}

/** JWT 无法解析或缺少 exp 时使用短生命周期，避免长期复用未知 token。 */
export function edgeTtsTokenExpiry(token: string, now = Date.now()): number {
    const fallback = now + edgeTtsLimits.fallbackTokenLifetimeMs;
    try {
        const payload = token.split('.')[1];
        if (!payload) return fallback;
        const padded = payload
            .replace(/-/gu, '+')
            .replace(/_/gu, '/')
            .padEnd(Math.ceil(payload.length / 4) * 4, '=');
        const decoded = JSON.parse(atob(padded)) as {exp?: unknown};
        return typeof decoded.exp === 'number' ? decoded.exp * 1_000 : fallback;
    } catch {
        return fallback;
    }
}
