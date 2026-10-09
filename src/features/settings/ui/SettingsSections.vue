<template>
  <section v-show="props.activeSection === 'settings-general'" id="settings-general" class="settings-section">
    <SettingsGroup title="翻译">
      <SettingsRow label="翻译模式">
        <el-select v-model="config.display" aria-label="翻译模式" placeholder="请选择翻译模式">
          <el-option v-for="item in options.display" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </SettingsRow>
      <SettingsRow label="默认目标语言">
        <el-select v-model="config.to" aria-label="默认目标语言" placeholder="请选择目标语言">
          <el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </SettingsRow>
      <SettingsRow label="翻译服务" description="用于网页、划词和悬停翻译">
        <el-select v-model="config.service" aria-label="文本翻译服务" placeholder="请选择文本翻译服务">
          <el-option v-if="selectedTextServiceUnavailableMessage" :label="`${selectedTextServiceLabel}（当前浏览器不可用）`" :value="config.service" disabled />
          <el-option v-for="item in availableServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <p v-if="selectedTextServiceUnavailableMessage" class="capability-warning">{{ selectedTextServiceUnavailableMessage }}</p>
      </SettingsRow>
      <SettingsRow label="视频翻译服务">
        <el-select v-model="config.videoService" aria-label="视频翻译服务" placeholder="请选择视频翻译服务">
          <el-option v-if="selectedVideoServiceUnavailableMessage" :label="`${selectedVideoServiceLabel}（当前浏览器不可用）`" :value="config.videoService" disabled />
          <el-option v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <p v-if="selectedVideoServiceUnavailableMessage" class="capability-warning">{{ selectedVideoServiceUnavailableMessage }}</p>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title="外观">
      <SettingsRow label="界面主题">
        <el-select v-model="config.theme" aria-label="界面主题" placeholder="请选择主题模式">
          <el-option v-for="item in options.theme" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </SettingsRow>
      <template v-if="config.display === 1">
        <SettingsRow label="译文样式">
          <el-select v-model="config.style" aria-label="译文样式" placeholder="请选择译文显示样式">
            <el-option-group v-for="group in styleGroups" :key="group.value" :label="group.label">
              <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value" :class="item.class" />
            </el-option-group>
          </el-select>
        </SettingsRow>
        <div class="style-preview" aria-live="polite">
          <p class="style-preview-source">The quick brown fox jumps over the lazy dog.</p>
          <p :key="config.style" class="style-preview-text" :class="currentStyleClass">敏捷的棕色狐狸跳过了那只懒狗。</p>
        </div>
      </template>
    </SettingsGroup>
  </section>

  <section v-show="props.activeSection === 'settings-sites'" id="settings-sites" class="settings-section site-settings-section">
    <SettingsGroup>
      <SettingsRow label="自动翻译所有网站" data-setting="global-auto-translate">
        <el-switch v-model="config.autoTranslate" aria-label="自动翻译所有网站" />
      </SettingsRow>
    </SettingsGroup>
    <AlwaysTranslateSites v-model="config.alwaysTranslateDomains" />
    <AlwaysTranslateSites v-model="config.disabledExtensionDomains" variant="disable-extension" />
    <TranslationFilterSettings v-model="config.translationFilter" />
  </section>

  <section v-show="props.activeSection === 'settings-translation-center'" id="settings-translation-center" class="settings-section translation-center-section">
    <TranslationCenter />
  </section>

  <div class="settings-main-sections">
    <section v-show="props.activeSection === 'settings-services'" id="settings-services" class="settings-section">
      <div v-if="selectedTextServiceUnavailableMessage" class="settings-inline-alert" role="status">
        <strong>默认翻译服务不可用</strong>
        <span>{{ selectedTextServiceUnavailableMessage }}请到“通用设置”中更换。</span>
      </div>
      <ServiceCatalog
        :service="selectedConfigurationService"
        :default-service="config.service"
        :services="serviceInventoryOptions"
        :presentation="configurationPresentation"
        @update:service="setConfigurationService"
        @update:enabled="setTranslationServiceEnabled"
        @remove="removeTranslationService"
        @add="showAddTranslationServiceDialog = true"
      >
        <template #configuration>
          <ServiceConfiguration
            :config="config"
            :service="selectedConfigurationProvider"
            :instance="selectedConfigurationInstance"
            :presentation="configurationPresentation"
            :options="options"
            :is-valid-azure-endpoint="isValidAzureEndpoint"
          />
        </template>
      </ServiceCatalog>
    </section>

    <ImageOcrSettings v-show="props.activeSection === 'settings-image-translation'" />

    <section v-show="props.activeSection === 'settings-video'" id="settings-video" class="settings-section">
      <SettingsGroup title="字幕翻译" description="只翻译播放器自带的字幕，不上传音视频。">
        <SettingsRow label="字幕翻译" description="目前支持 YouTube">
          <el-switch v-model="config.videoTranslationEnabled" aria-label="视频字幕翻译" />
        </SettingsRow>
        <SettingsRow label="翻译服务" description="使用 AI 服务时会提前翻译后续字幕">
          <el-select v-model="config.videoService" aria-label="视频字幕翻译服务" :disabled="!config.videoTranslationEnabled" placeholder="请选择服务">
            <el-option v-if="selectedVideoServiceUnavailableMessage" :label="`${selectedVideoServiceLabel}（当前浏览器不可用）`" :value="config.videoService" disabled />
            <el-option v-for="item in videoServiceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <p v-if="selectedVideoServiceUnavailableMessage" class="capability-warning">{{ selectedVideoServiceUnavailableMessage }}</p>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="显示">
        <SettingsRow label="显示译文字幕">
          <el-switch v-model="config.videoSubtitleVisible" aria-label="显示译文字幕" :disabled="!config.videoTranslationEnabled" />
        </SettingsRow>
        <SettingsRow label="显示内容">
          <el-select v-model="config.videoSubtitleDisplayMode" aria-label="视频字幕显示模式" :disabled="!config.videoTranslationEnabled || !config.videoSubtitleVisible">
            <el-option label="双语显示" value="bilingual" />
            <el-option label="只显示译文" value="translation-only" />
            <el-option label="只显示原文" value="original-only" />
          </el-select>
        </SettingsRow>
        <SettingsRow label="字号">
          <el-select v-model="config.videoSubtitleFontSize" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled" placeholder="请选择字号">
            <el-option v-for="size in videoSubtitleFontSizeOptions" :key="size" :label="size === 100 ? '默认' : `${size}%`" :value="size" />
          </el-select>
        </SettingsRow>
      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-shortcuts'" id="settings-shortcuts" class="settings-section">
      <SettingsGroup title="悬停翻译">
        <SettingsRow label="快捷键" description="按住后将鼠标移到文字上即可翻译">
          <div class="hotkey-config">
            <el-select v-model="config.hotkey" aria-label="悬停翻译快捷键" placeholder="请选择快捷键" @change="handleMouseHotkeyChange">
              <el-option v-for="item in options.keys" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
            </el-select>
            <button v-if="config.hotkey === 'custom'" class="hotkey-chip" type="button" aria-label="编辑悬停翻译快捷键" @click="openCustomMouseHotkeyDialog">
              <kbd v-if="config.customHotkey">{{ getCustomMouseHotkeyDisplayName() }}</kbd>
              <span v-else>点击录制快捷键</span>
              <Edit aria-hidden="true" />
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="翻译延迟" description="适当延迟可避免按 Ctrl+C 等组合键时误触发">
          <div class="number-field">
            <el-input-number
              v-model="config.mouseHoverTranslationDelay"
              aria-label="悬停翻译延迟"
              :min="MOUSE_HOVER_TRANSLATION_DELAY_MIN"
              :max="MOUSE_HOVER_TRANSLATION_DELAY_MAX"
              :step="MOUSE_HOVER_TRANSLATION_DELAY_STEP"
              controls-position="right"
              @change="handleMouseHoverTranslationDelayChange"
            />
            <span class="input-suffix">ms</span>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="全文翻译">
        <SettingsRow label="快捷键">
          <div class="hotkey-config">
            <el-select v-model="config.floatingBallHotkey" aria-label="全文翻译快捷键" placeholder="选择快捷键" @change="handleHotkeyChange">
              <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <button v-if="config.floatingBallHotkey === 'custom'" class="hotkey-chip" type="button" aria-label="编辑全文翻译快捷键" @click="openCustomHotkeyDialog">
              <kbd v-if="config.customFloatingBallHotkey">{{ getCustomHotkeyDisplayName() }}</kbd>
              <span v-else>点击录制快捷键</span>
              <Edit aria-hidden="true" />
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="翻译范围" description="翻译整页时，新加载的内容也会翻译，无限滚动的页面请求较多。下次翻译时生效。">
          <el-select v-model="config.fullPageTranslationMode" aria-label="全文翻译范围">
            <el-option label="随滚动翻译（推荐）" value="viewport" />
            <el-option label="一次翻译整页" value="all" />
          </el-select>
        </SettingsRow>
        <SettingsRow label="添加到右键菜单">
          <el-switch v-model="config.contextMenuEnabled" aria-label="添加到右键菜单" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="划词翻译">
        <SettingsRow label="显示方式">
          <el-select v-model="config.selectionTranslatorMode" aria-label="划词翻译模式" placeholder="选择模式">
            <el-option label="关闭" value="disabled" />
            <el-option label="双语显示" value="bilingual" />
            <el-option label="只显示译文" value="translation-only" />
          </el-select>
        </SettingsRow>
        <template v-if="config.selectionTranslatorMode !== 'disabled'">
          <SettingsRow label="触发方式" description="使用快捷键时，选中文字后不再显示图标">
            <div class="hotkey-config">
              <el-select v-model="config.selectionTranslatorTrigger" aria-label="划词翻译触发方式" placeholder="选择触发方式" @change="handleSelectionTriggerChange">
                <el-option v-for="item in options.selectionTranslatorTriggers" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
              <button v-if="config.selectionTranslatorTrigger === 'custom'" class="hotkey-chip" type="button" aria-label="编辑划词翻译快捷键" @click="openCustomSelectionHotkeyDialog">
                <kbd v-if="config.customSelectionTranslatorHotkey">{{ getCustomSelectionHotkeyDisplayName() }}</kbd>
                <span v-else>点击录制快捷键</span>
                <Edit aria-hidden="true" />
              </button>
            </div>
          </SettingsRow>
          <SettingsRow label="显示延迟">
            <div class="number-field">
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
            </div>
          </SettingsRow>
        </template>
      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-advanced'" id="settings-advanced" class="settings-section">
      <SettingsGroup title="页面界面">
        <SettingsRow label="悬浮球" description="显示在屏幕边缘，点击即可翻译整页">
          <el-switch v-model="floatingBallEnabled" aria-label="悬浮球" />
        </SettingsRow>
        <SettingsRow label="翻译进度面板" description="翻译整页时显示在右下角，完成后自动隐藏">
          <el-switch v-model="config.translationProgressPanelEnabled" aria-label="翻译进度面板" @change="handleTranslationProgressPanelChange" />
        </SettingsRow>
        <SettingsRow label="动画效果">
          <el-select v-model="config.animationMode" aria-label="动画效果" placeholder="请选择动画效果">
            <el-option v-for="item in options.animationModes" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="翻译行为">
        <SettingsRow label="缓存翻译结果" description="相同内容不再重复请求">
          <el-switch v-model="config.useCache" aria-label="缓存翻译结果" />
        </SettingsRow>
        <SettingsRow label="AI 上下文" description="参考网页标题和正文，让术语翻译更准确，首次翻译会多一次请求。仅支持 AI 服务。">
          <el-switch v-model="config.enableAIContext" :disabled="!canUseAIContext" aria-label="AI 上下文" />
        </SettingsRow>
        <SettingsRow label="最大并发数">
          <el-input-number v-model="config.maxConcurrentTranslations" aria-label="最大并发数" :min="1" :step="1" controls-position="right" @change="handleConcurrentChange" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="输入框翻译">
        <SettingsRow label="触发方式">
          <el-select v-model="config.inputBoxTranslationTrigger" aria-label="输入框翻译触发方式" placeholder="请选择触发方式">
            <el-option v-for="item in options.inputBoxTranslationTrigger" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </SettingsRow>
        <SettingsRow v-if="config.inputBoxTranslationTrigger !== 'disabled'" label="目标语言">
          <el-select v-model="config.inputBoxTranslationTarget" aria-label="输入框翻译目标语言" placeholder="请选择目标语言">
            <el-option v-for="item in options.inputBoxTranslationTarget" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup v-if="(showAdvancedProxy || showAdvancedAI) && !showAdvancedCustom" title="请求设置" :description="`仅对 ${selectedTextServiceLabel} 生效`">
        <template v-if="showAdvancedAI" #actions>
          <el-button text @click="resetTemplate"><Refresh class="button-icon" aria-hidden="true" />恢复默认模板</el-button>
        </template>
        <SettingsRow v-if="showAdvancedProxy" label="代理地址" description="无法直接访问服务时填写，否则留空">
          <el-input v-model="advancedProxy" aria-label="代理地址" placeholder="不使用代理" />
        </SettingsRow>
        <template v-if="showAdvancedAI">
          <SettingsRow label="System 提示词" stacked>
            <el-input v-model="advancedSystemRole" type="textarea" aria-label="System 提示词" :autosize="{ minRows: 3, maxRows: 10 }" maxlength="8192" placeholder="system message" />
          </SettingsRow>
          <SettingsRow label="User 模板" stacked>
            <template #description><code v-pre>{{to}}</code> 为目标语言，<code v-pre>{{origin}}</code> 为原文，两者都必须保留。</template>
            <el-input v-model="advancedUserRole" type="textarea" aria-label="User 模板" :autosize="{ minRows: 3, maxRows: 10 }" maxlength="8192" placeholder="user message template" />
          </SettingsRow>
        </template>
      </SettingsGroup>
    </section>

    <section v-show="props.activeSection === 'settings-data'" id="settings-data" class="settings-section">
      <SettingsGroup title="API 凭据存储">
        <div class="radio-list" role="radiogroup" aria-label="API 凭据存储方式" :aria-busy="credentialStorageBusy">
          <button
            type="button"
            role="radio"
            class="radio-row"
            :aria-checked="credentialStorageMode === 'device'"
            :disabled="credentialStorageBusy"
            data-testid="credential-storage-device"
            @click="setCredentialStorage('device')"
          >
            <i class="radio-mark" aria-hidden="true" />
            <span class="radio-copy">
              <strong>保存在此设备<em>推荐</em></strong>
              <small>加密保存，重启浏览器或更新扩展后仍可使用</small>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            class="radio-row"
            :aria-checked="credentialStorageMode === 'session'"
            :disabled="credentialStorageBusy"
            data-testid="credential-storage-session"
            @click="setCredentialStorage('session')"
          >
            <i class="radio-mark" aria-hidden="true" />
            <span class="radio-copy">
              <strong>仅本次会话</strong>
              <small>关闭浏览器或重载、更新扩展后需要重新填写</small>
            </span>
          </button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="配置历史" description="保留最近 10 次修改">
        <template #actions>
          <el-button text :disabled="historyBusy || !canUndo" aria-label="撤销配置恢复" @click="runHistoryAction('undo')"><Undo2 class="button-icon" aria-hidden="true" />撤销</el-button>
          <el-button text :disabled="historyBusy || !canRedo" aria-label="重做配置恢复" @click="runHistoryAction('redo')"><Redo2 class="button-icon" aria-hidden="true" />重做</el-button>
        </template>
        <div v-if="historyEntries.length" class="version-list">
          <article
            v-for="entry in historyEntries"
            :key="entry.version"
            class="version-row"
            :class="{ current: entry.version === currentHistoryVersion }"
            :aria-current="entry.version === currentHistoryVersion ? 'true' : undefined"
          >
            <code class="version-tag">v{{ entry.version }}</code>
            <span class="version-detail">
              <strong>{{ historySummary(entry) }}</strong>
              <time :datetime="entry.savedAt">{{ formatHistoryTime(entry.savedAt) }}</time>
            </span>
            <span v-if="entry.version === currentHistoryVersion" class="version-current">当前</span>
            <el-button
              v-else
              text
              :disabled="historyBusy"
              :aria-label="`恢复配置 v${entry.version}`"
              @click="runHistoryAction('restore', entry.version)"
            >恢复</el-button>
          </article>
        </div>
        <p v-else class="settings-empty">暂无记录</p>
      </SettingsGroup>

      <SettingsGroup title="定时备份" description="每 6 小时备份一次，保留最近 10 份">
        <div v-if="backupEntries.length" class="version-list">
          <article v-for="entry in backupEntries" :key="entry.version" class="version-row">
            <code class="version-tag">b{{ entry.version }}</code>
            <span class="version-detail">
              <strong>{{ backupSummary(entry) }}</strong>
              <time :datetime="entry.savedAt">{{ formatHistoryTime(entry.savedAt) }}</time>
            </span>
            <el-button
              text
              :disabled="backupBusy"
              :aria-label="`恢复定时备份 b${entry.version}`"
              @click="restoreBackup(entry.version)"
            >恢复</el-button>
          </article>
        </div>
        <p v-else class="settings-empty">暂无备份</p>
      </SettingsGroup>

      <SettingsGroup title="导入与导出" description="导出时会去掉 API Key、Secret 等凭据，但自定义请求体、代理和接口地址里的凭据无法识别，分享前请自行检查。">
        <template #actions>
          <el-button @click="handleExport"><Download class="button-icon" aria-hidden="true" />导出配置</el-button>
          <el-button @click="handleImport"><Upload class="button-icon" aria-hidden="true" />导入配置</el-button>
        </template>
        <div v-if="showExportBox" class="transfer-box">
          <el-input v-model="exportData" type="textarea" aria-label="导出的配置" :rows="10" readonly />
        </div>
        <div v-if="showImportBox" class="transfer-box">
          <el-input v-model="importData" type="textarea" aria-label="要导入的配置" :rows="10" placeholder="粘贴 JSON 配置" />
          <div class="transfer-actions">
            <el-button type="primary" @click="saveImport"><Save class="button-icon" aria-hidden="true" />保存</el-button>
          </div>
        </div>
      </SettingsGroup>
    </section>
  </div>

  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="config.customFloatingBallHotkey"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />
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
  <AddTranslationServiceDialog
    v-model="showAddTranslationServiceDialog"
    :existing-services="config.translationServices"
    @add="addTranslationService"
  />
