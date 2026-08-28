import {getSiteBaseDomain} from '@/src/core/site-rules/domain';

export interface PopupCurrentSite {
  domain: string;
  label: string;
  supported: boolean;
}

export function resolvePopupCurrentSite(input: unknown): PopupCurrentSite {
  if (typeof input !== 'string' || !input.trim()) {
    return {domain: '', label: '无法读取当前页面', supported: false};
  }

  const value = input.trim();
  const domain = getSiteBaseDomain(value) || '';
  if (domain) return {domain, label: domain, supported: true};

  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      return {domain: '', label: '本地文件', supported: false};
    }
    if (url.protocol === 'about:') {
      return {domain: '', label: `about:${url.pathname}`, supported: false};
    }
    if (['chrome:', 'edge:', 'brave:', 'vivaldi:'].includes(url.protocol)) {
      return {domain: '', label: `${url.protocol}//${url.hostname}`, supported: false};
    }
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
      return {domain: '', label: '扩展页面', supported: false};
    }
    return {domain: '', label: `${url.protocol.slice(0, -1)} 页面`, supported: false};
  } catch {
    return {domain: '', label: '无法识别当前页面', supported: false};
  }
}
