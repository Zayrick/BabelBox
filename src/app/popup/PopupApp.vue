<!-- Popup 页面归 app 层所有；WXT 入口只负责调用挂载函数。 -->
<template>
  <div
    class="popup-shell"
    :class="{ 'config-loading': !hydrated }"
    :aria-busy="!hydrated"
    :data-config-ready="hydrated ? 'true' : 'false'"
    :data-view="activeView"
    :inert="!hydrated"
  >
    <header class="popup-header">
      <template v-if="activeView === 'home'">
        <div class="brand">
          <img src="/icon/128.png" alt="" />
          <div class="brand-copy">
            <strong>翻译机</strong>
            <small>BabelBox</small>
          </div>
        </div>
        <div class="header-actions">
          <el-tooltip :content="cacheActionLabel" placement="bottom">
            <button
              class="header-icon-button cache-clear-button"
              :class="actionFeedbacks.cache?.tone"
              type="button"
              :disabled="clearingCache"
              :aria-busy="clearingCache"
              :aria-label="cacheActionLabel"
              @click="clearCache"
            >
              <BrushCleaning aria-hidden="true" />
            </button>
          </el-tooltip>
          <el-tooltip content="GitHub 开源项目" placement="bottom">
            <a
              class="header-icon-button"
              href="https://github.com/Zayrick/BabelBox"
              target="_blank"
              rel="noreferrer"
              aria-label="在 GitHub 查看翻译机开源项目"
            >
              <svg class="github-mark" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" />
              </svg>
            </a>
          </el-tooltip>
          <el-tooltip content="设置" placement="bottom">
            <button class="header-icon-button" type="button" aria-label="打开设置" @click="openOptions()">
              <Settings aria-hidden="true" />
            </button>
          </el-tooltip>
        </div>
      </template>
      <template v-else>
        <button class="header-icon-button back-button" type="button" aria-label="返回" @click="closeView">
          <ArrowLeft aria-hidden="true" />
        </button>
        <h1 class="view-title">{{ viewTitle }}</h1>
        <span class="header-spacer" aria-hidden="true" />
      </template>
    </header>

    <main ref="popupBody" class="popup-body" tabindex="-1">
      <template v-if="activeView === 'home'">
        <section class="popup-section translate-section" aria-label="网页翻译">
          <div class="language-pair">
            <el-select v-model="config.from" aria-label="网页翻译源语言">
              <el-option v-for="item in options.form" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <span class="arrow" aria-hidden="true"><ArrowRight /></span>
            <el-select v-model="config.to" aria-label="网页翻译目标语言">
              <el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>

          <div ref="servicePicker" class="service-picker">
            <button
              class="service-field"
              type="button"
              aria-haspopup="listbox"
              :aria-expanded="servicePickerOpen"
              :aria-label="servicePickerAriaLabel"
              :data-selected-model="serviceModelLabel || undefined"
              @click="toggleServicePicker"
            >
              <ServiceIcon :service="selectedServiceProvider" :label="serviceLabel" size="small" />
              <span class="service-copy">
                <strong>{{ serviceLabel }}</strong>
                <em v-if="serviceModelLabel" class="service-model" :title="serviceModelLabel">{{ serviceModelLabel }}</em>
              </span>
              <span class="chevron" :class="{ open: servicePickerOpen }" aria-hidden="true"><ChevronDown /></span>
            </button>

            <div v-if="servicePickerOpen" class="service-picker-panel" role="listbox" aria-label="翻译服务列表">
              <button
                v-for="item in serviceOptions"
                :key="item.value"
                class="service-option"
                type="button"
                role="option"
                :data-service-value="item.value"
                :aria-selected="config.service === item.value"
                @click="selectService(item.value)"
              >
                <ServiceIcon :service="item.provider" :label="item.label" size="small" />
                <span>{{ item.label }}</span>
                <Check v-if="config.service === item.value" class="service-option-check" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div v-if="credentialWarning" class="credential-warning" role="alert">
            <TriangleAlert class="credential-warning-icon" aria-hidden="true" />
            <span><strong>配置提醒</strong>{{ credentialWarning }}</span>
            <button type="button" @click="openOptions('settings-services')">去设置</button>
          </div>

          <div class="translate-action">
            <button
              class="translate-button"
              :class="{ translated: pageTranslated, 'has-feedback': actionFeedbacks.page, 'feedback-error': actionFeedbacks.page?.tone === 'error' }"
              type="button"
              :disabled="translationActionPending || Boolean(selectedServiceUnavailableMessage)"
              :aria-pressed="pageTranslated"
              :aria-busy="activeTranslationAction === 'page'"
              @click="togglePageTranslation"
            >
              <Transition name="translate-content" mode="out-in">
                <span
                  :key="pageActionPresentation.key"
                  class="translate-button-content"
                  aria-live="polite"
                >
                  <span v-if="pageActionPresentation.state === 'pending'" class="spinner" aria-hidden="true" />
                  <X v-else-if="pageActionPresentation.state === 'error'" class="translate-glyph" aria-hidden="true" />
                  <Check v-else-if="pageActionPresentation.state === 'success'" class="translate-glyph" aria-hidden="true" />
                  <Languages v-else class="translate-glyph" aria-hidden="true" />
                  <span class="translate-label">{{ pageActionPresentation.label }}</span>
                  <kbd
                    v-if="pageActionPresentation.showHotkey"
                    class="translate-hotkey"
                    :class="{ disabled: fullPageHotkey === '未设置' }"
                    aria-hidden="true"
                  >{{ fullPageHotkey }}</kbd>
                </span>
              </Transition>
            </button>
            <el-tooltip v-if="canUseAIContext" content="AI 翻译时参考网页上下文" placement="top">
              <button
                class="ai-context-toggle"
                type="button"
                :aria-pressed="config.enableAIContext"
                :aria-label="config.enableAIContext ? '关闭上下文' : '开启上下文'"
                :disabled="translationActionPending"
                @click="toggleAIContext"
              >
                <Sparkles aria-hidden="true" />
                <span class="ai-context-copy">上下文</span>
              </button>
            </el-tooltip>
          </div>

          <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>
        </section>

        <section v-if="currentSiteSupported" class="popup-section site-section" aria-labelledby="popup-site-title">
          <h2 id="popup-site-title" class="section-title site-title">
            <span>当前网站</span>
            <strong :title="currentSiteLabel">{{ currentSiteLabel }}</strong>
          </h2>
          <div class="site-rule-list">
            <button
              class="site-rule-button"
              :class="{
                enabled: currentSiteAlwaysTranslated,
                'global-enabled': config.autoTranslate,
                'feedback-success': actionFeedbacks['site-rule']?.tone === 'success',
                'feedback-error': actionFeedbacks['site-rule']?.tone === 'error',
              }"
              data-setting="always-translate-site"
              :data-site-domain="currentSiteDomain"
              :data-enabled="currentSiteAlwaysTranslated"
              type="button"
              role="switch"
              :aria-checked="currentSiteAlwaysTranslated"
              :aria-label="currentSiteSwitchLabel"
              :disabled="translationActionPending || config.autoTranslate || currentSiteExtensionDisabled"
              @click="setCurrentSiteAlwaysTranslated(!currentSiteAlwaysTranslated)"
            >
              <Transition name="action-copy" mode="out-in">
                <span :key="siteRuleActionLabel" class="site-rule-label" aria-live="polite">{{ siteRuleActionLabel }}</span>
              </Transition>
              <i class="site-rule-switch" aria-hidden="true" />
            </button>
            <button
              class="site-rule-button site-disable-rule-button"
              :class="{
                enabled: currentSiteExtensionDisabled,
                'feedback-success': actionFeedbacks['site-disable']?.tone === 'success',
                'feedback-error': actionFeedbacks['site-disable']?.tone === 'error',
              }"
              data-setting="disable-extension-site"
              :data-site-domain="currentSiteDomain"
              :data-enabled="currentSiteExtensionDisabled"
              type="button"
              role="switch"
              :aria-checked="currentSiteExtensionDisabled"
              :aria-label="currentSiteExtensionSwitchLabel"
              :disabled="translationActionPending"
              @click="setCurrentSiteExtensionDisabled(!currentSiteExtensionDisabled)"
            >
              <Transition name="action-copy" mode="out-in">
                <span :key="siteDisableActionLabel" class="site-rule-label" aria-live="polite">{{ siteDisableActionLabel }}</span>
              </Transition>
              <i class="site-rule-switch" aria-hidden="true" />
            </button>
            <button
              class="site-filter-rule-button"
              type="button"
              :aria-label="`配置 ${currentSiteDomain} 的内容过滤规则`"
              @click="openView('filter')"
            >
              <span class="site-rule-label">内容过滤规则</span>
              <span class="site-filter-count">{{ currentSiteFilterRuleCount ? `${currentSiteFilterRuleCount} 条` : '未设置' }}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <section class="popup-section features" aria-labelledby="popup-features-title">
          <h2 id="popup-features-title" class="section-title">快捷功能</h2>
          <div class="feature-list">
            <button class="feature-card" type="button" @click="openView('hover')">
              <span class="row-icon" aria-hidden="true"><MousePointer /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>悬停翻译</strong></span>
                <small :title="hoverSummary">{{ hoverSummary }}</small>
              </span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
            <button class="feature-card" type="button" @click="openView('selection')">
              <span class="row-icon" aria-hidden="true"><TextSelect /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>划词翻译</strong></span>
                <small :title="selectionSummary">{{ selectionSummary }}</small>
              </span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
            <button class="feature-card" type="button" @click="openView('appearance')">
              <span class="row-icon" aria-hidden="true"><Type /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>译文显示</strong></span>
                <small :title="displaySummary">{{ displaySummary }}</small>
              </span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
            <button class="feature-card" type="button" @click="openView('image')">
              <span class="row-icon" aria-hidden="true"><ImageIcon /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>图片翻译</strong><em class="beta-badge">Beta<span class="visually-hidden"> 测试</span></em></span>
                <small :title="imageTranslationSummary">{{ imageTranslationSummary }}</small>
              </span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
            <button
              class="feature-card video-feature-card"
              :class="{ 'needs-enable': !config.videoTranslationEnabled }"
              data-feature="video-subtitle"
              type="button"
              :aria-label="config.videoTranslationEnabled ? '打开视频字幕设置，当前已开启' : '打开视频字幕设置，点击开启字幕翻译'"
              @click="openView('video')"
            >
              <span class="row-icon" aria-hidden="true"><Captions /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>视频字幕</strong><em class="beta-badge">Beta<span class="visually-hidden"> 测试</span></em></span>
                <small :title="videoSummary">{{ videoSummary }}</small>
              </span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
            <button
              class="feature-card document-feature-card"
              data-feature="document-translation"
              type="button"
              aria-label="打开文档翻译，Beta 测试"
              @click="openDocumentTranslation()"
            >
              <span class="row-icon" aria-hidden="true"><FileText /></span>
              <span class="feature-copy">
                <span class="feature-title"><strong>文档翻译</strong><em class="beta-badge">Beta<span class="visually-hidden"> 测试</span></em></span>
                <small title="HTML / TXT / Markdown / 字幕 / JSON">HTML · MD · 字幕 · JSON</small>
              </span>
              <ExternalLink class="row-trailing-icon" aria-hidden="true" />
            </button>
          </div>
        </section>
      </template>

      <template v-else>
        <div v-if="activeView === 'hover'" class="view-content">
          <div class="setting-list">
            <div class="setting-row">
              <span><strong>悬停翻译</strong><small>按住快捷键，将鼠标移到文字上</small></span>
              <el-switch class="popup-switch" :model-value="config.hotkey !== 'none'" aria-label="启用或关闭鼠标悬停翻译" @change="toggleHover" />
            </div>
          </div>
          <div class="choice-block">
            <span class="choice-label">快捷键</span>
            <div class="chips two">
              <button v-for="item in hoverChoices" :key="item.value" type="button" :class="{ selected: config.hotkey === item.value }" @click="setHoverHotkey(item.value)">{{ item.label }}</button>
            </div>
            <button v-if="config.hotkey === 'custom'" class="secondary-action" type="button" @click="showCustomMouseHotkeyDialog = true">
              {{ config.customHotkey ? `当前：${config.customHotkey}` : '录制自定义快捷键' }}
            </button>
          </div>
        </div>

        <div v-else-if="activeView === 'selection'" class="view-content">
          <div class="segmented" role="tablist" aria-label="翻译方式">
            <button :class="{ selected: selectionTab === 'text' }" type="button" role="tab" :aria-selected="selectionTab === 'text'" aria-controls="selection-text-panel" @click="selectionTab = 'text'">划词翻译</button>
            <button :class="{ selected: selectionTab === 'area' }" type="button" role="tab" :aria-selected="selectionTab === 'area'" aria-controls="selection-area-panel" @click="selectionTab = 'area'">圈选翻译</button>
          </div>

          <div v-if="selectionTab === 'text'" id="selection-text-panel" class="view-stack" role="tabpanel">
            <div class="setting-list">
              <div class="setting-row">
                <span><strong>划词翻译</strong><small>选中文字后显示翻译</small></span>
                <el-switch
                  class="popup-switch"
                  :model-value="config.selectionTranslatorMode !== 'disabled'"
                  aria-label="启用或关闭划词翻译"
                  @change="setSelectionMode(Boolean($event) ? 'bilingual' : 'disabled')"
                />
              </div>
              <div class="setting-row">
                <span><strong>显示延迟</strong><small>0 表示立即显示</small></span>
                <div class="delay-control">
                  <el-input-number
                    v-model="config.selectionTranslatorDelay"
                    aria-label="划词翻译显示延迟"
                    :min="SELECTION_TRANSLATOR_DELAY_MIN"
                    :max="SELECTION_TRANSLATOR_DELAY_MAX"
                    :step="SELECTION_TRANSLATOR_DELAY_STEP"
                    controls-position="right"
                    @change="handleSelectionTranslatorDelayChange"
                  />
                  <span>ms</span>
                </div>
              </div>
            </div>
            <div class="choice-block">
              <span class="choice-label">显示方式</span>
              <div class="chips two">
                <button v-for="item in selectionModes" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorMode === item.value }" @click="setSelectionMode(item.value)">{{ item.label }}</button>
              </div>
            </div>
            <div class="choice-block">
              <span class="choice-label">触发方式</span>
              <div class="chips three">
                <button v-for="item in selectionTriggers" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorTrigger === item.value }" @click="setSelectionTrigger(item.value)">{{ item.label }}</button>
              </div>
              <button v-if="config.selectionTranslatorTrigger === 'custom'" class="secondary-action" type="button" @click="showCustomSelectionHotkeyDialog = true">
                {{ config.customSelectionTranslatorHotkey ? `当前：${config.customSelectionTranslatorHotkey}` : '录制自定义快捷键' }}
              </button>
            </div>
            <div class="choice-block">
              <span class="choice-label">朗读音色</span>
              <el-select
                v-model="config.selectionTtsVoices"
                class="full-width-select"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                aria-label="划词翻译朗读音色"
                placeholder="自动"
                no-data-text="没有可用音色"
              >
                <el-option
                  v-for="item in selectionTtsVoiceOptions"
                  :key="item.value"
                  :label="`${item.label} · ${item.locale}`"
                  :value="item.value"
                />
              </el-select>
              <small class="choice-hint">按顺序尝试，留空则自动选择</small>
            </div>
            <button class="link-row" type="button" @click="openOptions('settings-vocabulary')">
              <span class="row-icon" aria-hidden="true"><Star /></span>
              <span class="link-row-copy"><strong>单词本 <em class="beta-badge">Beta</em></strong><small>{{ config.vocabularyBookEnabled ? '查看收藏和复习进度' : '收藏单词并定期复习' }}</small></span>
              <ChevronRight class="row-trailing-icon" aria-hidden="true" />
            </button>
          </div>

          <div v-else id="selection-area-panel" class="view-stack" role="tabpanel">
            <div v-if="!browserCapabilities.areaTranslation" class="capability-unavailable" role="status">
              <strong>当前浏览器暂不支持圈选翻译</strong>
              <small>设置已保留，在 Chrome 中可正常使用</small>
            </div>
            <template v-else>
              <div class="setting-list">
                <div class="setting-row">
                  <span><strong>圈选翻译</strong><small>翻译图片或无法选中的文字</small></span>
                  <el-switch class="popup-switch" :model-value="config.selectionAreaEnabled" aria-label="启用或关闭圈选翻译" @change="setAreaEnabled(Boolean($event))" />
                </div>
              </div>
              <p class="view-tip"><kbd>Shift</kbd> + <kbd>Z</kbd> 拖拽选择区域，<kbd>Esc</kbd> 关闭结果</p>
            </template>
          </div>
        </div>

        <div v-else-if="activeView === 'image'" class="view-content">
          <div v-if="!browserCapabilities.imageTranslation" class="capability-unavailable" role="status">
            <strong>当前浏览器暂不支持图片翻译与 OCR</strong>
            <small>设置已保留，在 Chrome 中可正常使用</small>
          </div>
          <div v-else class="setting-list">
            <div class="setting-row">
              <span><strong>图片翻译</strong><small>在图片左下角显示翻译按钮</small></span>
              <el-switch class="popup-switch" :model-value="!config.disableImageTranslator" aria-label="启用或关闭图片翻译" @change="setImageTranslatorEnabled(Boolean($event))" />
            </div>
          </div>
        </div>

        <div v-else-if="activeView === 'video'" class="view-content">
          <div class="setting-list">
            <div class="setting-row video-enable-row" :class="{ 'needs-enable': !config.videoTranslationEnabled }">
              <span><strong>字幕翻译</strong><small>目前支持 YouTube</small></span>
              <el-switch class="popup-switch" :model-value="config.videoTranslationEnabled" aria-label="启用或关闭视频字幕翻译" @change="setVideoTranslationEnabled(Boolean($event))" />
            </div>
          </div>
          <label class="choice-block">
            <span class="choice-label">视频翻译服务</span>
            <el-select v-model="config.videoService" class="full-width-select" aria-label="视频翻译服务" :disabled="!config.videoTranslationEnabled">
              <el-option v-if="selectedVideoServiceUnavailableMessage" :label="`${videoServiceLabel}（当前浏览器不可用）`" :value="config.videoService" disabled />
              <el-option v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <small class="choice-hint" :class="{ 'capability-warning': selectedVideoServiceUnavailableMessage }">{{ selectedVideoServiceUnavailableMessage || '仅用于视频字幕' }}</small>
          </label>
          <label class="choice-block">
            <span class="choice-label">字幕字号</span>
            <el-select v-model="config.videoSubtitleFontSize" class="full-width-select" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled">
              <el-option v-for="size in videoSubtitleFontSizeOptions" :key="size" :label="size === 100 ? '默认' : `${size}%`" :value="size" />
            </el-select>
          </label>
        </div>

        <div v-else-if="activeView === 'filter'" class="view-content site-filter-view">
          <div class="site-filter-intro">
            <span><strong>{{ currentSiteDomain }}</strong><small>优先于全局规则，对子域同样生效</small></span>
            <em>{{ currentSiteFilterRuleCount }} 条</em>
          </div>
          <TranslationFilterRulesEditor
            compact
            :model-value="currentSiteFilterRules"
            empty-description="未添加时沿用全局规则"
            @update:model-value="setCurrentSiteFilterRules"
          />
          <button
            v-if="hasCurrentSiteFilter"
            class="remove-site-filter-button"
            type="button"
            @click="removeCurrentSiteFilter"
          >删除此网站的全部规则</button>
        </div>

        <div v-else-if="activeView === 'appearance'" class="view-content">
          <div class="choice-block">
            <span class="choice-label">翻译模式</span>
            <div class="chips two">
              <button v-for="item in options.display" :key="item.value" type="button" :class="{ selected: config.display === item.value }" @click="config.display = item.value">{{ item.label }}</button>
            </div>
          </div>
          <label v-if="config.display === 1" class="choice-block">
            <span class="choice-label">译文样式</span>
            <el-select v-model="config.style" class="full-width-select" aria-label="译文样式">
              <el-option v-for="item in styleOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label class="choice-block">
            <span class="choice-label">界面主题</span>
            <el-select v-model="config.theme" class="full-width-select" aria-label="界面主题">
              <el-option v-for="item in options.theme" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
        </div>

        <button class="view-settings-link" type="button" @click="openOptions(viewSettingsSection[activeView])">
          <span>更多设置</span>
          <ExternalLink aria-hidden="true" />
        </button>
      </template>
    </main>

    <CustomHotkeyInput v-model="showCustomMouseHotkeyDialog" :current-value="config.customHotkey" @confirm="confirmMouseHotkey" @cancel="cancelMouseHotkey" />
    <CustomHotkeyInput v-model="showCustomSelectionHotkeyDialog" :current-value="config.customSelectionTranslatorHotkey" @confirm="confirmSelectionHotkey" @cancel="cancelSelectionHotkey" />
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {browser} from 'wxt/browser';
import {useDocumentTheme} from '@/src/ui/composables/useDocumentTheme';
import {
  config as runtimeConfig,
  configReady,
  saveConfig,
  requestConfigSave,
  subscribeConfig,
} from '@/src/services/config/store';
import {
  ArrowLeft,
  ArrowRight,
  BrushCleaning,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Languages,
  MousePointer,
  Settings,
  Sparkles,
  Star,
  TextSelect,
  TriangleAlert,
  Type,
  X,
} from '@lucide/vue';
import {
  Config,
  SELECTION_TRANSLATOR_DELAY_MAX,
  SELECTION_TRANSLATOR_DELAY_MIN,
  SELECTION_TRANSLATOR_DELAY_STEP,
  VIDEO_SUBTITLE_FONT_SIZE_OPTIONS,
  normalizeConfig,
  normalizeSelectionTranslatorDelay,
} from '@/src/core/config/model';
import { options, servicesType } from '@/src/core/config/catalog';
import {
  getTranslationServiceLabel,
  getTranslationServiceModel,
  getTranslationServiceProvider,
} from '@/src/core/config/translationServices';
import { getMissingCredentialMessage } from '@/src/core/config/validation';
import { SELECTION_TTS_VOICE_OPTIONS } from '@/src/core/config/selectionTts';
import { requestTranslationCacheClear } from './cache';
import { useActionFeedback } from './actionFeedback';
import {resolvePopupCurrentSite} from './currentSite';
import {isBrowserTabId} from '@/src/platform/browser/ids';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {
  getSelectableTranslationServices,
  getTranslationServiceUnavailableMessage,
} from '@/src/services/translation/capabilities';
import TranslationFilterRulesEditor from '@/src/features/settings/ui/TranslationFilterRulesEditor.vue';
import {
  getTranslationFilterSite,
  removeTranslationFilterSite,
  upsertTranslationFilterSite,
  type TranslationFilterRule,
} from '@/src/core/translation/filters';

