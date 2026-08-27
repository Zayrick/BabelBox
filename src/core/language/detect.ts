import {franc} from 'franc-min';

const FLUENTREAD_LANGUAGE_CODES: Readonly<Record<string, string>> = {
    cmn: 'zh-Hans',
    eng: 'en',
    fra: 'fr',
    jpn: 'ja',
    kor: 'ko',
    rus: 'ru',
};

/** 将 franc 的 ISO 639-3 结果映射为 FluentRead 配置使用的语言代码。 */
export function detectlang(origin: string): string {
    const detected = franc(origin, {minLength: 0});
    return FLUENTREAD_LANGUAGE_CODES[detected] ?? detected;
}
