<template>
  <section v-show="props.activeSection === 'settings-general'" id="settings-general" class="settings-section settings-list-section">
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em settings-status-row">
    <el-col :span="20" class="settings-control-label lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">启用 FluentRead</span>
    </el-col>
    <el-col :span="4" class="settings-control-field flex-end">
      <el-switch class="settings-switch" v-model="config.on" aria-label="插件状态" size="large" @change="handlePluginStateChange" />
    </el-col>
  </el-row>
  <!-- 占位符 -->
  <div v-if="!config.on">
    <el-empty description="插件处于禁用状态" />
  </div>
  <div v-show="config.on">
    <!--    翻译模式-->
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">翻译模式</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.display" aria-label="翻译模式" placeholder="请选择翻译模式">
          <el-option class="select-left" v-for="item in options.display" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>
    <!-- 默认目标语言 -->
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">默认目标语言</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.to" aria-label="默认目标语言" placeholder="请选择目标语言">
          <el-option class="select-left" v-for="item in options.to" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>
    <!-- 文本与视频使用独立的翻译服务 -->
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="网页、划词和悬停翻译使用的默认服务。视频字幕服务可以单独选择。">文本翻译服务</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.service" aria-label="文本翻译服务" placeholder="请选择文本翻译服务">
          <el-option v-if="selectedTextServiceUnavailableMessage" :label="'Chrome内置AI翻译（当前浏览器不可用）'" :value="config.service" disabled />
          <el-option class="select-left" v-for="item in availableServiceOptions" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" />
        </el-select>
        <p v-if="selectedTextServiceUnavailableMessage" class="capability-warning">{{ selectedTextServiceUnavailableMessage }}</p>
      </el-col>
    </el-row>
    <el-row class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="YouTube 原生字幕下方显示的译文使用此服务，与文本翻译服务互不影响。">视频翻译服务</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.videoService" aria-label="视频翻译服务" placeholder="请选择视频翻译服务">
          <el-option v-if="selectedVideoServiceUnavailableMessage" :label="'Chrome内置AI翻译（当前浏览器不可用）'" :value="config.videoService" disabled />
          <el-option class="select-left" v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <p v-if="selectedVideoServiceUnavailableMessage" class="capability-warning">{{ selectedVideoServiceUnavailableMessage }}</p>
      </el-col>
    </el-row>
    <!--    译文样式选择器-->
    <el-row v-show="config.display === 1" class="margin-bottom margin-left-2em settings-preference-row">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="选择双语模式下译文的显示样式，提供多种美观的效果">译文样式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.style" aria-label="译文样式" placeholder="请选择译文显示样式">
          <el-option-group v-for="group in styleGroups" :key="group.value" :label="group.label">
            <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value"
              :class="item.class" />
          </el-option-group>
        </el-select>
      </el-col>
    </el-row>
    <section v-show="config.display === 1" class="style-preview-card" aria-live="polite">
      <div class="style-preview-example">
        <p class="style-preview-source">Reading should feel calm and effortless.</p>
        <p :key="config.style" class="style-preview-text" :class="currentStyleClass">阅读应该轻松、自然，不打断你的节奏。</p>
      </div>
    </section>
  </div>
  </section>
  <section v-show="props.activeSection === 'settings-sites'" id="settings-sites" class="settings-section site-settings-section">
    <el-row class="settings-control-row" data-setting="global-auto-translate">
      <el-col :span="20" class="settings-control-label lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">所有网站自动翻译</span>
      </el-col>
      <el-col :span="4" class="settings-control-field flex-end">
        <el-switch v-model="config.autoTranslate" class="settings-toggle" aria-label="所有网站自动翻译" />
      </el-col>
    </el-row>
    <AlwaysTranslateSites v-model="config.alwaysTranslateDomains" />
    <AlwaysTranslateSites v-model="config.disabledExtensionDomains" variant="disable-extension" />
  </section>
  <div v-if="!config.on && !['settings-general', 'settings-image-translation', 'settings-translation-center', 'settings-sites'].includes(props.activeSection)" class="disabled-section">
    <strong>插件当前已关闭</strong>
    <p>请先在“通用设置”中启用插件，再调整该分类。</p>
  </div>
  <section v-show="props.activeSection === 'settings-translation-center'" id="settings-translation-center" class="settings-section translation-center-section">
    <TranslationCenter />
  </section>
  <div v-show="config.on" class="settings-main-sections">
    <!-- 翻译服务 -->
    <section v-show="props.activeSection === 'settings-services'" id="settings-services" class="settings-section">
      <div v-if="selectedTextServiceUnavailableMessage" class="disabled-section" role="status">
        <strong>当前默认服务在此浏览器不可用</strong>
        <p>{{ selectedTextServiceUnavailableMessage }}请在“通用设置”中选择可用服务。</p>
      </div>
      <ServiceCatalog
        :service="selectedConfigurationService"
        :selected-service-option="configurationServiceOption"
        :default-service="config.service"
        :selected-model="config.model[selectedConfigurationService]"
        :services="filteredServices"
        :model-options="configurationModelOptions"
        :custom-models="config.customModel"
        :presentation="configurationPresentation"
        @update:service="setConfigurationService"
        @update:model="config.model[selectedConfigurationService] = $event"
      >
        <template #configuration>
          <ServiceConfiguration
            :config="config"
            :service="selectedConfigurationService"
            :presentation="configurationPresentation"
            :options="options"
            :is-valid-azure-endpoint="isValidAzureEndpoint"
          />
        </template>
      </ServiceCatalog>
    </section>
    <ImageOcrSettings v-show="props.activeSection === 'settings-image-translation'" />
    <!-- 视频字幕 Beta -->
    <section v-show="props.activeSection === 'settings-video'" id="settings-video" class="settings-section settings-list-section">
      <el-row class="settings-control-row video-settings-toggle-row">
        <el-col :span="20" class="settings-control-label lightblue rounded-corner">
          <span class="popup-text popup-vertical-left">启用视频字幕翻译</span>
        </el-col>
        <el-col :span="4" class="settings-control-field flex-end">
          <el-switch v-model="config.videoTranslationEnabled" class="settings-switch" aria-label="视频字幕翻译" />
        </el-col>
      </el-row>

      <el-row class="settings-control-row">
        <el-col :span="12" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="视频字幕独立选择翻译服务，默认微软翻译；AI 服务会提前预取字幕，网页翻译仍使用上方的文本翻译服务。">视频翻译服务</SettingsHelpLabel>
        </el-col>
        <el-col :span="12" class="settings-control-field">
          <el-select v-model="config.videoService" aria-label="视频字幕翻译服务" :disabled="!config.videoTranslationEnabled" placeholder="请选择服务">
            <el-option v-if="selectedVideoServiceUnavailableMessage" :label="'Chrome内置AI翻译（当前浏览器不可用）'" :value="config.videoService" disabled />
            <el-option class="select-left" v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <p v-if="selectedVideoServiceUnavailableMessage" class="capability-warning">{{ selectedVideoServiceUnavailableMessage }}</p>
        </el-col>
      </el-row>

      <el-row class="settings-control-row">
        <el-col :span="12" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="只调整 FluentRead 在播放器中显示的原文和译文字号，不改变 YouTube 原生字幕设置。">字幕字号</SettingsHelpLabel>
        </el-col>
        <el-col :span="12" class="settings-control-field">
          <el-select v-model="config.videoSubtitleFontSize" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled" placeholder="请选择字号">
            <el-option class="select-left" v-for="size in videoSubtitleFontSizeOptions" :key="size" :label="size === 100 ? '默认' : `${size}%`" :value="size" />
          </el-select>
        </el-col>
      </el-row>

      <p class="video-settings-note">仅处理播放器已经提供的字幕文本，不上传音频或视频内容。</p>
    </section>



    <!-- 鼠标悬浮快捷键 -->
    <section v-show="props.activeSection === 'settings-shortcuts'" id="settings-shortcuts" class="settings-section settings-list-section">
    <el-row class="settings-control-row" :class="{ 'custom-hotkey-row': config.hotkey === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="按住指定快捷键并悬停在文本上进行翻译">鼠标悬浮快捷键</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.hotkey" 
            aria-label="鼠标悬浮快捷键"
            placeholder="请选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleMouseHotkeyChange"
          >
            <el-option v-for="item in options.keys" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.hotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customHotkey">
              {{ getCustomMouseHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" aria-label="编辑鼠标悬浮快捷键" @click="openCustomMouseHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 鼠标悬浮翻译延迟 -->
    <el-row class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="按住鼠标悬浮快捷键并移动鼠标后，等待指定时间再翻译；调高可以减少 Ctrl+C 等组合键带来的误触。松开快捷键触发的单次翻译不受影响。">悬浮翻译延迟</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end translation-delay-field">
        <el-input-number
          v-model="config.mouseHoverTranslationDelay"
          aria-label="悬浮翻译延迟"
          :min="MOUSE_HOVER_TRANSLATION_DELAY_MIN"
          :max="MOUSE_HOVER_TRANSLATION_DELAY_MAX"
          :step="MOUSE_HOVER_TRANSLATION_DELAY_STEP"
          controls-position="right"
          @change="handleMouseHoverTranslationDelayChange"
        />
        <span class="input-suffix">ms</span>
      </el-col>
    </el-row>

    <!-- 全文翻译快捷键选择 -->
    <el-row v-if="config.on" class="settings-control-row" :class="{ 'custom-hotkey-row': config.floatingBallHotkey === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="（测试版）设置快捷键以便快速切换全文翻译状态，无需鼠标点击悬浮球">全文翻译快捷键</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.floatingBallHotkey" 
            aria-label="全文翻译快捷键"
            placeholder="选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleHotkeyChange"
          >
            <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.floatingBallHotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customFloatingBallHotkey">
              {{ getCustomHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" aria-label="编辑全文翻译快捷键" @click="openCustomHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 全文翻译范围 -->
    <el-row v-if="config.on" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="按阅读进度会预翻译视口附近内容；立即翻译到网页底部会处理当前已加载的整页内容，并持续翻译之后新增的内容。它不会自动滚动页面，但在无限滚动页面可能产生较多翻译请求和服务费用。设置会在下次启动全文翻译时生效。">全文翻译范围</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <el-select v-model="config.fullPageTranslationMode" aria-label="全文翻译范围" size="small" style="width: 100%">
          <el-option label="按阅读进度（推荐）" value="viewport" />
          <el-option label="立即翻译到网页底部" value="all" />
        </el-select>
      </el-col>
    </el-row>

    <!-- 右键全文翻译开关 -->
    <el-row v-if="config.on" class="settings-control-row">
      <el-col :span="20" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="在网页右键菜单中显示“流畅阅读翻译”或“流畅阅读取消翻译”入口；关闭后不会影响全文翻译快捷键和悬浮球">右键全文翻译</SettingsHelpLabel>
      </el-col>
      <el-col :span="4" class="settings-control-field flex-end">
        <el-switch v-model="config.contextMenuEnabled" class="settings-toggle" aria-label="右键全文翻译" />
      </el-col>
    </el-row>


    <!-- 划词翻译模式选择 -->
    <el-row v-if="config.on" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="选中文本后显示翻译入口；可选择直接弹出、图标、小点、预设快捷键或自定义快捷键。">划词翻译</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <el-select v-model="config.selectionTranslatorMode" aria-label="划词翻译模式" placeholder="选择模式" size="small" style="width: 100%">
          <el-option label="关闭" value="disabled" />
          <el-option label="双语显示" value="bilingual" />
          <el-option label="只显示译文" value="translation-only" />
        </el-select>
      </el-col>
    </el-row>
    <el-row v-if="config.on && config.selectionTranslatorMode !== 'disabled'" class="settings-control-row" :class="{ 'custom-hotkey-row': config.selectionTranslatorTrigger === 'custom' }">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="快捷键与直接弹出、显示图标和显示小点是并列的触发方式；选择快捷键后，选中文字时不会显示图标或小点。">划词触发方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end">
        <div class="hotkey-config">
          <el-select v-model="config.selectionTranslatorTrigger" aria-label="划词翻译触发方式" placeholder="选择触发方式" size="small" style="width: 100%" @change="handleSelectionTriggerChange">
            <el-option v-for="item in options.selectionTranslatorTriggers" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <div v-if="config.selectionTranslatorTrigger === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customSelectionTranslatorHotkey">
              {{ getCustomSelectionHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" aria-label="编辑划词翻译快捷键" @click="openCustomSelectionHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>
    <el-row v-if="config.on && config.selectionTranslatorMode !== 'disabled'" class="settings-control-row">
      <el-col :span="14" class="settings-control-label lightblue rounded-corner">
        <SettingsHelpLabel content="从选区稳定后开始计时，再显示图标、小点或翻译面板；快捷键在等待结束后按下会立即显示。">划词显示延迟</SettingsHelpLabel>
      </el-col>
      <el-col :span="10" class="settings-control-field flex-end translation-delay-field">
        <el-input-number
          v-model="config.selectionTranslatorDelay"
          aria-label="划词翻译显示延迟"
          :min="SELECTION_TRANSLATOR_DELAY_MIN"
          :max="SELECTION_TRANSLATOR_DELAY_MAX"
          :step="SELECTION_TRANSLATOR_DELAY_STEP"
          controls-position="right"
          @change="handleSelectionTranslatorDelayChange"
        />
        <span class="input-suffix">ms</span>
      </el-col>
    </el-row>
    </section>

    <!-- token -->
    <!-- 高级选项-->
    <section v-show="props.activeSection === 'settings-advanced'" id="settings-advanced" class="settings-section settings-list-section">
        <!-- 主题设置 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <span class="popup-text popup-vertical-left">主题设置</span>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.theme" placeholder="请选择主题模式">
              <el-option class="select-left" v-for="item in options.theme" :key="item.value" :label="item.label"
                         :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 缓存开关 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="开启缓存可以提高翻译速度，减少重复请求，但可能导致翻译结果不是最新的">缓存翻译结果</SettingsHelpLabel>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.useCache" class="settings-toggle" aria-label="缓存翻译结果" />
          </el-col>
        </el-row>

        <!-- AI 智能上下文 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label ai-context-label lightblue rounded-corner">
            <SettingsHelpLabel content="开启后，AI 翻译会参考当前网页的标题、描述和相关正文片段；仅对大模型翻译服务生效。">AI 智能上下文</SettingsHelpLabel>
            <small class="settings-control-hint">提升术语和歧义表达的语境准确度；首次请求还会额外生成摘要并增加一次调用。</small>
          </el-col>

          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.enableAIContext" :disabled="!canUseAIContext" class="settings-toggle" aria-label="AI 智能上下文" />
          </el-col>
        </el-row>

        <!-- 悬浮球开关 -->
      <el-row v-if="config.on" class="settings-control-row">
        <el-col :span="20" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="（测试版）控制是否显示屏幕边缘的即时翻译悬浮球，用于对整个网页进行翻译">全文翻译悬浮球</SettingsHelpLabel>
        </el-col>

        <el-col :span="4" class="settings-control-field flex-end">
          <el-switch v-model="floatingBallEnabled" class="settings-toggle" aria-label="全文翻译悬浮球" />
        </el-col>
      </el-row>

        <!-- 翻译进度面板 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="全文翻译时，在网页右下角显示正在翻译和等待中的任务数量；任务结束后自动隐藏。">显示翻译进度面板</SettingsHelpLabel>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch
              v-model="config.translationProgressPanelEnabled"
              class="settings-toggle"
              aria-label="显示翻译进度面板"
              @change="handleTranslationProgressPanelChange"
            />
          </el-col>
        </el-row>

        <!-- 禁用动画设置 -->
        <el-row class="settings-control-row">
          <el-col :span="20" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="动画效果（默认开）：禁用后将关闭加载/悬浮等动画，以节省GPU资源和电量。适合低配置设备或希望节省资源的用户。">动画效果</SettingsHelpLabel>
          </el-col>
          <el-col :span="4" class="settings-control-field flex-end">
            <el-switch v-model="config.animations" class="settings-toggle" aria-label="动画效果" />
          </el-col>
        </el-row>

        <!-- 输入框翻译功能 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="输入框翻译：在任何文本输入框中使用指定方式触发翻译当前输入的内容。">输入框翻译</SettingsHelpLabel>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTrigger" placeholder="请选择触发方式">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTrigger" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 输入框翻译目标语言 -->
        <el-row v-if="config.inputBoxTranslationTrigger !== 'disabled'" class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <span class="popup-text popup-vertical-left">翻译目标语言</span>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-select v-model="config.inputBoxTranslationTarget" placeholder="请选择目标语言">
              <el-option class="select-left" v-for="item in options.inputBoxTranslationTarget" :key="item.value" 
                         :label="item.label" :value="item.value" />
            </el-select>
          </el-col>
        </el-row>

        <!-- 翻译并发数 -->
        <el-row class="settings-control-row">
          <el-col :span="12" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="控制同时进行的最大翻译任务数，数值越高翻译速度越快，但可能占用更多系统资源">翻译并发数</SettingsHelpLabel>
          </el-col>
          <el-col :span="12" class="settings-control-field">
            <el-input-number
                v-model="config.maxConcurrentTranslations"
                :min="1"
                :max="100"
                :step="1"
                style="width: 100%"
                @change="handleConcurrentChange"
                controls-position="right"
            />
          </el-col>
        </el-row>

        <!-- 使用代理转发 -->
        <el-row v-show="showAdvancedProxy && !showAdvancedCustom" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="使用代理可以解决网络无法访问的问题，如不熟悉代理设置请留空！">代理地址</SettingsHelpLabel>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input v-model="config.proxy[config.service]" placeholder="默认不使用代理" />
          </el-col>
        </el-row>

        <!-- 角色和模板 -->
        <el-row v-show="showAdvancedAI && !showAdvancedCustom" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="以系统身份 system 发送的对话，常用于指定 AI 要扮演的角色">system</SettingsHelpLabel>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input type="textarea" v-model="config.system_role[config.service]" maxlength="8192"
              placeholder="system message " />
          </el-col>
        </el-row>
        <el-row v-show="showAdvancedAI && !showAdvancedCustom" class="settings-control-row">
          <el-col :span="8" class="settings-control-label lightblue rounded-corner">
            <SettingsHelpLabel content="以用户身份 user 发送的对话，其中{{to}}表示目标语言，{{origin}}表示待翻译的文本内容，两者不可缺少。">user</SettingsHelpLabel>
          </el-col>
          <el-col :span="16" class="settings-control-field">
            <el-input type="textarea" v-model="config.user_role[config.service]" maxlength="8192"
              placeholder="user message template" />
          </el-col>
        </el-row>
        <!-- 恢夏默认模板按钮 -->
        <el-row v-show="showAdvancedAI && !showAdvancedCustom" class="margin-bottom margin-left-2em">
          <el-col :span="24" style="text-align: right;">
            <el-button type="primary" link @click="resetTemplate">
              <el-icon>
                <Refresh />
              </el-icon>
              恢复默认模板
            </el-button>
          </el-col>
        </el-row>

    </section>

    <section v-show="props.activeSection === 'settings-data'" id="settings-data" class="settings-section data-section settings-data-section">
        <section class="credential-persistence-panel" aria-label="API 凭据存储">
          <div class="credential-persistence-copy">
            <strong>跨浏览器重启保存 API 凭据</strong>
            <p>默认仅保存在当前浏览器会话，关闭浏览器后清除。开启后会以明文写入扩展本地存储；本机其他可读取浏览器配置或诊断数据的程序可能看到这些凭据。</p>
          </div>
          <el-switch
            :model-value="config.persistCredentials"
            :loading="credentialPersistenceBusy"
            aria-label="跨浏览器重启保存 API 凭据"
            data-testid="persist-credentials-switch"
            @change="setCredentialPersistence"
          />
        </section>

        <section class="config-history-panel" aria-label="最近配置">
          <div class="config-history-heading">
            <div>
              <h3>最近 5 次配置</h3>
              <p>修改会自动保存，保留最近的稳定快照，可随时恢复。</p>
            </div>
            <div class="config-history-actions">
              <el-button
                size="small"
                :disabled="historyBusy || !canUndo"
                aria-label="撤销配置恢复"
                @click="runHistoryAction('undo')"
              ><el-icon><Undo2 /></el-icon>撤销</el-button>
              <el-button
                size="small"
                :disabled="historyBusy || !canRedo"
                aria-label="重做配置恢复"
                @click="runHistoryAction('redo')"
              ><el-icon><Redo2 /></el-icon>重做</el-button>
            </div>
          </div>

          <div v-if="historyEntries.length" class="config-history-list">
            <article
              v-for="entry in historyEntries"
              :key="entry.version"
              class="config-history-entry"
              :class="{ current: entry.version === currentHistoryVersion }"
            >
              <div class="config-history-version"><b>v{{ entry.version }}</b><span v-if="entry.version === currentHistoryVersion">当前</span></div>
              <div class="config-history-detail">
                <strong>{{ historySummary(entry) }}</strong>
                <small>{{ formatHistoryTime(entry.savedAt) }}</small>
              </div>
              <el-button
                size="small"
                text
                type="primary"
                :disabled="historyBusy || entry.version === currentHistoryVersion"
                :aria-label="`恢复配置 v${entry.version}`"
                @click="runHistoryAction('restore', entry.version)"
              ><el-icon><History /></el-icon>恢复</el-button>
            </article>
          </div>
          <div v-else class="config-history-empty">还没有可恢复的配置版本。</div>
        </section>

        <el-row class="config-transfer-actions">
          <el-col :span="12">
            <el-button type="primary" @click="handleExport">
              <el-icon>
                <Download />
              </el-icon>
              导出配置
            </el-button>
          </el-col>
          <el-col :span="12">
            <el-button type="success" @click="handleImport">
              <el-icon>
                <Upload />
              </el-icon>
              导入配置
            </el-button>
          </el-col>
        </el-row>
        <p class="config-transfer-note">导出会移除专用 API Key、Secret 与令牌字段；自定义请求体、代理和端点中的内嵌凭据无法自动识别，请在分享前检查。导入旧版配置时，专用凭据会迁移到当前浏览器会话。</p>

        <!-- 导出配置 -->
        <el-row v-if="showExportBox" class="margin-bottom margin-left-2em">
          <el-col :span="24">
            <el-input v-model="exportData" type="textarea" :rows="8" readonly />
          </el-col>
        </el-row>

        <!-- 导入配置 -->
        <el-row v-if="showImportBox" class="margin-bottom margin-left-2em">
          <el-col :span="24">
            <el-input v-model="importData" type="textarea" :rows="8" placeholder="请在此处粘贴您的JSON配置" />
            <div style="margin-top: 10px; text-align: right;">
              <el-button @click="saveImport"><el-icon><Save /></el-icon>保存</el-button>
            </div>
          </el-col>
        </el-row>
    </section>
    <!--    -->
  </div>

  <!-- 自定义快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="config.customFloatingBallHotkey"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />

  <!-- 自定义鼠标悬浮快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomMouseHotkeyDialog"
    :current-value="config.customHotkey"
    @confirm="handleCustomMouseHotkeyConfirm"
    @cancel="handleCustomMouseHotkeyCancel"
  />
  <CustomHotkeyInput
    v-model="showCustomSelectionHotkeyDialog"
    :current-value="config.customSelectionTranslatorHotkey"
    @confirm="handleCustomSelectionHotkeyConfirm"
    @cancel="handleCustomSelectionHotkeyCancel"
  />



</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { models, options, resolveConfiguredModel, servicesType, defaultOption } from '@/src/core/config/catalog';
import {
  Config,
  MOUSE_HOVER_TRANSLATION_DELAY_MAX,
  MOUSE_HOVER_TRANSLATION_DELAY_MIN,
  MOUSE_HOVER_TRANSLATION_DELAY_STEP,
  SELECTION_TRANSLATOR_DELAY_MAX,
  SELECTION_TRANSLATOR_DELAY_MIN,
  SELECTION_TRANSLATOR_DELAY_STEP,
  VIDEO_SUBTITLE_FONT_SIZE_OPTIONS,
  normalizeConfig,
  normalizeMouseHoverTranslationDelay,
  normalizeSelectionTranslatorDelay,
} from '@/src/core/config/model';
import {
  Download,
  History,
  Pencil as Edit,
  Redo2,
  RotateCcw as Refresh,
  Save,
  Undo2,
  Upload,
} from '@lucide/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {browser} from 'wxt/browser';
import {isBrowserTabId} from '@/src/platform/browser/ids';
import { defineAsyncComponent } from 'vue';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));
import ServiceCatalog from './services/ServiceCatalog.vue';
import ServiceConfiguration from './services/ServiceConfiguration.vue';
import {createServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration';
import SettingsHelpLabel from './SettingsHelpLabel.vue';
import {TranslationCenter} from '@/src/features/translation-center/public';
import AlwaysTranslateSites from './AlwaysTranslateSites.vue';
import { parseHotkey } from '@/src/core/hotkey';
import { isConfigImportValid, prepareConfigForImport, sanitizeConfigForExport } from '@/src/core/config/transfer';
import {ImageOcrSettings} from '@/src/features/image-translation/public';
import {
  config as runtimeConfig,
  configHistoryReady,
  configReady,
  getConfigHistorySnapshot,
  requestConfigHistoryAction,
  requestConfigSave,
  subscribeConfigHistory,
  subscribeConfig,
  type ConfigHistoryAction,
  type ConfigHistoryEntry,
  type ConfigHistoryState,
} from '@/src/services/config/store';
import {
  filterAvailableTranslationServices,
  getTranslationServiceUnavailableMessage,
} from '@/src/services/translation/capabilities';

const props = withDefaults(defineProps<{
  activeSection?: string
}>(), {
  activeSection: 'settings-general',
})

// 初始化深色模式媒体查询
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
// 更新主题函数
function updateTheme(theme: string) {
  if (theme === 'auto') {
    // 自动模式下，直接使用系统主题
    document.documentElement.classList.toggle('dark', darkModeMediaQuery.matches);
  } else {
    // 手动模式下，使用选择的主题
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}
// 配置信息
const config = ref(new Config());
const persistConfig = (value: unknown) => requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));
let lastSerialized = '';
let hydrated = false;
let applyingExternalConfig = false;
let pageExitSaveStarted = false;
const unsubscribeConfig = subscribeConfig((nextConfig) => {
  const serialized = JSON.stringify(nextConfig);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, nextConfig);
  } finally {
    applyingExternalConfig = false;
  }
});
void configReady
  .then(() => {
    Object.assign(config.value, runtimeConfig);
    lastSerialized = JSON.stringify(config.value);
    hydrated = true;
    updateTheme(config.value.theme || 'auto');
  })
  .catch((error) => console.warn('[FluentRead] 无法读取本地配置', error));

watch(() => JSON.stringify(config.value), (serialized) => {
  if (!hydrated || applyingExternalConfig) return;
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const snapshot = normalizeConfig(config.value);
  void persistConfig(snapshot).catch((error) => {
    // 失败时释放去重标记，下一次修改或 pagehide 仍能提交最新快照。
    if (lastSerialized === serialized) lastSerialized = '';
    console.warn('[FluentRead] 保存设置失败', error);
  });
}, { flush: 'sync' });

// 设置页关闭前提交最新快照，避免 Firefox 销毁页面时丢失最后一次修改。
// pagehide 和 unmounted 可能连续触发，只提交一次，避免重复写入和重复历史。
function persistOnPageExit() {
  if (!hydrated || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void persistConfig(config.value).catch((error) => console.warn('[FluentRead] 设置页关闭前后台保存失败', error));
}

onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
});

function saveOnPageHide() {
  persistOnPageExit();
}
window.addEventListener('pagehide', saveOnPageHide);

// 设置页左侧列表只切换正在编辑的服务，不改变网页翻译实际使用的默认服务。
const configurationService = ref<string | null>(null);
const selectedConfigurationService = computed(
  () => configurationService.value ?? config.value.service,
);

const setConfigurationService = (value: string) => {
  configurationService.value = value;
};

const actualService = computed(() => config.value.service);
const aiContextModel = computed(() => resolveConfiguredModel(
  config.value.model[config.value.service],
  config.value.customModel[config.value.service],
));
const canUseAIContext = computed(() => servicesType.isUseAIContext(config.value.service, aiContextModel.value));
const availableServiceOptions = computed(() => filterAvailableTranslationServices(options.services));
const videoServiceOptions = computed(() => availableServiceOptions.value.filter((item: any) => !item.disabled));
const selectedTextServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.value.service));
const selectedVideoServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.value.videoService));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const filteredServices = computed(() =>
  availableServiceOptions.value.filter((item: any) =>
    !([item.google].includes(item.value) && config.value.display !== 1),
  ),
);
const configurationModelOptions = computed(
  () => models.get(selectedConfigurationService.value) || [],
);
const configurationServiceOption = computed(() => options.services.find(
  (item) => !item.disabled && item.value === selectedConfigurationService.value,
));
const configurationServiceUnavailableMessage = computed(
  () => getTranslationServiceUnavailableMessage(selectedConfigurationService.value),
);
const configurationPresentation = computed(() => createServiceConfigurationPresentation(
  selectedConfigurationService.value,
  {
    selectedModel: config.value.model[selectedConfigurationService.value],
    deepseekApiType: config.value.deepseekApiType,
    available: Boolean(configurationServiceOption.value)
      && !configurationServiceUnavailableMessage.value,
    unavailableMessage: configurationServiceUnavailableMessage.value || undefined,
  },
));