// 首页之外的每个视图都在同一个滚动区内渲染，不再叠加抽屉或额外滚动容器。
type DetailView = 'hover' | 'selection' | 'appearance' | 'image' | 'video' | 'filter';
type PopupView = 'home' | DetailView;
type SettingsSection = 'settings-general' | 'settings-image-translation' | 'settings-shortcuts' | 'settings-services' | 'settings-sites' | 'settings-video' | 'settings-vocabulary';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));
const config = ref(new Config());
const activeView = ref<PopupView>('home');
const popupBody = ref<HTMLElement | null>(null);
const selectionTab = ref<'text' | 'area'>('text');
const activeTranslationAction = ref<'page' | 'site-rule' | null>(null);
const pagePendingVisible = ref(false);
const pageTranslated = ref(false);
const currentTabId = ref<number | null>(null);
const currentSiteDomain = ref('');
const currentSiteLabel = ref('无法读取当前页面');
const clearingCache = ref(false);
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
const showCustomMouseHotkeyDialog = ref(false);
const showCustomSelectionHotkeyDialog = ref(false);
const servicePicker = ref<HTMLElement | null>(null);
const servicePickerOpen = ref(false);
const hydrated = ref(false);
let lastSerialized = '';
let applyingExternalConfig = false;
let pageExitSaveStarted = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pagePendingTimer: ReturnType<typeof setTimeout> | undefined;
type PopupActionTarget = 'page' | 'site-rule' | 'site-disable' | 'cache';
const {
  feedbacks: actionFeedbacks,
  show: showActionFeedback,
  clear: clearActionFeedback,
  dispose: disposeActionFeedback,
} = useActionFeedback<PopupActionTarget>();
useDocumentTheme(() => config.value.theme);
const viewSettingsSection: Record<DetailView, SettingsSection> = {
  hover: 'settings-shortcuts',
  selection: 'settings-shortcuts',
  appearance: 'settings-general',
  image: 'settings-image-translation',
  video: 'settings-video',
  filter: 'settings-sites',
};
const persistConfig = (value: unknown) => requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));