</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { options, servicesType, defaultOption } from '@/src/core/config/catalog';
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
import AddTranslationServiceDialog from './services/AddTranslationServiceDialog.vue';
import {createServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration';
import type {AddTranslationServicePayload} from '@/src/features/settings/model/addTranslationService';
import SettingsGroup from './SettingsGroup.vue';
import SettingsRow from './SettingsRow.vue';
import {TranslationCenter} from '@/src/features/translation-center/public';
import AlwaysTranslateSites from './AlwaysTranslateSites.vue';
import TranslationFilterSettings from './TranslationFilterSettings.vue';
import { parseHotkey } from '@/src/core/hotkey';
import { isConfigImportValid, prepareConfigForImport, sanitizeConfigForExport } from '@/src/core/config/transfer';
import {clearTranslationServiceCredentials} from '@/src/core/config/credentials';
import {ImageOcrSettings} from '@/src/features/image-translation/public';
import {
  config as runtimeConfig,
  configHistoryReady,
  configReady,
  getCredentialStorageMode,
  getConfigHistorySnapshot,
  requestCredentialStorageModeChange,
  requestConfigHistoryAction,
  requestConfigSave,
  subscribeCredentialStorageMode,
  subscribeConfigHistory,
  subscribeConfig,
  type ConfigHistoryAction,
  type ConfigHistoryEntry,
  type ConfigHistoryState,
} from '@/src/services/config/store';
import type {CredentialStorageMode} from '@/src/core/config/credentialStorage';
import {
  configAutoBackupsReady,
  getConfigAutoBackupsSnapshot,
  requestConfigAutoBackupRestore,
  subscribeConfigAutoBackups,
} from '@/src/services/config/autoBackupStore';
import type {ConfigAutoBackupEntry, ConfigAutoBackupState} from '@/src/services/config/autoBackup';
import {
  getSelectableTranslationServices,
  getTranslationServiceUnavailableMessage,
} from '@/src/services/translation/capabilities';
import {
  clearTranslationServiceConfiguration,
  getTranslationServiceInstance,
  getTranslationServiceLabel,
  getTranslationServiceModel,
  getTranslationServiceOptions,
  getTranslationServiceProvider,
  reconcileTranslationServiceReferences,
} from '@/src/core/config/translationServices';

const props = withDefaults(defineProps<{
  activeSection?: string
}>(), {
  activeSection: 'settings-general',
})

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
  })
  .catch((error) => console.warn('[BabelBox] 无法读取本地配置', error));

