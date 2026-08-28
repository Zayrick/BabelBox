import {describe, expect, it} from 'vitest';

import {resolvePopupCurrentSite} from '@/src/app/popup/currentSite';

describe('popup current site presentation', () => {
  it('为普通网页显示主域名并开放网站规则', () => {
    expect(resolvePopupCurrentSite('https://docs.example.com/guide')).toEqual({
      domain: 'example.com',
      label: 'example.com',
      supported: true,
    });
  });

  it('为浏览器内置页保留可识别的当前页面信息并关闭网站规则', () => {
    expect(resolvePopupCurrentSite('chrome://settings/privacy')).toEqual({
      domain: '',
      label: 'chrome://settings',
      supported: false,
    });
    expect(resolvePopupCurrentSite('about:blank')).toEqual({
      domain: '',
      label: 'about:blank',
      supported: false,
    });
  });

  it('为本地文件和缺失地址提供稳定的不可用文案', () => {
    expect(resolvePopupCurrentSite('file:///tmp/article.html')).toEqual({
      domain: '',
      label: '本地文件',
      supported: false,
    });
    expect(resolvePopupCurrentSite(undefined)).toEqual({
      domain: '',
      label: '无法读取当前页面',
      supported: false,
    });
  });
});
