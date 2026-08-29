// 全文翻译节点中的加载与失败反馈。
import {sendErrorMessage} from '@/src/features/page-notice/public';
import {getTranslationServiceLabel} from '@/src/core/config/translationServices';
import {config} from '@/src/services/config/store';
import {getTranslationErrorMessage} from '@/src/features/full-page-translation/core/errorMessage';
import {CircleAlert, RotateCcw, type IconNode} from 'lucide';
import {createLucideIconElement} from '@/src/ui/icons/lucideDom';
import {usesAnimatedEffects} from '@/src/core/config/animation';
import {
  applyTranslationShimmer,
  clearTranslationLoadingAnimation,
} from './loadingAnimation';

// 插入失败提示并处理错误
export function insertFailedTip(
  node: HTMLElement,
  errMsg: string,
  onRetry: () => void,
): HTMLElement {
  // 创建包装元素
  const wrapper = document.createElement("span");
  wrapper.classList.add("babelbox-retry-wrapper");
  wrapper.setAttribute("data-babelbox-translation-owned", "true");

  // 创建重试按钮
  const retryBtn = document.createElement("span");
  retryBtn.textContent = '重试';
  retryBtn.classList.add("babelbox-retry");
  retryBtn.addEventListener("click", handleRetryClick(node, wrapper, onRetry));

  // 添加失败标记
  node.classList.add("babelbox-failure");

  // 创建错误信息提示按钮
  const errorTip = document.createElement("span");
  errorTip.textContent = '错误原因';
  errorTip.classList.add("babelbox-reason");
  errorTip.addEventListener("click", handleErrorClick(errMsg));

  // 创建图标元素
  const retryElement = createIconElement(RotateCcw);
  const warnElement = createIconElement(CircleAlert);

  // 将所有元素批量添加到 wrapper
  wrapper.append(retryElement, retryBtn, warnElement, errorTip);
  node.appendChild(wrapper);
  return wrapper;
}

// 处理重试按钮点击事件
function handleRetryClick(node: HTMLElement, wrapper: HTMLElement, onRetry: () => void) {
  return (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    wrapper.remove(); // 移除错误提示元素，重新翻译
    node.classList.remove("babelbox-failure"); // 移除失败标记

    onRetry();
  };
}

// 处理错误提示按钮点击事件
function handleErrorClick(errMsg: string) {
  return (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const message = resolveErrorMessage(errMsg);
    sendErrorMessage(message); // 发送错误提示
  };
}

// 根据错误信息返回错误提示
function resolveErrorMessage(errMsg: string): string {
  return getTranslationErrorMessage(errMsg, getTranslationServiceLabel(config, config.service));
}

// 创建图标元素
function createIconElement(icon: IconNode): HTMLElement {
  const iconElement = document.createElement('span');
  iconElement.className = 'babelbox-feedback-icon';
  const svg = createLucideIconElement(icon, {color: '#428ADF'});
  svg.style.width = '1em';
  svg.style.height = '1em';
  svg.style.marginLeft = '1em';
  svg.style.pointerEvents = 'none';
  iconElement.appendChild(svg);
  return iconElement;
}

// 插入加载动画
export function insertLoadingSpinner(
  node: HTMLElement,
  isCache: boolean = false,
  sourceText: string = node.textContent ?? '',
): HTMLElement {
  const spinner = document.createElement("span");
  spinner.className = "babelbox-loading";
  spinner.setAttribute("data-babelbox-translation-owned", "true");
  const animationMode = config.animationMode === 'shimmer' && sourceText.trim() === ''
    ? 'default'
    : config.animationMode;
  spinner.dataset.animationMode = animationMode;
  if (animationMode === 'shimmer') applyTranslationShimmer(node);
  if (isCache) spinner.style.borderTop = "3px solid green"; // 存在缓存时改为绿色
  
  void Promise.resolve().then(() => {
    if (!usesAnimatedEffects(animationMode)) spinner.classList.add('static');
  });
  
  node.appendChild(spinner);
  return spinner;
}

export function removeLoadingSpinner(
  node: HTMLElement,
  spinner: HTMLElement | undefined,
): void {
  clearTranslationLoadingAnimation(node);
  spinner?.remove();
}