watch(() => JSON.stringify(config.value), (serialized) => {
  if (!hydrated || applyingExternalConfig) return;
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  const snapshot = normalizeConfig(config.value);
  void persistConfig(snapshot).catch((error) => {
    // 失败时释放去重标记，下一次修改或 pagehide 仍能提交最新快照。
    if (lastSerialized === serialized) lastSerialized = '';
    console.warn('[BabelBox] 保存设置失败', error);
  });
}, { flush: 'sync' });

// 设置页关闭前提交最新快照，避免 Firefox 销毁页面时丢失最后一次修改。
// pagehide 和 unmounted 可能连续触发，只提交一次，避免重复写入和重复历史。
function persistOnPageExit() {
  if (!hydrated || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void persistConfig(config.value).catch((error) => console.warn('[BabelBox] 设置页关闭前后台保存失败', error));
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
  () => configurationService.value
    && getTranslationServiceInstance(config.value, configurationService.value)
    ? configurationService.value
    : config.value.service,
);

const setConfigurationService = (value: string) => {
  configurationService.value = value;
};

const actualService = computed(() => getTranslationServiceProvider(config.value, config.value.service));
const selectedDefaultInstance = computed(() => getTranslationServiceInstance(config.value, config.value.service));
const aiContextModel = computed(() => getTranslationServiceModel(config.value, config.value.service));
const canUseAIContext = computed(() => servicesType.isUseAIContext(actualService.value, aiContextModel.value));
const availableServiceOptions = computed(() => getSelectableTranslationServices(config.value));
const videoServiceOptions = computed(() => availableServiceOptions.value);
const selectedTextServiceLabel = computed(() => getTranslationServiceLabel(config.value, config.value.service));
const selectedVideoServiceLabel = computed(() => getTranslationServiceLabel(config.value, config.value.videoService));
const selectedTextServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(
  config.value.service,
  undefined,
  getTranslationServiceProvider(config.value, config.value.service),
));
const selectedVideoServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(
  config.value.videoService,
  undefined,
  getTranslationServiceProvider(config.value, config.value.videoService),
));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const serviceInventoryOptions = computed(() => getTranslationServiceOptions(config.value));
const selectedConfigurationInstance = computed(() => getTranslationServiceInstance(
  config.value,
  selectedConfigurationService.value,
));
const selectedConfigurationProvider = computed(() => selectedConfigurationInstance.value?.provider
  || selectedConfigurationService.value);
