import {animationModeOptions} from './animation';

export const services = {
    // 机器翻译
    microsoft: "microsoft",
    deepL: "deepL",
    deeplx: "deeplx",
    google: "google",
    xiaoniu: "xiaoniu",
    youdao: "youdao",
    tencent: "tencent", // 腾讯云机器翻译
    chromeTranslator: "chromeTranslator", // Chrome 内置翻译 API
    // 大模型翻译
    openai: "openai",
    azureOpenai: "azureOpenai", // Azure OpenAI
    gemini: "gemini",
    yiyan: "yiyan",
    tongyi: "tongyi",
    zhipu: "zhipu",
    moonshot: "moonshot",
    claude: "claude",
    custom: "custom",
    infini: "infini",
    // baidu: 'baidu',
    baichuan: "baichuan",
    lingyi: "lingyi",
    deepseek: "deepseek",
    minimax: "minimax",
    mimo: "mimo", // 小米 MiMo
    jieyue: "jieyue", // 阶跃星辰
    groq: "groq",
    cozecom: "cozecom", // coze 支持机器人不支持模型
    cozecn: "cozecn",
    huanYuan: "huanYuan", // 腾讯混元
    huanYuanTranslation: "huanYuanTranslation", // 腾讯混元翻译大模型
    doubao: "doubao", // 字节豆包
    siliconCloud: "siliconCloud", // 硅流
    openrouter: "openrouter", // openrouter
    grok: "grok", // X.AI 的 Grok
    newapi: "newapi", // New API 接口
};

export const servicesType = {
    // 阵营划分
    machine: new Set([services.microsoft, services.deepL, services.deeplx, services.google, services.xiaoniu, services.youdao, services.tencent, services.chromeTranslator,]),
    AI: new Set([
        services.openai,
        services.azureOpenai,
        services.gemini,
        services.yiyan,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude, services.custom,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.mimo,
        services.jieyue,
        services.groq,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.huanYuanTranslation,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
        services.grok,
        services.newapi,
    ]),
    // 需要 token
    useToken: new Set([
        services.openai,
        services.azureOpenai,
        services.gemini,
        services.yiyan,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude,
        services.deepL,
        services.deeplx,
        services.xiaoniu,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.mimo,
        services.jieyue,
        services.groq,
        services.custom,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
        services.grok,
        services.newapi,
    ]),
    // 需要 model
    useModel: new Set([
        services.openai,
        services.azureOpenai,
        services.gemini,
        services.yiyan,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude,
        services.custom,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.mimo,
        services.jieyue,
        services.groq,
        services.huanYuan,
        services.huanYuanTranslation,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
        services.grok,
        services.newapi,
    ]),
    // 可在服务详情中覆盖请求地址
    customEndpoint: new Set([
        services.openai,
        services.azureOpenai,
        services.gemini,
        services.claude,
        services.deepL,
        services.deeplx,
        services.moonshot,
        services.tongyi,
        services.xiaoniu,
        services.youdao,
        services.tencent,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.mimo,
        services.jieyue,
        services.groq,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.huanYuanTranslation,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
        services.grok,
        services.custom,
        services.newapi,
    ]),
    // 没有默认地址，必须填写请求地址
    requiredEndpoint: new Set([
        services.custom,
        services.newapi,
        services.azureOpenai,
    ]),

    isMachine: (service: string) => servicesType.machine.has(service),
    isAI: (service: string) => servicesType.AI.has(service),
    isUseAIContext: (service: string, model = '') =>
        servicesType.AI.has(service)
        && service !== services.huanYuanTranslation
        && !(service === services.tongyi && model.startsWith('qwen-mt')),
    isUseToken: (service: string) => servicesType.useToken.has(service),
    isCustomEndpoint: (service: string) => servicesType.customEndpoint.has(service),
    isEndpointRequired: (service: string) => servicesType.requiredEndpoint.has(service),
    isUseModel: (service: string) => servicesType.useModel.has(service),
    // 所有 AI 服务的请求体都支持附加顶层字段，包括不使用模型选择器的 Coze。
    isUseCustomBody: (service: string) => servicesType.AI.has(service),
    isCoze: (service: string) => service === services.cozecom || service === services.cozecn,
    isYoudao: (service: string) => service === services.youdao,
    isTencent: (service: string) => service === services.tencent || service === services.huanYuanTranslation,
};

