import type { OcrLine } from '@/src/shared/image/types';

/** 从 OCR 框四周采样最常见的量化颜色，供修复后的译文重绘使用。 */
export function getImageTextBackgroundColor(
    pixels: Uint8ClampedArray,
    imageWidth: number,
    imageHeight: number,
    bbox: OcrLine['bbox'],
): string {
    const x0 = Math.max(0, Math.floor(bbox.x0));
    const y0 = Math.max(0, Math.floor(bbox.y0));
    const x1 = Math.min(imageWidth, Math.ceil(bbox.x1));
    const y1 = Math.min(imageHeight, Math.ceil(bbox.y1));
    const colors = new Map<string, number>();
    const sample = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) return;
        const offset = (y * imageWidth + x) * 4;
        const red = Math.min(255, Math.round(pixels[offset] / 16) * 16);
        const green = Math.min(255, Math.round(pixels[offset + 1] / 16) * 16);
        const blue = Math.min(255, Math.round(pixels[offset + 2] / 16) * 16);
        const key = `${red},${green},${blue}`;
        colors.set(key, (colors.get(key) || 0) + 1);
    };
    for (let y = y0 - 4; y <= y1 + 3; y += 1) {
        for (let x = x0 - 4; x <= x1 + 3; x += 1) {
            if (x < x0 || x >= x1 || y < y0 || y >= y1) sample(x, y);
        }
    }
    let best = '255,255,255';
    let bestCount = 0;
    colors.forEach((count, color) => {
        if (count > bestCount) {
            best = color;
            bestCount = count;
        }
    });
    return `rgb(${best})`;
}

/** 按 WCAG 风格亮度阈值选择深色或浅色译文字色。 */
export function getImageTextColor(backgroundColor: string): string {
    const channels = backgroundColor.match(/\d+/g)?.map(Number) || [255, 255, 255];
    const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return luminance > 150 ? '#111827' : '#ffffff';
}
