import {browser} from 'wxt/browser';
import { selectChangedTranslations, type OcrLine } from '@/src/features/image-translation/core';
import { areaRectToImageCrop, type AreaTranslationSelection } from '@/src/features/area-translation/protocol';
import { inpaintTextRegions } from './inpainting';
import { recognizeImage } from './ocrRuntime';
import { getImageTextBackgroundColor, getImageTextColor } from './rendering';

export type OffscreenImageTranslationLine = OcrLine & { backgroundColor: string };

export interface OffscreenImageTranslationResult {
    image: string;
    lines: OffscreenImageTranslationLine[];
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const source = new Image();
        source.onload = () => resolve(source);
        source.onerror = () => reject(new Error('图片数据无法解码'));
        source.src = dataUrl;
    });
}

function drawTranslatedText(
    context: CanvasRenderingContext2D,
    text: string,
    left: number,
    top: number,
    width: number,
    height: number,
    backgroundColor: string,
): void {
    const horizontalPadding = Math.max(3, Math.round(height * 0.14));
    let fontSize = Math.max(10, Math.min(30, height * 0.76));
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = getImageTextColor(backgroundColor);
    const maxWidth = Math.max(1, width - horizontalPadding * 2);
    const getTokens = () => /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(text)
        ? Array.from(text.replace(/\s+/g, ''))
        : text.trim().split(/\s+/).filter(Boolean);
    const getLines = () => {
        const lines: string[] = [];
        let current = '';
        getTokens().forEach(token => {
            const candidate = current
                ? `${current}${/[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(token) ? '' : ' '}${token}`
                : token;
            if (current && context.measureText(candidate).width > maxWidth) {
                lines.push(current);
                current = token;
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current);
        return lines.length ? lines : [''];
    };
    let lines: string[] = [];
    while (fontSize >= 10) {
        context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        lines = getLines();
        const lineHeight = fontSize * 1.14;
        if (lines.length <= 3 && lines.length * lineHeight <= height - 2) break;
        fontSize -= 1;
    }
    const lineHeight = fontSize * 1.14;
    const firstLineTop = top + (height - lineHeight * lines.length) / 2 + lineHeight / 2;
    lines.slice(0, 3).forEach((line, index) => {
        context.fillText(line, left + width / 2, firstLineTop + index * lineHeight, maxWidth);
    });
}

async function translateTexts(texts: string[], title: string): Promise<string[]> {
    const response = await browser.runtime.sendMessage({
        type: 'fluentReadImageTranslateTexts',
        texts,
        title,
    }) as {success?: boolean; translations?: unknown; error?: string} | undefined;
    if (!response?.success || !Array.isArray(response.translations)) {
        throw new Error(response?.error || '图片文字翻译失败');
    }
    return response.translations;
}

async function cropImage(dataUrl: string, selection: AreaTranslationSelection): Promise<string> {
    const source = await loadImage(dataUrl);
    const imageWidth = source.naturalWidth || source.width;
    const imageHeight = source.naturalHeight || source.height;
    const crop = areaRectToImageCrop(selection, imageWidth, imageHeight);
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) throw new Error('浏览器不支持区域截图处理');
    context.drawImage(source, crop.left, crop.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return canvas.toDataURL('image/png');
}

async function prepareTranslatedImage(
    dataUrl: string,
    lines: OcrLine[],
    translations: string[],
): Promise<OffscreenImageTranslationResult> {
    const source = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
        throw new Error('浏览器不支持图片处理');
    }

    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const translatedLines = selectChangedTranslations(lines, translations);
    if (translatedLines.length === 0) {
        throw new Error('图片中没有需要翻译的文字');
    }
    const pixels = inpaintTextRegions(sourcePixels.data, canvas.width, canvas.height, translatedLines);
    sourcePixels.data.set(pixels);
    context.putImageData(sourcePixels, 0, 0);

    translatedLines.forEach(line => {
        const paddingX = Math.max(3, Math.round((line.bbox.y1 - line.bbox.y0) * 0.14));
        const paddingY = Math.max(2, Math.round((line.bbox.y1 - line.bbox.y0) * 0.18));
        const left = Math.max(0, line.bbox.x0 - paddingX);
        const top = Math.max(0, line.bbox.y0 - paddingY);
        const width = Math.min(canvas.width - left, line.bbox.x1 - line.bbox.x0 + paddingX * 2);
        const height = Math.min(canvas.height - top, line.bbox.y1 - line.bbox.y0 + paddingY * 2);
        drawTranslatedText(
            context,
            line.text,
            left,
            top,
            Math.max(1, width),
            Math.max(1, height),
            getImageTextBackgroundColor(pixels, canvas.width, canvas.height, line.bbox),
        );
    });

    return {
        image: canvas.toDataURL('image/png'),
        lines: translatedLines.map(line => ({
            ...line,
            backgroundColor: getImageTextBackgroundColor(pixels, canvas.width, canvas.height, line.bbox),
        })),
    };
}

export async function translateImageInOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<OffscreenImageTranslationResult> {
    const lines = await recognizeImage(image, sourceLanguage);
    if (lines.length === 0) throw new Error('没有识别到图片文字');
    const translations = await translateTexts(lines.map(line => line.text), title);
    return prepareTranslatedImage(image, lines, translations);
}

export async function translateAreaInOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
    selection: AreaTranslationSelection,
): Promise<OffscreenImageTranslationResult> {
    const croppedImage = await cropImage(image, selection);
    return translateImageInOffscreen(croppedImage, sourceLanguage, title);
}