const serviceOptions = computed(() => getSelectableTranslationServices(config.value));
const videoServiceOptions = computed(() => getSelectableTranslationServices(config.value));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const styleOptions = computed(() => options.styles.filter((item: any) => !item.disabled));
const selectedServiceProvider = computed(() => getTranslationServiceProvider(config.value, config.value.service));
const selectedVideoServiceProvider = computed(() => getTranslationServiceProvider(config.value, config.value.videoService));
const selectedServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(
  config.value.service,
  browserCapabilities,
  selectedServiceProvider.value,
));
const selectedVideoServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(
  config.value.videoService,
  browserCapabilities,
  selectedVideoServiceProvider.value,
));
const serviceLabel = computed(() => {
  const label = getTranslationServiceLabel(config.value, config.value.service);
  return selectedServiceUnavailableMessage.value ? `${label}（当前浏览器不可用）` : label;
});
const serviceModelLabel = computed(() => getTranslationServiceModel(config.value, config.value.service));
const canUseAIContext = computed(() => servicesType.isUseAIContext(
  selectedServiceProvider.value,
  serviceModelLabel.value,
));
const servicePickerAriaLabel = computed(() => serviceModelLabel.value
  ? `翻译服务：${serviceLabel.value}，当前模型：${serviceModelLabel.value}`
  : `翻译服务：${serviceLabel.value}`);
