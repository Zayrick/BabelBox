<!-- Popup 页面归 app 层所有；WXT 入口只负责调用挂载函数。 -->
<template>
  <main
    class="popup-shell"
    :class="{ 'config-loading': !hydrated }"
    :aria-busy="!hydrated"
    :data-config-ready="hydrated ? 'true' : 'false'"
    :inert="!hydrated"
  >
    <header class="popup-header">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div>
          <strong>流畅阅读</strong>
        </div>
      </div>
      <div class="header-actions">
        <button class="donation-button" type="button" title="赞赏流畅阅读" aria-label="打开赞赏页" @click="openDonation()">
          <Coffee aria-hidden="true" />
          <span>赞赏</span>
        </button>
        <button class="settings-button" type="button" title="完整设置" aria-label="打开完整设置" @click="openOptions()">
          <Settings aria-hidden="true" />
          <span>设置</span>
        </button>
      </div>
    </header>

    <Transition name="donation-fade">
      <div
        v-if="donationVisible"
        class="donation-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-title"
        @click.self="closeDonation"
      >
        <section class="donation-card">
          <button class="donation-close" type="button" aria-label="关闭赞赏页" @click="closeDonation">
            <X aria-hidden="true" />
          </button>
          <h2 id="donation-title">赞赏流畅阅读</h2>
          <p class="donation-description">微信扫码赞赏</p>
          <div class="donation-qr-frame">
            <img src="/misc/approve.jpg" alt="流畅阅读赞赏码" />
          </div>
        </section>
      </div>
    </Transition>

    <section class="hero-card">
      <div class="hero-heading">
        <h1>{{ config.on ? '网页翻译' : '翻译功能已暂停' }}</h1>
        <div class="hero-switches">
          <button class="switch" type="button" role="switch" :aria-checked="config.on" :aria-label="config.on ? '暂停插件' : '启用插件'" @click="setPluginEnabled(!config.on)"><i /></button>
        </div>
      </div>

      <div class="language-pair">
        <label>
          <span>源语言</span>
          <el-select v-model="config.from" aria-label="网页翻译源语言" :disabled="!config.on">
            <el-option v-for="item in options.form" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <span class="arrow" aria-hidden="true"><ArrowRight /></span>
        <label>
          <span>目标语言</span>
          <el-select v-model="config.to" aria-label="网页翻译目标语言" :disabled="!config.on">
            <el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
      </div>

      <div ref="servicePicker" class="service-picker">
        <button
          class="service-field"
          type="button"
          :disabled="!config.on"
          aria-haspopup="listbox"
          :aria-expanded="servicePickerOpen"
          :aria-label="servicePickerAriaLabel"
          :data-selected-model="serviceModelLabel || undefined"
          @click="toggleServicePicker"
        >
          <ServiceIcon :service="selectedServiceProvider" :label="serviceLabel" size="small" />
          <span class="service-copy">
            <small>翻译服务</small>
            <span class="service-value">
              <strong>{{ serviceLabel }}</strong>
              <em v-if="serviceModelLabel" class="service-model" :title="serviceModelLabel">{{ serviceModelLabel }}</em>
            </span>
          </span>
          <span class="chevron" :class="{ open: servicePickerOpen }" aria-hidden="true"><ChevronDown /></span>
        </button>

        <div v-if="servicePickerOpen" class="service-picker-panel" role="listbox" aria-label="翻译服务列表">
          <div class="service-picker-heading">
            <strong>选择翻译服务</strong>
          </div>

          <div class="service-group">
            <span class="service-group-label">常用服务</span>
            <button
              v-for="item in popularServiceOptions"
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

          <button class="service-more-toggle" type="button" :aria-expanded="moreServicesOpen" @click="moreServicesOpen = !moreServicesOpen">
            <span>更多服务</span>
            <span class="service-more-meta">{{ moreServiceOptions.length }} 项 <b :class="{ open: moreServicesOpen }"><ChevronDown aria-hidden="true" /></b></span>
          </button>

          <div v-if="moreServicesOpen" class="service-group service-group-more">
            <button
              v-for="item in moreServiceOptions"
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
      </div>

      <div v-if="credentialWarning" class="credential-warning" role="alert">
        <span><strong>配置提醒</strong>{{ credentialWarning }}</span>
        <button type="button" @click="openOptions('settings-services')">去设置</button>
      </div>

      <div class="translate-action">
        <button
          class="translate-button"
          :class="{ translated: pageTranslated, 'has-feedback': actionFeedbacks.page, 'feedback-error': actionFeedbacks.page?.tone === 'error' }"
          type="button"
          :disabled="!config.on || translationActionPending || Boolean(selectedServiceUnavailableMessage)"
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
        <button
          v-if="canUseAIContext"
          class="ai-context-toggle"
          type="button"
          :aria-pressed="config.enableAIContext"
          :aria-label="config.enableAIContext ? '关闭 AI精翻' : '开启 AI精翻'"
          :title="config.enableAIContext ? '关闭 AI精翻' : '开启 AI精翻'"
          :disabled="!config.on || translationActionPending"
          @click="toggleAIContext"
        >
          <span class="ai-context-copy">AI精翻</span>
          <span class="ai-context-indicator" aria-hidden="true" />
        </button>
      </div>

      <div class="site-rule-row">
        <div class="site-rule-copy">
          <span>当前网站</span>
          <strong :title="currentSiteLabel">{{ currentSiteLabel }}</strong>
        </div>
        <div class="site-rule-actions">
          <div
            v-if="!currentSiteSupported"
            class="site-rule-unavailable"
            role="status"
            aria-disabled="true"
          >
            当前页面不支持网页翻译与网站规则
          </div>
          <button
            v-else
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
              <span :key="siteRuleActionLabel" aria-live="polite">{{ siteRuleActionLabel }}</span>
            </Transition>
            <i aria-hidden="true" />
          </button>
          <button
            v-if="currentSiteSupported"
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
              <span :key="siteDisableActionLabel" aria-live="polite">{{ siteDisableActionLabel }}</span>
            </Transition>
            <i aria-hidden="true" />
          </button>
        </div>
      </div>

      <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>
    </section>

    <section class="features">
      <span class="eyebrow features-eyebrow">快捷功能</span>
      <div class="feature-grid">
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('hover')">
          <span class="feature-icon rose" aria-hidden="true"><MousePointer /></span>
          <span><strong>鼠标悬停翻译</strong><small>{{ hoverSummary }}</small></span>
          <span class="feature-indicators" aria-hidden="true">
            <i :class="{ active: config.hotkey !== 'none' }" />
            <ChevronRight />
          </span>
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('selection')">
          <span class="feature-icon violet" aria-hidden="true"><TextSelect /></span>
          <span><strong>划词翻译</strong><small>{{ selectionSummary }}</small></span>
          <span class="feature-indicators" aria-hidden="true">
            <i :class="{ active: config.selectionTranslatorMode !== 'disabled' || (browserCapabilities.areaTranslation && config.selectionAreaEnabled) }" />
            <ChevronRight />
          </span>
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('appearance')">
          <span class="feature-icon amber" aria-hidden="true"><Type /></span>
          <span><strong>译文显示</strong><small>{{ displaySummary }}</small></span>
          <ChevronRight class="feature-chevron" aria-hidden="true" />
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('image')">
          <span class="feature-icon teal" aria-hidden="true"><ImageIcon /></span>
          <span class="feature-copy">
            <span class="feature-title"><strong>图片翻译</strong><em class="beta-badge">Beta 测试</em></span>
            <small>{{ imageTranslationSummary }}</small>
          </span>
          <span class="feature-indicators" aria-hidden="true">
            <i :class="{ active: browserCapabilities.imageTranslation && !config.disableImageTranslator }" />
            <ChevronRight />
          </span>
        </button>
        <button
          class="feature-card video-feature-card"
          :class="{ 'needs-enable': !config.videoTranslationEnabled }"
          data-feature="video-subtitle"
          type="button"
          :disabled="!config.on"
          :aria-label="config.videoTranslationEnabled ? '打开视频字幕设置，当前已开启' : '打开视频字幕设置，点击开启字幕翻译'"
          @click="openDrawer('video')"
        >
          <span class="feature-icon teal" aria-hidden="true"><Captions /></span>
          <span class="feature-copy">
            <span class="feature-title"><strong>视频字幕</strong><em class="beta-badge">Beta 测试</em></span>
            <small>{{ videoSummary }}</small>
          </span>
          <span class="feature-indicators" aria-hidden="true">
            <i :class="{ active: config.videoTranslationEnabled }" />
            <ChevronRight />
          </span>
        </button>
        <button
          class="feature-card document-feature-card"
          data-feature="document-translation"
          type="button"
          :disabled="!config.on"
          aria-label="打开文档翻译，Beta 测试"
          @click="openDocumentTranslation()"
        >
          <span class="feature-icon blue" aria-hidden="true"><FileText /></span>
          <span class="feature-copy">
            <span class="feature-title"><strong>文档翻译</strong><em class="beta-badge">Beta 测试</em></span>
            <small>HTML / TXT / Markdown / 字幕 / JSON</small>
          </span>
          <ExternalLink class="feature-chevron" aria-hidden="true" />
        </button>
      </div>
    </section>

    <footer>
      <a
        class="opensource-link"
        href="https://github.com/Bistutu/FluentRead"
        target="_blank"
        rel="noreferrer"
        aria-label="在 GitHub 查看流畅阅读开源项目"
      >
        <svg class="github-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" />
        </svg>
        <span>开源项目</span>
        <ExternalLink class="external-mark" aria-hidden="true" />
      </a>
      <button
        class="cache-clear-button"
        :class="actionFeedbacks.cache?.tone"
        type="button"
        :disabled="clearingCache"
        :aria-busy="clearingCache"
        @click="clearCache"
      >
        <Transition name="action-copy" mode="out-in">
          <span :key="cacheActionLabel" aria-live="polite">{{ cacheActionLabel }}</span>
        </Transition>
      </button>
    </footer>

    <el-drawer
      v-model="drawerVisible"
      direction="btt"
      size="auto"
      :with-header="false"
      :append-to-body="true"
      modal-class="popup-drawer-modal"
      class="popup-drawer"
    >
      <div class="drawer-handle" />
      <header class="drawer-header">
        <h2>{{ drawerTitle }}</h2>
        <button type="button" aria-label="关闭" @click="drawerVisible = false"><X aria-hidden="true" /></button>
      </header>

      <div v-if="activeDrawer === 'hover'" class="drawer-content">
        <div class="setting-row">
          <span><strong>启用鼠标悬停翻译</strong><small>按住快捷键并悬停在文本上</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="config.hotkey !== 'none'" aria-label="启用或关闭鼠标悬停翻译" @click="toggleHover"><i /></button>
        </div>
        <div class="choice-block">
          <label>触发快捷键</label>
          <div class="chips two">
            <button v-for="item in hoverChoices" :key="item.value" type="button" :class="{ selected: config.hotkey === item.value }" @click="setHoverHotkey(item.value)">{{ item.label }}</button>
          </div>
          <button v-if="config.hotkey === 'custom'" class="secondary-action" type="button" @click="showCustomMouseHotkeyDialog = true">
            {{ config.customHotkey ? `当前：${config.customHotkey}` : '录制自定义快捷键' }}
          </button>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'selection'" class="drawer-content">
        <div class="selection-mode-tabs" role="tablist" aria-label="翻译方式">
          <button class="selection-mode-tab" :class="{ selected: selectionDrawerTab === 'text' }" type="button" role="tab" :aria-selected="selectionDrawerTab === 'text'" aria-controls="selection-text-panel" @click="selectionDrawerTab = 'text'">划词翻译</button>
          <button class="selection-mode-tab" :class="{ selected: selectionDrawerTab === 'area' }" type="button" role="tab" :aria-selected="selectionDrawerTab === 'area'" aria-controls="selection-area-panel" @click="selectionDrawerTab = 'area'">圈选翻译</button>
        </div>

        <div v-if="selectionDrawerTab === 'text'" id="selection-text-panel" role="tabpanel">
          <div class="setting-row">
            <span><strong>启用划词翻译</strong></span>
            <button class="switch compact" type="button" role="switch" :aria-checked="config.selectionTranslatorMode !== 'disabled'" aria-label="启用或关闭划词翻译" @click="setSelectionMode(config.selectionTranslatorMode === 'disabled' ? 'bilingual' : 'disabled')"><i /></button>
          </div>
          <div class="choice-block">
            <label>显示方式</label>
            <div class="chips two">
              <button v-for="item in selectionModes" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorMode === item.value }" @click="setSelectionMode(item.value)">{{ item.label }}</button>
            </div>
          </div>
          <div class="choice-block">
            <label>触发方式</label>
            <div class="chips selection-trigger-chips">
              <button v-for="item in selectionTriggers" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorTrigger === item.value }" @click="setSelectionTrigger(item.value)">{{ item.label }}</button>
            </div>
            <button v-if="config.selectionTranslatorTrigger === 'custom'" class="secondary-action" type="button" @click="showCustomSelectionHotkeyDialog = true">
              {{ config.customSelectionTranslatorHotkey ? `当前：${config.customSelectionTranslatorHotkey}` : '录制自定义快捷键' }}
            </button>
          </div>
          <div class="choice-block">
            <label>显示延迟</label>
            <div class="selection-delay-control">
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
            <small class="drawer-hint">0 表示不延迟。</small>
          </div>
          <div class="choice-block">
            <label>语音回退顺序</label>
            <el-select
              v-model="config.selectionTtsVoices"
              class="selection-tts-voice-select"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              aria-label="划词翻译语音回退顺序"
              placeholder="自动按语言选择"
              no-data-text="没有可用音色"
            >
              <el-option
                v-for="item in selectionTtsVoiceOptions"
                :key="item.value"
                :label="`${item.label} · ${item.locale}`"
                :value="item.value"
              />
          </el-select>
            <small class="drawer-hint">留空时自动选择音色。</small>
          <button class="wordbook-shortcut" type="button" @click="openOptions('settings-vocabulary')">
            <span class="wordbook-shortcut-icon" aria-hidden="true"><Star /></span>
            <span><strong>单词本 <em>Beta</em></strong><small>{{ config.vocabularyBookEnabled ? '查看收藏、今日复习与掌握程度' : '开启后可从单词学习卡收藏并复习' }}</small></span>
            <ChevronRight class="wordbook-shortcut-chevron" aria-hidden="true" />
          </button>
          </div>
        </div>

        <div v-else id="selection-area-panel" class="selection-area-panel" role="tabpanel">
          <div v-if="!browserCapabilities.areaTranslation" class="capability-unavailable" role="status">
            <strong>当前浏览器暂不支持圈选翻译</strong>
            <small>原有开关偏好已保留；回到 Chrome 后仍会按原设置生效。</small>
          </div>
          <div v-else class="area-translation-block">
            <div class="area-translation-heading">
              <div>
                <strong>启用圈选翻译</strong>
                <small>翻译图片或无法直接选中的页面文字</small>
              </div>
              <button class="switch compact" type="button" role="switch" :aria-checked="config.selectionAreaEnabled" aria-label="启用或关闭圈选翻译" @click="setAreaEnabled(!config.selectionAreaEnabled)"><i /></button>
            </div>
            <small class="drawer-hint">按 Shift + Z 拖拽区域，按 Esc 关闭结果。</small>
          </div>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'image'" class="drawer-content">
        <div v-if="!browserCapabilities.imageTranslation" class="capability-unavailable" role="status">
          <strong>当前浏览器暂不支持图片翻译与 OCR</strong>
          <small>原有开关偏好已保留；请在 Chrome 中使用此功能。</small>
        </div>
        <div v-if="browserCapabilities.imageTranslation" class="setting-row">
          <span><strong>启用图片翻译</strong><small>在网页图片左下角显示翻译按钮</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="!config.disableImageTranslator" aria-label="启用或关闭图片翻译" @click="setImageTranslatorEnabled(config.disableImageTranslator)"><i /></button>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'video'" class="drawer-content">
        <div class="video-beta-banner"><span class="feature-icon teal" aria-hidden="true"><Captions /></span><span><strong>YouTube 字幕翻译</strong><small>Beta 测试</small></span></div>
        <div class="setting-row video-enable-row" :class="{ 'needs-enable': !config.videoTranslationEnabled }">
          <span><strong>{{ config.videoTranslationEnabled ? '字幕翻译已开启' : '开启字幕翻译' }}</strong><small>在 YouTube 原生字幕下方显示译文</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="config.videoTranslationEnabled" aria-label="启用或关闭视频字幕翻译" @click="setVideoTranslationEnabled(!config.videoTranslationEnabled)"><i /></button>
        </div>
        <label class="select-row">
          <span><strong>视频翻译服务</strong><small>与网页翻译服务独立保存</small></span>
          <el-select v-model="config.videoService" aria-label="视频翻译服务" :disabled="!config.videoTranslationEnabled">
            <el-option v-if="selectedVideoServiceUnavailableMessage" :label="`${videoServiceLabel}（当前浏览器不可用）`" :value="config.videoService" disabled />
            <el-option v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <small v-if="selectedVideoServiceUnavailableMessage" class="drawer-hint capability-warning">{{ selectedVideoServiceUnavailableMessage }}</small>
        <label class="select-row">
          <span><strong>字幕字号</strong><small>只调整 FluentRead 显示的原文和译文</small></span>
          <el-select v-model="config.videoSubtitleFontSize" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled">
            <el-option v-for="size in videoSubtitleFontSizeOptions" :key="size" :label="size === 100 ? '默认' : `${size}%`" :value="size" />
          </el-select>
        </label>
      </div>

      <div v-else class="drawer-content">
        <div class="choice-block">
          <label>翻译模式</label>
          <div class="chips two">
            <button v-for="item in options.display" :key="item.value" type="button" :class="{ selected: config.display === item.value }" @click="config.display = item.value">{{ item.label }}</button>
          </div>
        </div>
        <label v-if="config.display === 1" class="select-row">
          <span><strong>译文样式</strong></span>
          <el-select v-model="config.style" aria-label="译文样式">
            <el-option v-for="item in styleOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
        <label class="select-row">
          <span><strong>界面主题</strong><small>同时应用到完整设置页面</small></span>
          <el-select v-model="config.theme" aria-label="界面主题">
            <el-option v-for="item in options.theme" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </label>
      </div>

      <button class="drawer-settings-link" type="button" @click="openOptions(drawerSettingsSection[activeDrawer])">
        <span>在完整设置中查看全部选项</span>
        <ExternalLink aria-hidden="true" />
      </button>
    </el-drawer>

    <CustomHotkeyInput v-model="showCustomMouseHotkeyDialog" :current-value="config.customHotkey" @confirm="confirmMouseHotkey" @cancel="cancelMouseHotkey" />
    <CustomHotkeyInput v-model="showCustomSelectionHotkeyDialog" :current-value="config.customSelectionTranslatorHotkey" @confirm="confirmSelectionHotkey" @cancel="cancelSelectionHotkey" />
  </main>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import {browser} from 'wxt/browser';