const configurationServiceOption = computed(() => serviceInventoryOptions.value.find(
  (item) => item.value === selectedConfigurationService.value,
));
const configurationServiceUnavailableMessage = computed(
  () => getTranslationServiceUnavailableMessage(
    selectedConfigurationService.value,
    undefined,
    selectedConfigurationProvider.value,
  ),
);
const configurationPresentation = computed(() => createServiceConfigurationPresentation(
  selectedConfigurationProvider.value,
  {
    selectedModel: selectedConfigurationInstance.value?.modelId,
    deepseekApiType: selectedConfigurationInstance.value?.deepseekApiType
      || config.value.deepseekApiType,
    available: Boolean(configurationServiceOption.value)
      && !configurationServiceUnavailableMessage.value,
    unavailableMessage: configurationServiceUnavailableMessage.value || undefined,
  },
));

// 高级设置只跟随实际默认服务；服务目录的展示状态由上面的 presentation 独立管理。
const showAdvancedAI = computed(() => servicesType.isAI(actualService.value));
const showAdvancedProxy = computed(() => servicesType.isUseProxy(actualService.value));
const showAdvancedCustom = computed(() => servicesType.isCustom(actualService.value));
function providerDefaultMappingValue(mapping: Record<string, string>): string {
  const selected = selectedDefaultInstance.value;
  if (selected && selected.id !== selected.provider) return '';
  return mapping[actualService.value] || '';
}
const advancedProxy = computed({
  get: () => selectedDefaultInstance.value?.proxy || providerDefaultMappingValue(config.value.proxy),
  set: (value: string) => {
    if (selectedDefaultInstance.value) selectedDefaultInstance.value.proxy = value.trim();
    else config.value.proxy[actualService.value] = value;
  },
});
const advancedSystemRole = computed({
  get: () => selectedDefaultInstance.value?.systemRole || providerDefaultMappingValue(config.value.system_role),
  set: (value: string) => {
    if (selectedDefaultInstance.value) selectedDefaultInstance.value.systemRole = value;
    else config.value.system_role[actualService.value] = value;
  },
});
const advancedUserRole = computed({
  get: () => selectedDefaultInstance.value?.userRole || providerDefaultMappingValue(config.value.user_role),
  set: (value: string) => {
    if (selectedDefaultInstance.value) selectedDefaultInstance.value.userRole = value;
    else config.value.user_role[actualService.value] = value;
  },
});

