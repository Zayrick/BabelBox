import {createApp} from 'vue';
import DocumentApp from './DocumentApp.vue';
import './document-page.css';

/** 文档翻译 WXT 页面唯一挂载入口。 */
export function mountDocumentTranslationApp(selector: string): void {
    createApp(DocumentApp).mount(selector);
}