// 高级设置只跟随实际默认服务；服务目录的展示状态由上面的 presentation 独立管理。
const showAdvancedAI = computed(() => servicesType.isAI(actualService.value));
const showAdvancedProxy = computed(() => servicesType.isUseProxy(actualService.value));
const showAdvancedCustom = computed(() => servicesType.isCustom(actualService.value));

// 监听主题变化
watch(() => config.value.theme, (newTheme) => {
  updateTheme(newTheme || 'auto');
});

// 使用 onchange 监听系统主题变化
darkModeMediaQuery.onchange = () => {
  if (config.value.theme === 'auto') {
    updateTheme('auto');
  }
};

// 组件卸载时清理
onUnmounted(() => {
  darkModeMediaQuery.onchange = null;
  unsubscribeConfig();
  unsubscribeHistory();
});

// 计算样式分组
const styleGroups = computed(() => {
  const groups = options.styles.filter(item => item.disabled);
  return groups.map(group => ({
    ...group,
    options: options.styles.filter(item => !item.disabled && item.group === group.value)
  }));
});

const currentStyleClass = computed(() =>
  options.styles.find(item => item.value === config.value.style && !item.disabled)?.class || 'fluent-display-default'
);

// 恢复默认模板
const resetTemplate = () => {
  ElMessageBox.confirm(
    '确定要恢复默认的 system 和 user 模板吗？此操作将覆盖当前的自定义模板。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    config.value.system_role[config.value.service] = defaultOption.system_role;
    config.value.user_role[config.value.service] = defaultOption.user_role;
    ElMessage({
      message: '已成功恢复默认翻译模板',
      type: 'success',
      duration: 2000
    });
  }).catch(() => {
    // 用户取消操作，不做任何处理
  });
};

