import { describe, expect, it } from 'vitest';
import {
  buildYoutubeTimedTextUrl,
  chooseYoutubeCaptionTrack,
  cuesToSrt,
  extractYoutubeCaptionTracks,
  finalizeVideoSubtitleCues,
  parseYoutubeTimedTextResponse,
  sanitizeSubtitleFilename,
} from '@/src/features/video-subtitle/content/youtubeSubtitleData';

describe('YouTube 字幕轨道数据', () => {
  it('从初始化脚本提取字幕轨道并优先选择指定语言的人工作品', () => {
    const playerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=en', languageCode: 'en', kind: 'asr' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh-CN', languageCode: 'zh-CN', name: { simpleText: '中文' } },
          ],
        },
      },
    };
    const script = { textContent: `var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};` };
    const root = { querySelectorAll: () => [script] } as unknown as ParentNode;

    const tracks = extractYoutubeCaptionTracks(root);

    expect(tracks).toHaveLength(2);
    expect(chooseYoutubeCaptionTrack(tracks, 'zh-CN')).toMatchObject({ languageCode: 'zh-CN', name: '中文' });
    expect(chooseYoutubeCaptionTrack(tracks, 'auto')).toMatchObject({ languageCode: 'zh-CN' });
  });

  it('解析 JSON3 和 XML timedtext，并补齐缺失的结束时间', () => {
    const json3 = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'Hello &amp; welcome' }] },
        { tStartMs: 1200, segs: [{ utf8: 'Next<br>line' }] },
      ],
    });
    const jsonCues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(json3));
    expect(jsonCues).toEqual([
      { startMs: 0, durationMs: 900, text: 'Hello & welcome' },
      { startMs: 1200, durationMs: 2000, text: 'Next\nline' },
    ]);

    const xmlCues = parseYoutubeTimedTextResponse('<transcript><text start="1.5" dur="2">&lt;hello&gt;</text></transcript>');
    expect(xmlCues).toEqual([{ startMs: 1500, durationMs: 2000, text: '<hello>' }]);
  });

  it('合并同一时间点逐步增长的 cue，只保留完整版本', () => {
    const cues = finalizeVideoSubtitleCues([
      { startMs: 0, durationMs: 600, text: 'I' },
      { startMs: 0, durationMs: 1200, text: 'I think' },
      { startMs: 0, durationMs: 2200, text: 'I think this works.' },
    ]);

    expect(cues).toEqual([{ startMs: 0, durationMs: 2200, text: 'I think this works.' }]);
  });

  it('把连续逐词 cue 合并成一段短句，避免播放器按单词闪动', () => {
    const cues = finalizeVideoSubtitleCues([
      { startMs: 0, durationMs: 650, text: 'This' },
      { startMs: 600, durationMs: 650, text: 'is' },
      { startMs: 1200, durationMs: 650, text: 'a' },
      { startMs: 1800, durationMs: 900, text: 'test.' },
      { startMs: 4000, durationMs: 1200, text: 'Next sentence.' },
    ]);

    expect(cues).toEqual([
      { startMs: 0, durationMs: 2700, text: 'This is a test.' },
      { startMs: 4000, durationMs: 1200, text: 'Next sentence.' },
    ]);
  });

  it('生成可被播放器使用的 SRT 时间轴和 timedtext URL', () => {
    const srt = cuesToSrt([{ startMs: 0, durationMs: 1250, text: '第一句' }]);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,250');
    expect(srt).toContain('第一句');

    const url = buildYoutubeTimedTextUrl({
      baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en',
      languageCode: 'en',
    });
    expect(url).toContain('fmt=json3');
    expect(url).toContain('xorb=2');
    expect(url).toContain('cplayer=UNIPLAYER');
  });

  it('对异常 YouTube 初始化脚本和轨道选择输入安全降级', () => {
    const root = {
      querySelectorAll: () => [
        { textContent: 'var unrelated = true;' },
        { textContent: 'playerCaptionsTracklistRenderer ytInitialPlayerResponse = {"captions":' },
        { textContent: 'playerCaptionsTracklistRenderer ytInitialPlayerResponse = {"captions":};' },
        { textContent: 'playerCaptionsTracklistRenderer ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"","languageCode":"en"},{"baseUrl":"https://example.com/t","languageCode":""},{"baseUrl":"https://example.com/ok","languageCode":"ja","kind":4,"name":{"simpleText":7}}]}}};' },
      ],
    } as unknown as ParentNode;

    expect(extractYoutubeCaptionTracks({querySelectorAll: () => []} as unknown as ParentNode)).toEqual([]);
    expect(extractYoutubeCaptionTracks(root)).toEqual([{
      baseUrl: 'https://example.com/ok',
      languageCode: 'ja',
      kind: undefined,
      name: undefined,
    }]);
    expect(chooseYoutubeCaptionTrack([], 'en')).toBeNull();
    expect(chooseYoutubeCaptionTrack([
      {baseUrl: 'https://example.com/asr', languageCode: 'en', kind: 'asr'},
      {baseUrl: 'https://example.com/human', languageCode: 'fr'},
    ], 'en')).toMatchObject({languageCode: 'fr'});
    expect(chooseYoutubeCaptionTrack([
      {baseUrl: 'https://example.com/asr', languageCode: 'en', kind: 'asr'},
    ])).toMatchObject({languageCode: 'en', kind: 'asr'});
  });

  it('初始化脚本扫描兼容空文本、无 marker、转义字符串和损坏轨道字段', () => {
    const escapedResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: 'https://example.com/timedtext?value=\\path',
            languageCode: 'en',
            name: {simpleText: 'A "quoted" track'},
          }],
        },
      },
    };
    const escapedRoot = {
      querySelectorAll: () => [
        {textContent: null},
        {textContent: `playerCaptionsTracklistRenderer ${JSON.stringify(escapedResponse)}`},
      ],
    } as unknown as ParentNode;
    expect(extractYoutubeCaptionTracks(escapedRoot)).toEqual([expect.objectContaining({
      languageCode: 'en',
      name: 'A "quoted" track',
    })]);

    const malformedRoot = {
      querySelectorAll: () => [
        {textContent: 'playerCaptionsTracklistRenderer ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":{}}}};'},
        {textContent: 'playerCaptionsTracklistRenderer ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":7,"languageCode":"en"},{"baseUrl":"https://example.com","languageCode":9}]}}};'},
      ],
    } as unknown as ParentNode;
    expect(extractYoutubeCaptionTracks(malformedRoot)).toEqual([]);
  });

  it('解析空响应、无效 JSON3、DOMParser XML 和正则 XML 回退的边界输入', () => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    try {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
          createElement: () => {
            const textarea = {value: ''};
            Object.defineProperty(textarea, 'innerHTML', {
              set: (value: string) => {
                textarea.value = value.replace(/&amp;/g, '&');
              },
            });
            return textarea;
          },
        },
      });
      expect(parseYoutubeTimedTextResponse(JSON.stringify({
        events: [{tStartMs: 0, dDurationMs: 100, segs: [{utf8: 'A &amp; B'}]}],
      }))).toEqual([{startMs: 0, durationMs: 100, text: 'A & B'}]);
    } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }

    expect(parseYoutubeTimedTextResponse('   ')).toEqual([]);
    expect(parseYoutubeTimedTextResponse('null')).toEqual([]);
    expect(parseYoutubeTimedTextResponse('{}')).toEqual([]);
    expect(parseYoutubeTimedTextResponse(JSON.stringify({
      events: [
        {tStartMs: 'bad', segs: [{utf8: 'ignored'}]},
        {tStartMs: 100, segs: 'bad'},
        {tStartMs: '200', dDurationMs: '450', segs: [{utf8: 7}, {utf8: ' Valid &quot;text&quot;'}]},
        {tStartMs: 300, segs: [{utf8: '<b></b>'}]},
      ],
    }))).toEqual([{startMs: 200, durationMs: 450, text: 'Valid "text"'}]);

    const previousParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
    class FixtureDOMParser {
      parseFromString() {
        return {
          querySelectorAll: () => [
            {
              getAttribute: () => null,
              textContent: null,
            },
            {
              getAttribute: (name: string) => name === 'start' ? 'not-finite' : '1',
              textContent: 'ignored',
            },
            {
              getAttribute: (name: string) => name === 'start' ? '2.5' : '',
              textContent: 'DOM &amp; XML',
            },
          ],
        };
      }
    }

    try {
      Object.defineProperty(globalThis, 'DOMParser', {
        configurable: true,
        value: FixtureDOMParser,
      });
      expect(parseYoutubeTimedTextResponse('<transcript><text start="2.5">DOM &amp; XML</text></transcript>')).toEqual([
        {startMs: 2500, durationMs: 0, text: 'DOM & XML'},
      ]);
    } finally {
      if (previousParser) Object.defineProperty(globalThis, 'DOMParser', previousParser);
      else Reflect.deleteProperty(globalThis, 'DOMParser');
    }

    expect(parseYoutubeTimedTextResponse('<text dur="1">missing start</text><text start="bad">bad</text><text start="3">&lt;regex&gt;</text>')).toEqual([
      {startMs: 3000, durationMs: 0, text: '<regex>'},
    ]);
  });

  it('整理异常时间轴、视频 id 和字幕文件名', () => {
    expect(finalizeVideoSubtitleCues([
      {startMs: Number.NaN, durationMs: 100, text: 'bad'},
      {startMs: 5000, durationMs: 0, text: '   '},
      {startMs: 0, durationMs: 0, text: 'First'},
      {startMs: 0, durationMs: 100, text: 'First'},
      {startMs: 12000, durationMs: -1, text: 'Last'},
    ])).toEqual([
      {startMs: 0, durationMs: 500, text: 'First'},
      {startMs: 12000, durationMs: 2000, text: 'Last'},
    ]);

    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 600, text: '你好'},
      {startMs: 550, durationMs: 600, text: '世界'},
      {startMs: 1100, durationMs: 600, text: '再见'},
      {startMs: 1650, durationMs: 600, text: '。'},
      {startMs: 7000, durationMs: 400, text: 'one'},
      {startMs: 9000, durationMs: 400, text: 'go'},
      {startMs: 9300, durationMs: 400, text: 'too'},
      {startMs: 9600, durationMs: 400, text: 'far'},
      {startMs: 9900, durationMs: 400, text: 'merge.'},
    ])).toEqual([
      {startMs: 0, durationMs: 2250, text: '你好世界再见。'},
      {startMs: 7000, durationMs: 400, text: 'one'},
      {startMs: 9000, durationMs: 1400, text: 'go too far merge.'},
    ]);

    expect(cuesToSrt([{startMs: -100, durationMs: 20, text: 'early'}])).toContain('00:00:00,000 --> 00:00:00,000');
    expect(sanitizeSubtitleFilename('  bad:/name*with?spaces  ')).toBe('bad_name_with_spaces');
    expect(sanitizeSubtitleFilename('   ')).toBe('youtube-subtitles');
  });

  it('逐词流在回退、超间隔、非终止长 cue、词数与总时长边界停止合并', () => {
    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 500, text: 'A complete terminal sentence.'},
      {startMs: 700, durationMs: 500, text: 'tail'},
    ])).toHaveLength(2);
    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 500, text: 'word'},
      {startMs: 500, durationMs: 500, text: 'A complete terminal sentence.'},
    ])).toHaveLength(2);
    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 500, text: 'one'},
      {startMs: 450, durationMs: 500, text: 'two'},
      {startMs: 900, durationMs: 500, text: 'three'},
      {startMs: 4000, durationMs: 500, text: 'far'},
    ])).toHaveLength(2);
    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 500, text: 'one'},
      {startMs: 450, durationMs: 500, text: 'two'},
      {startMs: 900, durationMs: 500, text: 'three'},
      {startMs: 1350, durationMs: 500, text: 'this is a long continuation without punctuation'},
    ])).toHaveLength(2);

    const wordLimit = finalizeVideoSubtitleCues(Array.from({length: 8}, (_, index) => ({
      startMs: index * 450,
      durationMs: 500,
      text: `w${index} x${index}`,
    })));
    expect(wordLimit.length).toBeGreaterThan(1);

    const durationLimit = finalizeVideoSubtitleCues(Array.from({length: 8}, (_, index) => ({
      startMs: index * 1500,
      durationMs: 1000,
      text: `w${index}`,
    })));
    expect(durationLimit.length).toBeGreaterThan(1);
  });

  it('同起点增量 cue 在较短版本迟到时仍保留较长 winner', () => {
    expect(finalizeVideoSubtitleCues([
      {startMs: 0, durationMs: 2000, text: 'complete phrase'},
      {startMs: 0, durationMs: 500, text: 'complete'},
    ])).toEqual([{startMs: 0, durationMs: 2000, text: 'complete phrase'}]);
  });
});