const credentialWarning = computed(() => selectedServiceUnavailableMessage.value || getMissingCredentialMessage(config.value.service, config.value));
const translationActionPending = computed(() => activeTranslationAction.value !== null);
const currentSiteSupported = computed(() => currentTabId.value !== null && Boolean(currentSiteDomain.value));
const currentSiteRuleEnabled = computed(() => currentSiteSupported.value
  && (config.value.alwaysTranslateDomains ?? []).includes(currentSiteDomain.value));
const currentSiteAlwaysTranslated = computed(() => currentSiteSupported.value
  && (config.value.autoTranslate || currentSiteRuleEnabled.value));
const currentSiteExtensionDisabled = computed(() => currentSiteSupported.value
  && (config.value.disabledExtensionDomains ?? []).includes(currentSiteDomain.value));
const currentSiteFilter = computed(() => currentSiteDomain.value
  ? getTranslationFilterSite(config.value.translationFilter, currentSiteDomain.value)
  : null);
const currentSiteFilterRules = computed(() => currentSiteFilter.value?.rules ?? []);
const currentSiteFilterRuleCount = computed(() => currentSiteFilterRules.value.length);
const hasCurrentSiteFilter = computed(() => currentSiteFilter.value !== null);
const currentSiteSwitchLabel = computed(() => currentSiteSupported.value
  ? currentSiteExtensionDisabled.value
    ? `${currentSiteDomain.value} 已禁用扩展，无法开启始终翻译`
    : config.value.autoTranslate
    ? `已开启自动翻译所有网站，${currentSiteDomain.value} 会自动翻译`
    : `始终翻译 ${currentSiteDomain.value}`
  : '始终翻译当前网站（当前页面不可用）');