import {
  config as runtimeConfig,
  configReady,
  saveConfig,
  requestConfigSave,
  subscribeConfig,
} from '@/src/services/config/store';
import {
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  Coffee,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Languages,
  MousePointer,
  Settings,
  Star,
  TextSelect,
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

type DrawerName = 'hover' | 'selection' | 'appearance' | 'image' | 'video';
type SettingsSection = 'settings-general' | 'settings-image-translation' | 'settings-shortcuts' | 'settings-services' | 'settings-sites' | 'settings-video' | 'settings-vocabulary';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));
const config = ref(new Config());
const drawerVisible = ref(false);
const activeDrawer = ref<DrawerName>('hover');
const selectionDrawerTab = ref<'text' | 'area'>('text');
const activeTranslationAction = ref<'page' | 'site-rule' | null>(null);
const pagePendingVisible = ref(false);
const pageTranslated = ref(false);
const currentTabId = ref<number | null>(null);
const currentSiteDomain = ref('');
const currentSiteLabel = ref('无法读取当前页面');
const clearingCache = ref(false);
const donationVisible = ref(false);
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
const showCustomMouseHotkeyDialog = ref(false);
const showCustomSelectionHotkeyDialog = ref(false);
const servicePicker = ref<HTMLElement | null>(null);
const servicePickerOpen = ref(false);
const moreServicesOpen = ref(true);
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
const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
const drawerSettingsSection: Record<DrawerName, SettingsSection> = {
  hover: 'settings-shortcuts',
  selection: 'settings-shortcuts',
  appearance: 'settings-general',
  image: 'settings-image-translation',
  video: 'settings-video',
};
const persistConfig = (value: unknown) => requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));