export const minimaxBillingPlans = [
    {value: "payg", label: "按量付费（API）"},
    {value: "token-plan", label: "Token Plan（套餐/积分）"},
] as const;

export type MiniMaxBillingPlan = typeof minimaxBillingPlans[number]["value"];

export const minimaxRegions = [
    {value: "cn", label: "中国版（api.minimaxi.com）"},
    {value: "global", label: "全球版（api.minimax.io）"},
] as const;

export type MiniMaxRegion = typeof minimaxRegions[number]["value"];

export const mimoBillingPlans = [
    {value: "payg", label: "按量付费（API）"},
    {value: "token-plan", label: "Token Plan（套餐/积分）"},
] as const;

export type MiMoBillingPlan = typeof mimoBillingPlans[number]["value"];

export const mimoRegions = [
    {value: "cn", label: "中国集群（token-plan-cn.xiaomimimo.com）"},
    {value: "sgp", label: "新加坡集群（token-plan-sgp.xiaomimimo.com）"},
    {value: "ams", label: "欧洲集群（token-plan-ams.xiaomimimo.com）"},
] as const;

export type MiMoRegion = typeof mimoRegions[number]["value"];

export const options = {
    minimaxBillingPlan: minimaxBillingPlans,
    minimaxRegion: minimaxRegions,
    mimoBillingPlan: mimoBillingPlans,
    mimoRegion: mimoRegions,
    on: [
        {value: true, label: "开启"},
        {value: false, label: "关闭"},
    ],
    // 是否即时翻译
    autoTranslate: [
        {value: true, label: "开启"},
        {value: false, label: "关闭"},
    ],
    // 是否使用缓存
    useCache: [
        {value: true, label: "开启"},
        {value: false, label: "关闭"},
    ],
    form: [{value: "auto", label: "自动检测"}],
    // DeepSeek API 格式（仅 DeepSeek 服务显示）
    deepseekApiType: [
        {value: "auto", label: "自动（Chat Completion）"},
        {value: "responses", label: "Responses API"},
        {value: "chat", label: "Chat Completion"},
    ],
    deepseekThinkingMode: [
        {value: "disabled", label: "关闭（推荐）"},
        {value: "enabled", label: "开启"},
    ],
    to: [
        {value: "zh-Hans", label: "中文"},
        {value: "en", label: "英语"},
        {value: "ja", label: "日语"},
        {value: "ko", label: "韩语"},
        {value: "fr", label: "法语"},
        {value: "ru", label: "俄语"},
    ],
    keys: [
        {value: "none", label: "禁用快捷键"},

        {value: "Computer", label: "键盘选项", disabled: true},
        {value: "Control", label: "Ctrl"},
        {value: "Alt", label: "Alt"},
        {value: "Shift", label: "Shift"},
        {value: "Escape", label: "ESC"},
        {value: "`", label: "波浪号键"},

        {value: "mouse", label: "鼠标选项", disabled: true},
        {value: "DoubleClick", label: "鼠标双击"},
        {value: "LongPress", label: "鼠标长按"},
        {value: "MiddleClick", label: "鼠标滚轮单击"},

        {value: "touchscreen", label: "触屏设备选项", disabled: true},
        {value: "TwoFinger", label: "双指翻译"},
        {value: "ThreeFinger", label: "三指翻译"},
        {value: "FourFinger", label: "四指翻译"},
        {value: "DoubleClickScree", label: "双击翻译"},
        {value: "TripleClickScree", label: "三击翻译"},

        {value: "custom", label: "自定义快捷键（测试版）"},
    ],
    // 划词翻译互斥触发方式。快捷键选择后，不再显示选区旁的图标或小点。
    selectionTranslatorTriggers: [
        {value: "direct", label: "直接弹出"},
        {value: "icon", label: "显示图标"},
        {value: "dot", label: "显示小点"},
        {value: "Control", label: "Ctrl"},
        {value: "Alt", label: "Alt / Option"},
        {value: "Shift", label: "Shift"},
        {value: "custom", label: "自定义"},
    ],
    services: [
        // 机器翻译
        {value: "machine", label: "机器翻译", disabled: true},
        {value: services.microsoft, label: "微软翻译"},
        {value: services.google, label: "谷歌翻译"},
        {value: services.deepL, label: "DeepL"},
        {value: services.deeplx, label: "DeepLX"},
        {value: services.xiaoniu, label: "小牛翻译"},
        {value: services.youdao, label: "有道翻译"},
        {value: services.tencent, label: "腾讯云翻译"},
        {value: services.chromeTranslator, label: "Chrome内置AI翻译"},
        // 大模型翻译
        {value: "ai", label: "AI翻译", disabled: true},
        {value: services.siliconCloud, label: "硅基流动"},
        {value: services.huanYuan, label: "腾讯混元"},
        {value: services.newapi, label: "New API"},
        {value: services.deepseek, label: "DeepSeek"},
        {value: services.openai, label: "OpenAI"},
        {value: services.azureOpenai, label: "Azure OpenAI"},
        {value: services.huanYuanTranslation, label: "腾讯混元翻译"},
        {value: services.tongyi, label: "阿里通义"},
        {value: services.doubao, label: "字节豆包"},
        {value: services.grok, label: "Grok (X.AI)"},
        {value: services.openrouter, label: "OpenRouter"},
        {value: services.groq, label: "Groq"},
        {value: services.moonshot, label: "Kimi"},
        {value: services.zhipu, label: "智谱"},
        {value: services.baichuan, label: "百川智能"},
        {value: services.lingyi, label: "零一万物"},
        {value: services.minimax, label: "MiniMax"},
        {value: services.mimo, label: "小米 MiMo"},
        {value: services.jieyue, label: "阶跃星辰"},
        {value: services.infini, label: "无向芯穹"},
        {value: services.cozecom, label: "Coze国际"},
        {value: services.cozecn, label: "Coze国内"},
        {value: services.claude, label: "Claude"},
        {value: services.gemini, label: "Gemini"},
        {value: services.yiyan, label: "文心一言"},
        {value: services.custom, label: "自定义接口"},
    ],
    display: [
        {value: 0, label: "仅译文"},
        {value: 1, label: "双语对照"},
    ],
    animationModes: animationModeOptions,
    // 双语翻译样式
    styles: [
        // 基础样式
        {value: "basic", label: "基础", disabled: true},
        {value: 0, label: "无样式", class: "babelbox-display-default", group: "basic"},
        {value: 1, label: "加粗", class: "babelbox-display-bold", group: "basic"},
        {value: 2, label: "斜体", class: "babelbox-display-italic", group: "basic"},
        {value: 3, label: "阴影", class: "babelbox-display-text-shadow", group: "basic"},

        // 下划线系列
        {value: "underline", label: "下划线", disabled: true},
        {value: 4, label: "蓝色实线", class: "babelbox-display-solid-underline", group: "underline"},
        {value: 5, label: "虚线", class: "babelbox-display-dot-underline", group: "underline"},
        {value: 6, label: "波浪线", class: "babelbox-display-wavy", group: "underline"},

        // 卡片系列
        {value: "card", label: "卡片", disabled: true},
        {value: 7, label: "普通卡片", class: "babelbox-display-card-mode", group: "card"},
        {value: 8, label: "渐变卡片", class: "babelbox-display-modern-card", group: "card"},
        {value: 9, label: "纸张", class: "babelbox-display-paper", group: "card"},

        // 高亮系列
        {value: "highlight", label: "高亮", disabled: true},
        {value: 10, label: "学习标记", class: "babelbox-display-learning-mode", group: "highlight"},
        {value: 11, label: "荧光笔", class: "babelbox-display-marker", group: "highlight"},
        {value: 12, label: "渐变高亮", class: "babelbox-display-highlight-fade", group: "highlight"},

        // 背景色系列
        {value: "background", label: "背景色", disabled: true},
        {value: 13, label: "黄色背景", class: "babelbox-display-lightyellow", group: "background"},
        {value: 14, label: "蓝色背景", class: "babelbox-display-lightblue", group: "background"},
        {value: 15, label: "灰色背景", class: "babelbox-display-lightgray", group: "background"},

        // 特殊效果
        {value: "special", label: "其他", disabled: true},
        {value: 16, label: "引用", class: "babelbox-display-quote", group: "special"},
        {value: 17, label: "边框", class: "babelbox-display-border", group: "special"},
        {value: 18, label: "聚焦", class: "babelbox-display-focus", group: "special"},
        {value: 19, label: "底线", class: "babelbox-display-clean", group: "special"},

        // 专业样式
        {value: "pro", label: "排版", disabled: true},
        {value: 20, label: "代码", class: "babelbox-display-tech", group: "pro"},
        {value: 21, label: "书籍", class: "babelbox-display-elegant", group: "pro"},

        // 透明度
        {value: "transparent", label: "透明", disabled: true},
        {value: 22, label: "淡化", class: "babelbox-display-dimmed", group: "transparent"},
        {value: 23, label: "半透明", class: "babelbox-display-transparent-mode", group: "transparent"},
    ],
    // 悬浮球快捷键选项
    floatingBallHotkeys: [
        {value: "none", label: "禁用快捷键"},
        {value: "Alt+T", label: "Alt+T / Option+T (默认)"},
        {value: "Alt+A", label: "Alt+A / Option+A"},
        {value: "Alt+S", label: "Alt+S / Option+S"},
        {value: "Alt+D", label: "Alt+D / Option+D"},
        {value: "Alt+Q", label: "Alt+Q / Option+Q"},
        {value: "Ctrl+Shift+T", label: "Ctrl+Shift+T / Control+Shift+T"},
        {value: "Ctrl+Shift+A", label: "Ctrl+Shift+A / Control+Shift+A"},
        {value: "F9", label: "F9"},
        {value: "F10", label: "F10"},
        {value: "F11", label: "F11"},
        {value: "F12", label: "F12"},
        {value: "custom", label: "自定义快捷键（测试版）"},
    ],
    theme: [
        {value: "auto", label: "跟随系统"},
        {value: "light", label: "浅色"},
        {value: "dark", label: "深色"},
    ],
    // 输入框翻译目标语言选项
    inputBoxTranslationTarget: [
        {value: "zh-Hans", label: "中文"},
        {value: "en", label: "英语"},
        {value: "ja", label: "日语"},
        {value: "ko", label: "韩语"},
        {value: "fr", label: "法语"},
        {value: "ru", label: "俄语"},
        {value: "es", label: "西班牙语"},
        {value: "de", label: "德语"},
        {value: "pt", label: "葡萄牙语"},
        {value: "it", label: "意大利语"},
    ],
    // 输入框翻译触发方式选项
    inputBoxTranslationTrigger: [
        {value: "disabled", label: "关闭"},
        {value: "triple_space", label: "连按三下空格"},
        {value: "triple_equal", label: "连按三下等号(=)"},
        {value: "triple_dash", label: "连按三下短横线(-)"},
    ],
};

export const defaultOption = {
    from: "auto",
    to: "zh-Hans",
    style: 1,
    display: 0,
    hotkey: "Control",
    service: services.microsoft,
    system_role: "You are a professional machine translation engine. Translate only the requested source text into the target language, preserving its meaning, tone, and formatting. Return only the translation.",
    user_role: `Translate the text inside <source_text> into {{to}}. If it does not need translation (for example, a proper noun or code), return it unchanged. Output only the translated text, without the surrounding tags.

<source_text>
{{origin}}
</source_text>`,
    count: 0,
    useCache: true,
    floatingBallHotkey: "Alt+T", // 默认悬浮球快捷键
    inputBoxTranslationTrigger: "disabled", // 默认关闭输入框翻译
    inputBoxTranslationTarget: "en", // 默认翻译成英文
};