const currentSiteExtensionSwitchLabel = computed(() => currentSiteSupported.value
  ? currentSiteExtensionDisabled.value
    ? `恢复 ${currentSiteDomain.value} 的扩展`
    : `在 ${currentSiteDomain.value} 禁用扩展`
  : '在此网站禁用扩展（当前页面不可用）');
const videoServiceLabel = computed(() => getTranslationServiceLabel(config.value, config.value.videoService));
const styleLabel = computed(() => styleOptions.value.find((item: any) => item.value === config.value.style)?.label || '默认样式');
const hoverKey = computed(() => config.value.hotkey === 'custom' ? (config.value.customHotkey || '自定义') : config.value.hotkey);
const hoverSummary = computed(() => config.value.hotkey === 'none' ? '已关闭' : `按住 ${hoverKey.value}`);
const fullPageHotkey = computed(() => {
  const hotkey = config.value.floatingBallHotkey === 'custom'
    ? config.value.customFloatingBallHotkey
    : config.value.floatingBallHotkey;
  return hotkey && hotkey !== 'none' ? hotkey : '未设置';
});
const pageActionPresentation = computed(() => {
  const feedback = actionFeedbacks.page;
  if (feedback) {
    return {
      key: `feedback-${feedback.tone}-${feedback.message}`,
      state: feedback.tone,
      label: feedback.message,
      showHotkey: false,
    } as const;
  }
  const label = pageTranslated.value ? '恢复原文' : '翻译页面';
  if (activeTranslationAction.value === 'page' && pagePendingVisible.value) {
    return { key: `pending-${label}`, state: 'pending', label, showHotkey: false } as const;
  }
  return { key: `idle-${label}`, state: 'idle', label, showHotkey: true } as const;
});
const siteRuleActionLabel = computed(() => actionFeedbacks['site-rule']?.message
  || (activeTranslationAction.value === 'site-rule'
    ? '正在开启…'
    : config.value.autoTranslate ? '全局自动翻译' : currentSiteAlwaysTranslated.value ? '始终翻译已开启' : '始终翻译此网站'));