// 悬浮球开关的计算属性
const floatingBallEnabled = computed({
  get: () => !config.value.disableFloatingBall && config.value.on,
  set: (value) => {
    config.value.disableFloatingBall = !value;
    // 向所有激活的标签页发送消息
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (isBrowserTabId(tab.id)) {
          browser.tabs.sendMessage(tab.id, { 
            type: 'toggleFloatingBall',
            isEnabled: value 
          }).catch(() => {
            // 忽略发送失败的错误（可能是页面未加载内容脚本）
          });
        }
      });
    });
  }
});

const handleTranslationProgressPanelChange = (isEnabled: boolean) => {
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!isBrowserTabId(tab.id)) return;
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleTranslationProgressPanel',
        isEnabled,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
    });
  }).catch(() => {
    // 忽略无法查询标签页的错误，配置仍会通过统一存储链路保存
  });
};

// 监听划词翻译模式变化
watch(() => config.value.selectionTranslatorMode, (newMode) => {
  config.value.disableSelectionTranslator = newMode === 'disabled';
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (isBrowserTabId(tab.id)) {
        browser.tabs.sendMessage(tab.id, { 
          type: 'updateSelectionTranslatorMode',
          mode: newMode 
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
});

// 处理插件状态变化
const handlePluginStateChange = (val: boolean) => {
  // 总开关只控制当前运行状态，不覆盖用户对悬浮球和划词翻译的偏好。
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (!isBrowserTabId(tab.id)) return;
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleFloatingBall',
        isEnabled: val && !config.value.disableFloatingBall,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
      browser.tabs.sendMessage(tab.id, {
        type: 'updateSelectionTranslatorMode',
        mode: val ? config.value.selectionTranslatorMode : 'disabled',
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
      browser.tabs.sendMessage(tab.id, {
        type: 'toggleSelectionAreaTranslator',
        isEnabled: val && config.value.selectionAreaEnabled,
      }).catch(() => {
        // 忽略发送失败的错误（可能是页面未加载内容脚本）
      });
    });
  });
};

// 自定义快捷键相关
const showCustomHotkeyDialog = ref(false);
const showCustomMouseHotkeyDialog = ref(false);
const showCustomSelectionHotkeyDialog = ref(false);

// 处理快捷键选择变化
const handleHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customFloatingBallHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义快捷键对话框
const openCustomHotkeyDialog = () => {
  showCustomHotkeyDialog.value = true;
};

// 确认自定义快捷键
const handleCustomHotkeyConfirm = (hotkey: string) => {
  config.value.customFloatingBallHotkey = hotkey;
  config.value.floatingBallHotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义快捷键
const handleCustomHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customFloatingBallHotkey) {
    config.value.floatingBallHotkey = 'Alt+T';
  }
};

