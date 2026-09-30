<script setup lang="ts">
import { computed } from 'vue';
import type { CsvOptions } from '../csv';
import { encodingOptions, type MarkdownWidth } from '../document';
import AppDialog from './AppDialog.vue';
import OptionSelect from './OptionSelect.vue';
import ThemeCheckbox from './ThemeCheckbox.vue';
import { isDocumentFontSize, MIN_DOCUMENT_FONT_SIZE, MAX_DOCUMENT_FONT_SIZE } from '../typography';

const props = defineProps<{
  kind: 'general' | 'markdown' | 'csv';
  dark: boolean;
  fontSize: number;
  encoding?: string;
  lineEnding?: string;
  markdownWidth?: MarkdownWidth;
  csvOptions?: CsvOptions;
}>();
const emit = defineEmits<{
  close: [];
  'restore-focus': [];
  theme: [dark: boolean];
  'font-size': [value: number];
  encoding: [value: string];
  'line-ending': [value: string];
  'markdown-width': [value: MarkdownWidth];
  'csv-options': [value: Partial<CsvOptions>];
}>();
const title = computed(() => ({ general: '设置', markdown: 'Markdown 设置', csv: 'CSV设置' })[props.kind]);
const lineEndingOptions = computed(() => [
  ...(props.lineEnding === 'Mixed' ? [{ value: 'Mixed', label: 'Mixed', disabled: true }] : []),
  ...['LF', 'CRLF', 'CR'].map((value) => ({ value, label: value })),
]);
const widthOptions = [
  { value: 'full', label: '全宽' },
  { value: 'standard', label: '标准 · 960px' },
  { value: 'compact', label: '紧凑 · 720px' },
];
const delimiterOptions = [
  { value: '', label: '自动识别' },
  { value: ',', label: '逗号 ,' },
  { value: ';', label: '分号 ;' },
  { value: '\t', label: '制表符 Tab' },
  { value: '|', label: '竖线 |' },
  { value: 'custom', label: '自定义' },
];
const escapeOptions = [
  { value: '"', label: '双引号 ""' },
  { value: '\\', label: '反斜杠 \\' },
];

function setCustomDelimiter(input: HTMLInputElement) {
  if (input.value.length === 1 && !/[\r\n"]/.test(input.value)) emit('csv-options', { customDelimiter: input.value });
  else if (input.value) input.value = props.csvOptions?.customDelimiter ?? ':';
}

function setFontSize(input: HTMLInputElement) {
  const size = input.valueAsNumber;
  if (isDocumentFontSize(size)) emit('font-size', size);
  else input.value = String(props.fontSize);
}
</script>

<template>
  <AppDialog
    :title="title"
    :panel-class="kind === 'csv' ? 'settings-modal csv-settings-modal' : 'settings-modal'"
    @close="emit('close')"
    @restore-focus="emit('restore-focus')"
  >
    <template v-if="kind === 'general'">
      <div class="theme-setting">
        <span>外观</span>
        <div class="theme-options" role="group" aria-label="外观主题">
          <button :aria-pressed="!dark" @click="emit('theme', false)">Light</button>
          <button :aria-pressed="dark" @click="emit('theme', true)">Dark</button>
        </div>
      </div>
      <label class="setting-row">
        <span>字体大小</span>
        <div class="font-size-setting">
          <input
            type="number"
            aria-label="字体大小"
            :min="MIN_DOCUMENT_FONT_SIZE"
            :max="MAX_DOCUMENT_FONT_SIZE"
            step="1"
            :value="fontSize"
            @change="setFontSize($event.target as HTMLInputElement)"
          />
          <span>px</span>
        </div>
      </label>
      <div class="setting-row">
        <span>保存编码</span
        ><OptionSelect
          label="保存编码"
          :model-value="encoding"
          :options="encodingOptions"
          @update:model-value="emit('encoding', $event)"
        />
      </div>
      <div class="setting-row">
        <span>换行格式</span
        ><OptionSelect
          label="换行格式"
          :model-value="lineEnding"
          :options="lineEndingOptions"
          @update:model-value="emit('line-ending', $event)"
        />
      </div>
    </template>
    <div v-else-if="kind === 'markdown'" class="setting-row">
      <span>显示宽度</span
      ><OptionSelect
        label="显示宽度"
        :model-value="markdownWidth"
        :options="widthOptions"
        @update:model-value="emit('markdown-width', $event as MarkdownWidth)"
      />
    </div>
    <template v-else>
      <div class="setting-row">
        <span>分隔符</span
        ><OptionSelect
          label="分隔符"
          :model-value="csvOptions?.delimiter"
          :options="delimiterOptions"
          @update:model-value="emit('csv-options', { delimiter: $event as CsvOptions['delimiter'] })"
        />
      </div>
      <label v-if="csvOptions?.delimiter === 'custom'" class="setting-row"
        >自定义字符
        <input
          :value="csvOptions.customDelimiter"
          maxlength="1"
          @input="setCustomDelimiter($event.target as HTMLInputElement)"
      /></label>
      <div class="setting-row">
        <span>引号内转义</span
        ><OptionSelect
          label="引号内转义"
          :model-value="csvOptions?.escapeChar"
          :options="escapeOptions"
          @update:model-value="emit('csv-options', { escapeChar: $event as CsvOptions['escapeChar'] })"
        />
      </div>
      <label class="csv-setting-toggle"
        ><span>首行作为表头</span
        ><ThemeCheckbox
          :model-value="csvOptions?.firstRowHeader ?? true"
          @update:model-value="emit('csv-options', { firstRowHeader: $event })"
      /></label>
      <label class="csv-setting-toggle"
        ><span>跳过空行</span
        ><ThemeCheckbox
          :model-value="csvOptions?.skipEmptyLines ?? true"
          @update:model-value="emit('csv-options', { skipEmptyLines: $event })"
      /></label>
    </template>
  </AppDialog>
</template>