const showAddTranslationServiceDialog = ref(false);

function setTranslationServiceEnabled(id: string, enabled: boolean): void {
  const instance = getTranslationServiceInstance(config.value, id);
  if (!instance || instance.enabled === enabled) return;
  if (!enabled && !getSelectableTranslationServices(config.value).some((item) => item.value !== id)) {
    ElMessage.warning('至少需要启用一个翻译服务');
    return;
  }
  configurationService.value = id;
  instance.enabled = enabled;
  reconcileTranslationServiceReferences(config.value);
  const selectableIds = new Set(getSelectableTranslationServices(config.value).map((item) => item.value));
  const fallback = selectableIds.values().next().value as string | undefined;
  if (fallback) {
    if (!selectableIds.has(config.value.service)) config.value.service = fallback;
    if (!selectableIds.has(config.value.documentService)) config.value.documentService = fallback;
    if (!selectableIds.has(config.value.videoService)) config.value.videoService = fallback;
  }
}

function addTranslationService(payload: AddTranslationServicePayload): void {
  config.value.translationServices.push(payload.instance);
  configurationService.value = payload.instance.id;
  ElMessage.success(`已添加 ${payload.instance.name}`);
}

async function removeTranslationService(id: string): Promise<void> {
  const instance = getTranslationServiceInstance(config.value, id);
  if (!instance || instance.kind !== 'ai') return;
  if (instance.enabled && !getSelectableTranslationServices(config.value).some((item) => item.value !== id)) {
    ElMessage.warning('至少需要保留一个可用的翻译服务');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除“${instance.name}”后，它的配置和凭据也会一并删除。`,
      '删除 AI 翻译服务',
      {
        confirmButtonText: '删除',
        confirmButtonType: 'danger',
        cancelButtonText: '取消',
        type: 'warning',
      },
    );
  } catch {
    return;
  }

  config.value.translationServices = config.value.translationServices.filter((item) => item.id !== id);
  clearTranslationServiceConfiguration(config.value, instance);
  clearTranslationServiceCredentials(config.value, id);
  config.value.translationCenterServices = config.value.translationCenterServices.filter((item) => item !== id);
  reconcileTranslationServiceReferences(config.value);
  const selectableIds = new Set(getSelectableTranslationServices(config.value).map((item) => item.value));
  const fallback = selectableIds.values().next().value as string | undefined;
  if (fallback) {
    if (!selectableIds.has(config.value.service)) config.value.service = fallback;
    if (!selectableIds.has(config.value.documentService)) config.value.documentService = fallback;
    if (!selectableIds.has(config.value.videoService)) config.value.videoService = fallback;
  }
  if (configurationService.value === id) configurationService.value = config.value.service;
  ElMessage.success(`已删除 ${instance.name}`);
}

// 组件卸载时清理
onUnmounted(() => {
  unsubscribeConfig();
  unsubscribeCredentialStorageMode();
  unsubscribeHistory();
  unsubscribeBackups();
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
  options.styles.find(item => item.value === config.value.style && !item.disabled)?.class || 'babelbox-display-default'
);

// 恢复默认模板
const resetTemplate = () => {
  ElMessageBox.confirm(
    '当前的 system 和 user 模板会被覆盖。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    advancedSystemRole.value = defaultOption.system_role;
    advancedUserRole.value = defaultOption.user_role;
    ElMessage({
      message: '已恢复默认模板',
      type: 'success',
      duration: 2000
    });
  }).catch(() => {
    // 用户取消操作，不做任何处理
  });
};

// 悬浮球开关的计算属性
const floatingBallEnabled = computed({
  get: () => !config.value.disableFloatingBall,
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
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设为 ${getCustomHotkeyDisplayName()}`,
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
    message: hotkey === 'none' ? '已禁用划词翻译快捷键' : `划词翻译快捷键已设为 ${getCustomSelectionHotkeyDisplayName()}`,
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
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设为 ${getCustomMouseHotkeyDisplayName()}`,
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
  if (currentValue === undefined || !Number.isFinite(currentValue) || currentValue < 1) {
    ElMessage({
      message: '并发数不能小于 1',
      type: 'warning',
      duration: 2000
    });
    // 恢复默认值
    config.value.maxConcurrentTranslations = 6;
    return;
  }
  
  ElMessage({
    message: `并发数已设为 ${currentValue}`,
    type: 'success',
    duration: 2000
  });
};

const showExportBox = ref(false);
const exportData = ref('');
const showImportBox = ref(false);
const importData = ref('');
const credentialStorageMode = ref<CredentialStorageMode>(getCredentialStorageMode());
const credentialStorageBusy = ref(false);
const unsubscribeCredentialStorageMode = subscribeCredentialStorageMode((mode) => {
  credentialStorageMode.value = mode;
});

const setCredentialStorage = async (mode: CredentialStorageMode) => {
  if (mode === credentialStorageMode.value || credentialStorageBusy.value) return;

  if (mode === 'session') {
    try {
      await ElMessageBox.confirm(
        '此设备上保存的凭据将被删除。本次会话仍可使用，关闭浏览器或重载、更新扩展后需要重新填写。',
        '改为仅本次会话',
        {
          confirmButtonText: '删除并切换',
          confirmButtonType: 'danger',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }

  credentialStorageBusy.value = true;
  try {
    credentialStorageMode.value = await requestCredentialStorageModeChange(
      mode,
      browser.runtime.sendMessage.bind(browser.runtime),
    );
    ElMessage.success(mode === 'device'
      ? 'API 凭据已保存到此设备'
      : '已删除设备上的凭据，仅在本次会话中保留');
  } catch (error) {
    ElMessage.error(`凭据存储设置失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    credentialStorageBusy.value = false;
  }
};