const serviceOptions = computed(() => getSelectableTranslationServices(config.value));
const videoServiceOptions = computed(() => getSelectableTranslationServices(config.value));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const popularServiceOptions = computed(() => serviceOptions.value.slice(0, 5));
const moreServiceOptions = computed(() => serviceOptions.value.slice(5));
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
const currentSiteSwitchLabel = computed(() => currentSiteSupported.value
  ? currentSiteExtensionDisabled.value
    ? `${currentSiteDomain.value} 已禁用扩展，无法开启始终翻译`
    : config.value.autoTranslate
    ? `所有网站自动翻译已开启，${currentSiteDomain.value} 会自动翻译`
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
const hoverSummary = computed(() => config.value.hotkey === 'none' ? '已关闭' : `${hoverKey.value} + 鼠标悬停`);
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
  const label = pageTranslated.value ? '恢复当前网页' : '翻译当前网页';
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
const drawerTitle = computed(() => ({ hover: '鼠标悬停翻译设置', selection: '划词翻译设置', appearance: '译文显示设置', image: '图片翻译设置', video: '视频字幕设置' }[activeDrawer.value]));
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

function applyTheme(theme: string) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && darkMode.matches));
}

async function hydrate() {
  await configReady;
  Object.assign(config.value, runtimeConfig);
  lastSerialized = JSON.stringify(config.value);
  hydrated.value = true;
  applyTheme(config.value.theme || 'auto');
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
    console.warn('[FluentRead] 保存 popup 设置失败', error);
  }
}, { flush: 'sync' });
watch(() => config.value.theme, theme => applyTheme(theme || 'auto'));
darkMode.onchange = () => { if (config.value.theme === 'auto') applyTheme('auto'); };

