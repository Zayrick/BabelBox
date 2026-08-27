import { describe, expect, it, vi } from 'vitest';

vi.mock('@wxt-dev/storage', () => ({
    storage: {
        getItem: vi.fn().mockResolvedValue(null),
        setItem: vi.fn().mockResolvedValue(undefined),
        watch: vi.fn().mockReturnValue(() => undefined),
    },
}));
vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));
import {
    getVideoSubtitleDownloadErrorMessage,
    getVideoServiceLabel,
    getVideoPretranslationWindowMs,
    isYouTubeVideoPage,
    isIncrementalVideoCaption,
    normalizeVideoSubtitleDisplayMode,
    normalizeVideoCaptionText,
    readVisibleCaptionText,
    revealVideoSubtitleTranslation,
    translateVideoSubtitleCues,
    VIDEO_CAPTION_SEGMENT_SELECTOR,
} from '@/src/features/video-subtitle/content/runtime';
import {normalizeVideoSubtitleFontSize} from '@/src/core/config/model';

describe('YouTube 视频字幕识别', () => {
    it('只把 YouTube 视频页识别为视频字幕目标', () => {
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'youtube-nocookie.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/results' })).toBe(false);
        expect(isYouTubeVideoPage({ hostname: 'example.com', pathname: '/watch' })).toBe(false);
    });

    it('按播放器中的字幕片段合并文本，并忽略空片段', () => {
        const segments = [
            { textContent: '  This is ', contains: () => false },
            { textContent: 'a test.\n', contains: () => false },
            { textContent: '', contains: () => false },
        ];
        const container = {
            querySelectorAll: (selector: string) => {
                expect(selector).toBe(VIDEO_CAPTION_SEGMENT_SELECTOR);
                return segments;
            },
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('This is a test.');
        expect(readVisibleCaptionText(null)).toBe('');
    });

    it('优先读取叶子字幕片段，避免 YouTube 嵌套节点重复拼接', () => {
        const child = { textContent: 'A subtitle.', contains: () => false };
        const parent = { textContent: 'A subtitle.', contains: (node: unknown) => node === child };
        const container = {
            querySelectorAll: () => [parent, child],
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('A subtitle.');
    });

    it('存在原生字幕片段时忽略字幕设置等 captions-text 文本', () => {
        const subtitle = { textContent: 'the axioms and the basics.', contains: () => false };
        const settings = { textContent: '英语（自动生成）点击 查看设置', contains: () => false };
        const container = {
            querySelectorAll: (selector: string) => selector === VIDEO_CAPTION_SEGMENT_SELECTOR ? [subtitle] : [settings],
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('the axioms and the basics.');
    });

    it('保留播放器菜单需要的三种显示模式，并为服务显示用户可读名称', () => {
        expect(normalizeVideoSubtitleDisplayMode('translation-only')).toBe('translation-only');
        expect(normalizeVideoSubtitleDisplayMode('original-only')).toBe('original-only');
        expect(normalizeVideoSubtitleDisplayMode('unknown')).toBe('bilingual');
        expect(getVideoServiceLabel('microsoft')).toBe('微软翻译');
        expect(getVideoServiceLabel('custom-service')).toBe('custom-service');
        expect(getVideoPretranslationWindowMs('microsoft')).toBe(10_000);
        expect(getVideoPretranslationWindowMs('openai')).toBe(30_000);
        expect(normalizeVideoSubtitleFontSize(undefined)).toBe(100);
        expect(normalizeVideoSubtitleFontSize(125)).toBe(130);
        expect(normalizeVideoSubtitleFontSize(10)).toBe(80);
        expect(normalizeVideoSubtitleFontSize(200)).toBe(160);
    });

    it('按原生字幕已经显示的前缀揭示完整 cue 的译文，并保留一次性完整字幕的整句结果', () => {
        const fullSource = 'understand from [music] the axioms and the basics.';
        const fullTranslation = '从音乐中理解公理和基础。';

        expect(normalizeVideoCaptionText('  understand\nfrom   [music]  ')).toBe('understand from [music]');
        expect(revealVideoSubtitleTranslation(fullTranslation, 'understand', fullSource)).toBe('从音乐');
        expect(revealVideoSubtitleTranslation(fullTranslation, 'understand from [music] the axioms and', fullSource)).toBe('从音乐中理解公理和基');
        expect(revealVideoSubtitleTranslation(fullTranslation, fullSource, fullSource)).toBe(fullTranslation);
        expect(revealVideoSubtitleTranslation(fullTranslation, 'unrelated subtitle', fullSource)).toBe(fullTranslation);
    });

    it('识别逐词前缀并允许播放器改用完整原文 cue', () => {
        expect(isIncrementalVideoCaption('understand from', 'understand from [music] the axioms and the basics.')).toBe(true);
        expect(isIncrementalVideoCaption('understand from [music] the axioms and the basics.', 'understand from [music] the axioms and the basics.')).toBe(false);
        expect(isIncrementalVideoCaption('unrelated subtitle', 'understand from [music] the axioms and the basics.')).toBe(false);
    });

    it('把原文字幕下载失败转换为用户可操作的提示', () => {
        expect(getVideoSubtitleDownloadErrorMessage(new Error('当前视频没有可用的 YouTube 字幕轨道'))).toBe('当前视频没有字幕');
        expect(getVideoSubtitleDownloadErrorMessage(new Error('YouTube 未返回完整字幕数据，请先打开原生字幕后重试'))).toBe('请先开启 YouTube 字幕');
        expect(getVideoSubtitleDownloadErrorMessage(new Error('字幕轨道请求失败（403）'))).toBe('获取失败，请重试');
        expect(getVideoSubtitleDownloadErrorMessage(new Error('unknown'))).toBe('下载失败，请重试');
    });

    it('下载译文字幕时去重原文、限制并发并保留完整时间轴', async () => {
        let active = 0;
        let maxActive = 0;
        const progress: Array<[number, number]> = [];
        const translate = vi.fn(async (source: string) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active -= 1;
            return `译文：${source}`;
        });
        const cues = [
            { startMs: 0, durationMs: 1000, text: 'First subtitle.' },
            { startMs: 1200, durationMs: 900, text: 'Repeated subtitle.' },
            { startMs: 2300, durationMs: 900, text: 'Repeated subtitle.' },
            { startMs: 3500, durationMs: 1200, text: 'Last subtitle.' },
        ];

        const translated = await translateVideoSubtitleCues(cues, translate, {
            concurrency: 2,
            onProgress: (completed, total) => progress.push([completed, total]),
        });

        expect(translate).toHaveBeenCalledTimes(3);
        expect(maxActive).toBe(2);
        expect(progress[0]).toEqual([0, 3]);
        expect(progress.at(-1)).toEqual([3, 3]);
        expect(translated).toEqual(cues.map(cue => ({ ...cue, text: `译文：${cue.text}` })));
    });

    it('完整字幕中任一段翻译失败时拒绝生成残缺译文', async () => {
        const cues = [
            { startMs: 0, durationMs: 1000, text: 'First subtitle.' },
            { startMs: 1200, durationMs: 1000, text: 'Broken subtitle.' },
        ];

        await expect(translateVideoSubtitleCues(cues, async (source) => {
            if (source === 'Broken subtitle.') throw new Error('fixture translation failed');
            return `译文：${source}`;
        }, { concurrency: 1 })).rejects.toThrow('fixture translation failed');
    });
});