const siteDisableActionLabel = computed(() => actionFeedbacks['site-disable']?.message
  || (currentSiteExtensionDisabled.value ? '已禁用扩展' : '在此网站禁用扩展'));
const cacheActionLabel = computed(() => actionFeedbacks.cache?.message || (clearingCache.value ? '清理中…' : '清除缓存'));
const selectionSummary = computed(() => {
  const textSummary = ({ disabled: '已关闭', bilingual: '双语显示', 'translation-only': '仅显示译文' }[config.value.selectionTranslatorMode] || '双语显示');
  const triggerSummary = selectionTriggers.find(item => item.value === config.value.selectionTranslatorTrigger)?.label || '显示图标';
  const selectionTextSummary = `${textSummary} · ${triggerSummary}`;
  if (!browserCapabilities.areaTranslation) return `${selectionTextSummary} · 圈选翻译不可用`;
  if (!config.value.selectionAreaEnabled) return selectionTextSummary;
  return textSummary === '已关闭' ? '圈选翻译已启用' : `${selectionTextSummary} · 圈选翻译`;
});
const displaySummary = computed(() => config.value.display === 1 ? `双语 · ${styleLabel.value}` : '仅显示译文');
const imageTranslationSummary = computed(() => !browserCapabilities.imageTranslation
  ? '当前浏览器不可用'
  : config.value.disableImageTranslator ? '已关闭' : '悬停图片');
const videoSummary = computed(() => config.value.videoTranslationEnabled ? `${videoServiceLabel.value} · YouTube` : '点击开启 · YouTube');
const viewTitle = computed(() => activeView.value === 'home' ? '' : ({ hover: '悬停翻译', selection: '划词翻译', appearance: '译文显示', image: '图片翻译', video: '视频字幕', filter: '内容过滤规则' }[activeView.value]));
const hoverChoices = [
  { value: 'Control', label: 'Ctrl' },
  { value: 'Alt', label: 'Alt / Option' },
  { value: 'Shift', label: 'Shift' },
  { value: 'custom', label: '自定义' },
];
const selectionModes = [
  { value: 'bilingual', label: '双语显示' },
  { value: 'translation-only', label: '仅译文' },
];
const selectionTriggers = options.selectionTranslatorTriggers;
const selectionTtsVoiceOptions = SELECTION_TTS_VOICE_OPTIONS;

async function hydrate() {
  await configReady;
  Object.assign(config.value, runtimeConfig);
  lastSerialized = JSON.stringify(config.value);
  hydrated.value = true;
  await hydrateCurrentSite();
}
void hydrate();

const unsubscribeConfig = subscribeConfig((value) => {
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, value);
  } finally {
    applyingExternalConfig = false;
  }
});

watch(() => JSON.stringify(config.value), async serialized => {
  if (!hydrated.value || applyingExternalConfig) return;
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const snapshot = normalizeConfig(config.value);
  try {
    await persistConfig(snapshot);
  } catch (error) {
    // 保存失败后允许下一次交互重试，不能让去重标记永久吞掉同一快照。
    if (lastSerialized === serialized) lastSerialized = '';
    console.warn('[BabelBox] 保存 popup 设置失败', error);
  }
}, { flush: 'sync' });
function closeServicePicker(event?: Event) {
  if (event && servicePicker.value?.contains(event.target as Node)) return;
  servicePickerOpen.value = false;
}
function handlePopupKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (servicePickerOpen.value) {
    closeServicePicker();
    event.preventDefault();
  } else if (activeView.value !== 'home' && !document.querySelector('.el-overlay-dialog, .el-popper[aria-hidden="false"]')) {
    // 下拉框和录键弹窗自行处理 Esc；只有没有浮层时才退回首页，避免 popup 被浏览器直接关闭。
    closeView();
    event.preventDefault();
  }
}
function toggleServicePicker() {
  servicePickerOpen.value = !servicePickerOpen.value;
}
function selectService(value: string) {
  config.value.service = value;
  servicePickerOpen.value = false;
}
function toggleAIContext() {
  if (!canUseAIContext.value || translationActionPending.value) return;
  config.value.enableAIContext = !config.value.enableAIContext;
}
onMounted(() => {
  document.addEventListener('pointerdown', closeServicePicker);
  document.addEventListener('keydown', handlePopupKeydown);
});
onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
  unsubscribeConfig();
  document.removeEventListener('pointerdown', closeServicePicker);
  document.removeEventListener('keydown', handlePopupKeydown);
  if (noticeTimer) clearTimeout(noticeTimer);
  if (pagePendingTimer) clearTimeout(pagePendingTimer);
  disposeActionFeedback();
});