function closeServicePicker(event?: Event) {
  if (event && servicePicker.value?.contains(event.target as Node)) return;
  servicePickerOpen.value = false;
}
function openDonation() { donationVisible.value = true; }
function closeDonation() { donationVisible.value = false; }
function handleDonationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && donationVisible.value) closeDonation();
}
function handleServicePickerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeServicePicker();
}
function toggleServicePicker() {
  if (!config.value.on) return;
  servicePickerOpen.value = !servicePickerOpen.value;
  if (servicePickerOpen.value) moreServicesOpen.value = true;
}
function selectService(value: string) {
  config.value.service = value;
  servicePickerOpen.value = false;
}
function toggleAIContext() {
  if (!canUseAIContext.value || !config.value.on || translationActionPending.value) return;
  config.value.enableAIContext = !config.value.enableAIContext;
}
onMounted(() => {
  document.addEventListener('pointerdown', closeServicePicker);
  document.addEventListener('keydown', handleServicePickerKeydown);
  document.addEventListener('keydown', handleDonationKeydown);
});
onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
  unsubscribeConfig();
  document.removeEventListener('pointerdown', closeServicePicker);
  document.removeEventListener('keydown', handleServicePickerKeydown);
  document.removeEventListener('keydown', handleDonationKeydown);
  darkMode.onchange = null;
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
  void saveConfig(config.value).catch((error) => console.warn('[FluentRead] popup 关闭前本地保存设置失败', error));
  void persistConfig(config.value).catch((error) => console.warn('[FluentRead] popup 关闭前后台保存设置失败', error));
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
    console.warn('[FluentRead] 无法读取当前网站', error);
  }
}