const configHistory = ref<ConfigHistoryState>(getConfigHistorySnapshot());
const configBackups = ref<ConfigAutoBackupState>(getConfigAutoBackupsSnapshot());
const historyBusy = ref(false);
const backupBusy = ref(false);
const historyEntries = computed(() => [...configHistory.value.entries].reverse());
const backupEntries = computed(() => [...configBackups.value.entries].reverse());
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
  const service = getTranslationServiceLabel(entry.config, entry.config.service);
  const siteCount = entry.config.alwaysTranslateDomains?.length ?? 0;
  const disabledSiteCount = entry.config.disabledExtensionDomains?.length ?? 0;
  const siteRules = [
    siteCount > 0 ? `始终翻译 ${siteCount} 个网站` : '',
    disabledSiteCount > 0 ? `禁用扩展 ${disabledSiteCount} 个网站` : '',
  ].filter(Boolean);
  return [target, service, ...siteRules].join(' · ');
};

const backupSummary = (entry: ConfigAutoBackupEntry): string => historySummary(entry);

void configHistoryReady.then(() => {
  configHistory.value = getConfigHistorySnapshot();
});
void configAutoBackupsReady.then(() => {
  configBackups.value = getConfigAutoBackupsSnapshot();
});
const unsubscribeHistory = subscribeConfigHistory((nextHistory) => {
  configHistory.value = nextHistory;
});
const unsubscribeBackups = subscribeConfigAutoBackups((nextBackups) => {
  configBackups.value = nextBackups;
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

const restoreBackup = async (version: number) => {
  if (backupBusy.value) return;
  try {
    await ElMessageBox.confirm(`确定恢复定时备份 b${version} 吗？`, '恢复配置', {
      confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning',
    });
  } catch {
    return;
  }
  backupBusy.value = true;
  try {
    const result = await requestConfigAutoBackupRestore(
      version,
      browser.runtime.sendMessage.bind(browser.runtime),
    );
    configBackups.value = result.backups;
    configHistory.value = result.history;
    ElMessage.success(`已恢复定时备份 b${version}`);
  } catch (error) {
    ElMessage.error(`恢复失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    backupBusy.value = false;
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
        message: '配置格式不正确',
        type: 'error',
      });
      return;
    }
    await persistConfig(prepareConfigForImport(parsedConfig, runtimeConfig));
    ElMessage({
      message: '配置已导入',
      type: 'success',
    });
    showImportBox.value = false;
    importData.value = '';
    // Optionally, reload the extension or relevant parts
  } catch (e) {
    ElMessage({
      message: '配置格式不正确',
      type: 'error',
    });
  }
};

</script>

<style scoped src="./settings-sections.css"></style>