// 获取自定义快捷键显示名称
const getCustomHotkeyDisplayName = () => {
  if (!config.value.customFloatingBallHotkey) return '';
  
  if (config.value.customFloatingBallHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customFloatingBallHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customFloatingBallHotkey;
};

// 处理鼠标悬浮快捷键选择变化
const handleMouseHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomMouseHotkeyDialog();
      }, 100);
    }
  }
};

// 处理划词翻译触发方式选择变化
const handleSelectionTriggerChange = (value: string) => {
  config.value.selectionTranslatorHotkey = ['Control', 'Alt', 'Shift', 'custom'].includes(value) ? value : 'none';
  if (value === 'custom' && !config.value.customSelectionTranslatorHotkey) {
    setTimeout(() => {
      openCustomSelectionHotkeyDialog();
    }, 100);
  }
};

// 打开自定义划词翻译快捷键对话框
const openCustomSelectionHotkeyDialog = () => {
  showCustomSelectionHotkeyDialog.value = true;
};

// 确认自定义划词翻译快捷键
const handleCustomSelectionHotkeyConfirm = (hotkey: string) => {
  config.value.customSelectionTranslatorHotkey = hotkey;
  config.value.selectionTranslatorTrigger = 'custom';
  config.value.selectionTranslatorHotkey = 'custom';

  ElMessage({
    message: hotkey === 'none' ? '已禁用划词翻译快捷键' : `划词翻译快捷键已设置为: ${getCustomSelectionHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000,
  });
};

// 取消自定义划词翻译快捷键
const handleCustomSelectionHotkeyCancel = () => {
  if (!config.value.customSelectionTranslatorHotkey) {
    config.value.selectionTranslatorTrigger = 'icon';
    config.value.selectionTranslatorHotkey = 'none';
  }
};

// 获取自定义划词翻译快捷键显示名称
const getCustomSelectionHotkeyDisplayName = () => {
  if (!config.value.customSelectionTranslatorHotkey) return '';
  if (config.value.customSelectionTranslatorHotkey === 'none') return '已禁用';

  const parsed = parseHotkey(config.value.customSelectionTranslatorHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customSelectionTranslatorHotkey;
};

// 打开自定义鼠标悬浮快捷键对话框
const openCustomMouseHotkeyDialog = () => {
  showCustomMouseHotkeyDialog.value = true;
};

// 确认自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyConfirm = (hotkey: string) => {
  config.value.customHotkey = hotkey;
  config.value.hotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomMouseHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customHotkey) {
    config.value.hotkey = 'Control';
  }
};

const handleMouseHoverTranslationDelayChange = (value: number | undefined) => {
  config.value.mouseHoverTranslationDelay = normalizeMouseHoverTranslationDelay(value);
};

const handleSelectionTranslatorDelayChange = (value: number | undefined) => {
  config.value.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(value);
};

// 获取自定义鼠标悬浮快捷键显示名称
const getCustomMouseHotkeyDisplayName = () => {
  if (!config.value.customHotkey) return '';
  
  if (config.value.customHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customHotkey;
};

// 处理并发数量变化
const handleConcurrentChange = (currentValue: number | undefined) => {
  // 验证并发数量的有效性
  if (currentValue === undefined || currentValue < 1 || currentValue > 100) {
    ElMessage({
      message: '并发数量必须在 1-100 之间',
      type: 'warning',
      duration: 2000
    });
    // 恢复默认值
    config.value.maxConcurrentTranslations = 6;
    return;
  }
  
  ElMessage({
    message: `并发数量已更新为 ${currentValue}`,
    type: 'success',
    duration: 2000
  });
};

const showExportBox = ref(false);
const exportData = ref('');
const showImportBox = ref(false);
const importData = ref('');
const credentialPersistenceBusy = ref(false);

const setCredentialPersistence = async (value: string | number | boolean) => {
  const enabled = value === true;
  if (enabled === config.value.persistCredentials || credentialPersistenceBusy.value) return;

  if (enabled) {
    try {
      await ElMessageBox.confirm(
        '开启后，API Key、访问令牌及其他服务凭据会以明文写入扩展本地存储，并在浏览器重启后继续保留。仅应在受信任的个人设备上开启。',
        '保存 API 凭据',
        {
          confirmButtonText: '了解风险并开启',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }

  credentialPersistenceBusy.value = true;
  try {
    const nextConfig = normalizeConfig({...config.value, persistCredentials: enabled});
    // 后台只有在 session 写入并读回成功后，才会清理关闭开关前的 local 凭据。
    await persistConfig(nextConfig);
    applyingExternalConfig = true;
    try {
      Object.assign(config.value, nextConfig);
      lastSerialized = JSON.stringify(nextConfig);
    } finally {
      applyingExternalConfig = false;
    }
    ElMessage.success(enabled ? '已允许跨浏览器重启保存 API 凭据' : 'API 凭据现仅保存在当前浏览器会话');
  } catch (error) {
    ElMessage.error(`凭据存储设置失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    credentialPersistenceBusy.value = false;
  }
};

const configHistory = ref<ConfigHistoryState>(getConfigHistorySnapshot());
const historyBusy = ref(false);
const historyEntries = computed(() => [...configHistory.value.entries].reverse());
const currentHistoryVersion = computed(() => configHistory.value.entries[configHistory.value.cursor]?.version ?? null);
const canUndo = computed(() => configHistory.value.cursor > 0);
const canRedo = computed(() => configHistory.value.cursor >= 0 && configHistory.value.cursor < configHistory.value.entries.length - 1);

const formatHistoryTime = (savedAt: string): string => {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const historySummary = (entry: ConfigHistoryEntry): string => {
  const target = options.to.find((item: any) => item.value === entry.config.to)?.label || entry.config.to;
  const service = options.services.find((item: any) => item.value === entry.config.service)?.label || entry.config.service;
  const siteCount = entry.config.alwaysTranslateDomains?.length ?? 0;
  const disabledSiteCount = entry.config.disabledExtensionDomains?.length ?? 0;
  return `${target} · ${service} · 始终翻译 ${siteCount} 个网站 · 禁用扩展 ${disabledSiteCount} 个网站`;
};

void configHistoryReady.then(() => {
  configHistory.value = getConfigHistorySnapshot();
});
const unsubscribeHistory = subscribeConfigHistory((nextHistory) => {
  configHistory.value = nextHistory;
});

const runHistoryAction = async (action: ConfigHistoryAction, version?: number) => {
  if (historyBusy.value) return;
  historyBusy.value = true;
  try {
    const nextHistory = await requestConfigHistoryAction(
      action,
      version,
      browser.runtime.sendMessage.bind(browser.runtime),
    );
    configHistory.value = nextHistory;
    ElMessage({
      message: action === 'restore' ? `已恢复配置 v${version}` : action === 'undo' ? '已撤销配置恢复' : '已重做配置恢复',
      type: 'success',
      duration: 1600,
    });
  } catch (error) {
    ElMessage({
      message: `配置历史操作失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      type: 'error',
    });
  } finally {
    historyBusy.value = false;
  }
};

// Azure OpenAI 端点地址验证函数
const isValidAzureEndpoint = (endpoint: string) => {
  if (!endpoint || endpoint.trim() === '') {
    return false;
  }

  // 检查是否包含必要的组件
  const hasAzureDomain = endpoint.includes('openai.azure.com');
  const hasChatCompletions = endpoint.includes('/chat/completions');
  const hasHttps = endpoint.startsWith('https://');

  return hasHttps && hasAzureDomain && hasChatCompletions;
};

const handleExport = async () => {
  try {
    await configReady;
    exportData.value = JSON.stringify(
      sanitizeConfigForExport(runtimeConfig),
      null,
      2,
    );
    showExportBox.value = !showExportBox.value;
    showImportBox.value = false;
  } catch (error) {
    ElMessage({
      message: `导出配置失败：${error instanceof Error ? error.message : '配置格式错误'}`,
      type: 'error',
    });
  }
};

const handleImport = () => {
  showImportBox.value = !showImportBox.value;
  showExportBox.value = false;
};

const saveImport = async () => {
  try {
    const parsedConfig = JSON.parse(importData.value);
    if (!isConfigImportValid(parsedConfig)) {
      ElMessage({
        message: '配置无效或格式不正确, 请检查!',
        type: 'error',
      });
      return;
    }
    await persistConfig(prepareConfigForImport(parsedConfig, runtimeConfig));
    ElMessage({
      message: '配置导入成功!',
      type: 'success',
    });
    showImportBox.value = false;
    importData.value = '';
    // Optionally, reload the extension or relevant parts
  } catch (e) {
    ElMessage({
      message: '配置格式错误, 请检查!',
      type: 'error',
    });
  }
};

</script>

<style scoped src="./settings-sections.css"></style>
