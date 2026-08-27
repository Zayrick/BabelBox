// Background entrypoint 只依赖 app composition root；这里集中组装翻译 provider 能力。
export {
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
export {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';
