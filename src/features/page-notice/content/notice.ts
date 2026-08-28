import {browser} from 'wxt/browser';
import {throttle} from '@/src/shared/function/throttle';
import {X} from 'lucide';
import {createLucideIconElement} from '@/src/ui/icons/lucideDom';
import noticeStyles from './notice.css?inline';

type NoticeType = 'error' | 'success';

interface MissingCredentialNotice {
    service: string;
    credentialLabel: string;
}

const PAGE_NOTICE_HOST_ID = 'fluent-read-page-notice-host';
const NOTICE_EXIT_DURATION = 180;
let noticeHost: HTMLElement | null = null;
let noticeStack: HTMLElement | null = null;

function getMissingCredentialNotice(message: string): MissingCredentialNotice | null {
    const match = message.match(/^(.+?)\s+需要\s+(.+?)，当前尚未(?:完整)?配置(?:[；。]|$)/u);
    if (!match) return null;
    const [, service, credentialLabel] = match;
    return /(?:API Key|访问令牌|App Key|App Secret|SecretId|SecretKey)/iu.test(credentialLabel)
        ? {service, credentialLabel}
        : null;
}

function getNoticeTitle(type: NoticeType, credential: boolean): string {
    if (credential) return '配置提醒';
    return type === 'success' ? '操作完成' : '翻译提醒';
}

function getNoticeDetail(message: string, missingCredential: MissingCredentialNotice | null): string {
    if (!missingCredential) return message;
    return `还差一步：为 ${missingCredential.service} 填写 ${missingCredential.credentialLabel}，就可以开始翻译了。`;
}

function applyHostStyles(host: HTMLElement): void {
    // 宿主页样式不能把通知重新放回文档流，也不能用 transform/overflow
    // 截断它。关键布局使用 inline !important，具体外观留在 Shadow Root。
    const importantStyles: Record<string, string> = {
        display: 'block',
        position: 'fixed',
        top: '0',
        left: '0',
        width: '0',
        height: '0',
        margin: '0',
        padding: '0',
        border: '0',
        overflow: 'visible',
        opacity: '1',
        visibility: 'visible',
        transform: 'none',
        'pointer-events': 'none',
        'z-index': '2147483647',
    };
    Object.entries(importantStyles).forEach(([property, value]) => {
        host.style.setProperty(property, value, 'important');
    });
}

function getNoticeStack(): HTMLElement {
    if (noticeHost?.isConnected && noticeHost.ownerDocument === document && noticeStack) {
        return noticeStack;
    }

    const host = document.createElement('fluent-read-page-notice');
    host.id = PAGE_NOTICE_HOST_ID;
    host.setAttribute('data-fr-page-notice-host', 'true');
    host.setAttribute('data-fluent-read-ui', '');
    host.setAttribute('translate', 'no');
    host.setAttribute('aria-live', 'assertive');
    applyHostStyles(host);

    const shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = noticeStyles;
    const stack = document.createElement('div');
    stack.className = 'notice-stack';
    shadow.append(style, stack);

    document.documentElement.appendChild(host);
    noticeHost = host;
    noticeStack = stack;
    return stack;
}

function appendTextElement(
    parent: HTMLElement,
    tag: 'span' | 'strong',
    className: string,
    text: string,
): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

function removeNotice(notice: HTMLElement): void {
    if (!notice.isConnected || notice.classList.contains('is-leaving')) return;
    notice.classList.remove('is-visible');
    notice.classList.add('is-leaving');

    window.setTimeout(() => {
        const stack = notice.parentElement;
        notice.remove();
        if (stack?.childElementCount === 0 && stack === noticeStack && noticeHost?.ownerDocument === document) {
            noticeHost.remove();
            noticeHost = null;
            noticeStack = null;
        }
    }, NOTICE_EXIT_DURATION);
}

/** 在隔离的 Shadow Root 中显示页面通知。 */
export function showPageNotice(message: string, type: NoticeType): HTMLElement {
    const missingCredential = getMissingCredentialNotice(message);
    const credential = missingCredential !== null;
    const tone = credential ? 'warning' : type;
    const stack = getNoticeStack();
    const notice = document.createElement('section');
    notice.className = `page-notice page-notice-${tone}`;
    notice.setAttribute('role', 'alert');
    notice.setAttribute('aria-atomic', 'true');

    const mark = document.createElement('img');
    mark.className = 'notice-mark';
    mark.src = browser.runtime.getURL('/icon/48.png');
    mark.alt = '流畅阅读';

    const copy = document.createElement('span');
    copy.className = 'notice-copy';
    const heading = document.createElement('span');
    heading.className = 'notice-heading';
    appendTextElement(heading, 'strong', 'notice-brand', '流畅阅读');
    appendTextElement(heading, 'span', 'notice-divider', '·');
    appendTextElement(heading, 'span', 'notice-title', getNoticeTitle(type, credential));

    const body = document.createElement('span');
    body.className = 'notice-body';
    appendTextElement(body, 'span', 'notice-detail', getNoticeDetail(message, missingCredential));
    if (credential) {
        const action = document.createElement('button');
        action.className = 'notice-action';
        action.type = 'button';
        action.textContent = '去设置';
        action.addEventListener('click', () => {
            void browser.runtime.sendMessage({type: 'openOptionsPage'}).catch((error: unknown) => {
                console.error('[FluentRead] 打开设置页失败', error);
            });
        });
        body.appendChild(action);
    }
    copy.append(heading, body);

    const close = document.createElement('button');
    close.className = 'notice-close';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭通知');
    close.appendChild(createLucideIconElement(X));

    notice.append(mark, copy, close);
    stack.appendChild(notice);

    const duration = credential ? 6500 : 3500;
    const dismissTimer = window.setTimeout(() => removeNotice(notice), duration);
    close.addEventListener('click', () => {
        window.clearTimeout(dismissTimer);
        removeNotice(notice);
    });

    const reveal = () => {
        if (notice.isConnected) notice.classList.add('is-visible');
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(reveal);
    else void Promise.resolve().then(reveal);

    return notice;
}

function _sendErrorMessage(message: string): void {
    showPageNotice(message, 'error');
}

// 1s 内只显示一次，避免全文翻译中多个失败节点同时堆叠通知。
export const sendErrorMessage = throttle(_sendErrorMessage, 1000);