async function setCurrentSiteAlwaysTranslated(enabled: boolean) {
  const domain = currentSiteDomain.value;
  const tabId = currentTabId.value;
  if (!domain || tabId === null) return;
  clearActionFeedback('site-rule');
  if (config.value.autoTranslate) {
    showNotice('所有网站自动翻译已开启，请在完整设置中关闭全局开关');
    return;
  }
  if (currentSiteExtensionDisabled.value) {
    showNotice(`当前已在 ${domain} 禁用扩展，请先恢复扩展`);
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

  if (!config.value.on) {
    showActionFeedback('site-rule', '已保存，启用后生效');
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

function setPluginEnabled(enabled: boolean) {
  config.value.on = enabled;
  if (!enabled) {
    void broadcast({ type: 'toggleFloatingBall', isEnabled: false });
    void broadcast({ type: 'updateSelectionTranslatorMode', mode: 'disabled' });
    void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: false });
    void broadcast({ type: 'toggleImageTranslator', isEnabled: false });
    return;
  }

  void broadcast({ type: 'toggleFloatingBall', isEnabled: !config.value.disableFloatingBall });
  void broadcast({ type: 'updateSelectionTranslatorMode', mode: config.value.selectionTranslatorMode });
  if (browserCapabilities.areaTranslation) {
    void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: config.value.selectionAreaEnabled });
  }
  if (browserCapabilities.imageTranslation) {
    void broadcast({ type: 'toggleImageTranslator', isEnabled: !config.value.disableImageTranslator });
  }
}

function openDrawer(name: DrawerName) { activeDrawer.value = name; drawerVisible.value = true; }
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
    showActionFeedback('page', pageTranslated.value ? '网页翻译已开启' : '已恢复网页原文');
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