function saveOnPageHide() {
  persistOnPageExit();
}
window.addEventListener('pagehide', saveOnPageHide);

// Firefox 可能同时触发 pagehide 和 unmounted；只提交一次最新快照。
function persistOnPageExit() {
  if (!hydrated.value || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void saveConfig(config.value).catch((error) => console.warn('[BabelBox] popup 关闭前本地保存设置失败', error));
  void persistConfig(config.value).catch((error) => console.warn('[BabelBox] popup 关闭前后台保存设置失败', error));
}

function showNotice(message: string, type: 'success' | 'error' = 'success') {
  notice.value = message;
  noticeType.value = type;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 2200);
}

async function hydrateCurrentSite() {
  currentTabId.value = null;
  currentSiteDomain.value = '';
  currentSiteLabel.value = '无法读取当前页面';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== 'number') return;
    currentTabId.value = tab.id;
    const currentSite = resolvePopupCurrentSite(tab.pendingUrl || tab.url || '');
    currentSiteDomain.value = currentSite.domain;
    currentSiteLabel.value = currentSite.label;
    if (!currentSiteDomain.value) return;

    try {
      const response = await browser.tabs.sendMessage(tab.id, {
        type: 'getFullPageTranslationState',
      }) as { status?: string; isTranslated?: boolean } | undefined;
      if (response?.status === 'success') pageTranslated.value = response.isTranslated === true;
    } catch {
      // 当前页面可能尚未注入内容脚本；站点规则仍然可以读取和编辑。
    }
  } catch (error) {
    console.warn('[BabelBox] 无法读取当前网站', error);
  }
}

async function setCurrentSiteAlwaysTranslated(enabled: boolean) {
  const domain = currentSiteDomain.value;
  const tabId = currentTabId.value;
  if (!domain || tabId === null) return;
  clearActionFeedback('site-rule');
  if (config.value.autoTranslate) {
    showNotice('已开启自动翻译所有网站，可在设置中关闭');
    return;
  }
  if (currentSiteExtensionDisabled.value) {
    showNotice(`已在 ${domain} 禁用扩展，请先恢复`);
    return;
  }

  const currentDomains = config.value.alwaysTranslateDomains ?? [];
  config.value.alwaysTranslateDomains = enabled
    ? currentDomains.includes(domain) ? currentDomains : [...currentDomains, domain]
    : currentDomains.filter(item => item !== domain);

  if (!enabled) {
    showActionFeedback('site-rule', '已关闭，当前页不变');
    return;
  }

  if (credentialWarning.value) {
    showActionFeedback('site-rule', '已保存，请先配置服务', 'error');
    return;
  }

  activeTranslationAction.value = 'site-rule';
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: 'contextMenuTranslate',
      action: 'fullPage',
    }) as { status?: string; isTranslated?: boolean } | undefined;
    if (response?.status !== 'success') throw new Error('Translation failed');
    pageTranslated.value = typeof response.isTranslated === 'boolean' ? response.isTranslated : true;
    showActionFeedback('site-rule', '已开启并开始翻译');
  } catch (error) {
    console.error(error);
    showActionFeedback('site-rule', '已保存，请刷新重试', 'error');
  } finally {
    activeTranslationAction.value = null;
  }
}

async function setCurrentSiteExtensionDisabled(enabled: boolean) {
  const domain = currentSiteDomain.value;
  const tabId = currentTabId.value;
  if (!domain || tabId === null) return;
  clearActionFeedback('site-disable');

  const currentDomains = config.value.disabledExtensionDomains ?? [];
  config.value.disabledExtensionDomains = enabled
    ? currentDomains.includes(domain) ? currentDomains : [...currentDomains, domain]
    : currentDomains.filter(item => item !== domain);
  pageTranslated.value = false;
  activeTranslationAction.value = null;

  // 先通知当前页立即收起扩展 UI；配置仍由 popup 的统一保存链路持久化。
  await browser.tabs.sendMessage(tabId, {
    type: 'updateSiteExtensionDisabled',
    isDisabled: enabled,
  }).catch(() => undefined);
  showActionFeedback('site-disable', enabled ? '已在此网站禁用' : '已恢复此网站');
}

async function broadcast(message: Record<string, unknown>) {
  const tabs = await browser.tabs.query({});
  const tabIds = tabs.map((tab) => tab.id).filter(isBrowserTabId);
  await Promise.allSettled(tabIds.map((tabId) => browser.tabs.sendMessage(tabId, message)));
}

function showView(view: PopupView) {
  servicePickerOpen.value = false;
  activeView.value = view;
  void nextTick(() => {
    popupBody.value?.scrollTo({ top: 0 });
    popupBody.value?.focus({ preventScroll: true });
  });
}
function openView(view: DetailView) { showView(view); }
function closeView() { showView('home'); }
function setCurrentSiteFilterRules(rules: TranslationFilterRule[]) {
  if (!currentSiteDomain.value) return;
  config.value.translationFilter = rules.length > 0
    ? upsertTranslationFilterSite(config.value.translationFilter, {
      domain: currentSiteDomain.value,
      rules,
    })
    : removeTranslationFilterSite(config.value.translationFilter, currentSiteDomain.value);
}
function removeCurrentSiteFilter() {
  if (!currentSiteDomain.value) return;
  config.value.translationFilter = removeTranslationFilterSite(
    config.value.translationFilter,
    currentSiteDomain.value,
  );
}
async function openOptions(section?: SettingsSection) {
  if (section) {
    await browser.tabs.create({ url: `${browser.runtime.getURL('/options.html')}#${section}` });
  } else {
    await browser.runtime.openOptionsPage();
  }
  window.close();
}

async function openDocumentTranslation() {
  await browser.tabs.create({ url: browser.runtime.getURL('/document.html') });
  window.close();
}

async function togglePageTranslation() {
  clearActionFeedback('page');
  if (credentialWarning.value) {
    showActionFeedback('page', '请先完成服务配置', 'error');
    return;
  }

  activeTranslationAction.value = 'page';
  pagePendingVisible.value = false;
  if (pagePendingTimer) clearTimeout(pagePendingTimer);
  pagePendingTimer = setTimeout(() => {
    pagePendingTimer = undefined;
    if (activeTranslationAction.value === 'page') pagePendingVisible.value = true;
  }, 180);
  const action = pageTranslated.value ? 'restore' : 'fullPage';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!isBrowserTabId(tab?.id)) throw new Error('No active tab');
    const response = await browser.tabs.sendMessage(tab.id, { type: 'contextMenuTranslate', action }) as { status?: string; isTranslated?: boolean } | undefined;
    if (response?.status !== 'success') throw new Error(response?.status === 'disabled' ? 'Plugin disabled' : 'Translation failed');
    pageTranslated.value = typeof response.isTranslated === 'boolean'
      ? response.isTranslated
      : action === 'fullPage';
    finishPagePendingPresentation();
    showActionFeedback('page', pageTranslated.value ? '已翻译' : '已恢复原文');
  } catch (error) {
    console.error(error);
    finishPagePendingPresentation();
    showActionFeedback('page', '暂不支持，请刷新重试', 'error');
  } finally {
    finishPagePendingPresentation();
    activeTranslationAction.value = null;
  }
}

function finishPagePendingPresentation() {
  if (pagePendingTimer) clearTimeout(pagePendingTimer);
  pagePendingTimer = undefined;
  pagePendingVisible.value = false;
}

async function clearCache() {
  clearActionFeedback('cache');
  clearingCache.value = true;
  try {
    await requestTranslationCacheClear((message) => browser.runtime.sendMessage(message));
    showActionFeedback('cache', '清除成功');
  } catch (error) {
    console.error(error);
    showActionFeedback('cache', '清除失败，请重试', 'error');
  } finally { clearingCache.value = false; }
}

function toggleHover() { config.value.hotkey = config.value.hotkey === 'none' ? 'Control' : 'none'; }
function setHoverHotkey(value: string) {
  config.value.hotkey = value;
  if (value === 'custom' && !config.value.customHotkey) showCustomMouseHotkeyDialog.value = true;
}
function setSelectionMode(mode: string) {
  config.value.selectionTranslatorMode = mode;
  config.value.disableSelectionTranslator = mode === 'disabled';
  void broadcast({ type: 'updateSelectionTranslatorMode', mode });
}
const selectionShortcutTriggers = new Set(['Control', 'Alt', 'Shift', 'custom']);
function setSelectionTrigger(trigger: string) {
  config.value.selectionTranslatorTrigger = trigger;
  config.value.selectionTranslatorHotkey = selectionShortcutTriggers.has(trigger) ? trigger : 'none';
  if (trigger === 'custom' && !config.value.customSelectionTranslatorHotkey) showCustomSelectionHotkeyDialog.value = true;
  broadcastSelectionTranslatorSettings();
}
function handleSelectionTranslatorDelayChange(value: number | undefined) {
  config.value.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(value);
  broadcastSelectionTranslatorSettings();
}
function setAreaEnabled(enabled: boolean) {
  if (!browserCapabilities.areaTranslation) {
    showNotice('当前浏览器暂不支持圈选翻译', 'error');
    return;
  }
  config.value.selectionAreaEnabled = enabled;
  void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: enabled });
}
function setImageTranslatorEnabled(enabled: boolean) {
  if (!browserCapabilities.imageTranslation) {
    showNotice('当前浏览器暂不支持图片翻译与 OCR', 'error');
    return;
  }
  config.value.disableImageTranslator = !enabled;
  void broadcast({ type: 'toggleImageTranslator', isEnabled: enabled });
}
function setVideoTranslationEnabled(enabled: boolean) {
  config.value.videoTranslationEnabled = enabled;
}
function confirmMouseHotkey(hotkey: string) { config.value.customHotkey = hotkey; config.value.hotkey = 'custom'; }
function cancelMouseHotkey() { if (!config.value.customHotkey) config.value.hotkey = 'Control'; }
function confirmSelectionHotkey(hotkey: string) {
  config.value.customSelectionTranslatorHotkey = hotkey;
  config.value.selectionTranslatorTrigger = 'custom';
  config.value.selectionTranslatorHotkey = 'custom';
  broadcastSelectionTranslatorSettings();
}
function cancelSelectionHotkey() {
  if (!config.value.customSelectionTranslatorHotkey) {
    config.value.selectionTranslatorTrigger = 'icon';
    config.value.selectionTranslatorHotkey = 'none';
    broadcastSelectionTranslatorSettings();
  }
}
function broadcastSelectionTranslatorSettings() {
  void broadcast({
    type: 'updateSelectionTranslatorSettings',
    trigger: config.value.selectionTranslatorTrigger,
    customHotkey: config.value.customSelectionTranslatorHotkey,
    delay: config.value.selectionTranslatorDelay,
  });
}
</script>
