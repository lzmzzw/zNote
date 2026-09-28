<script setup lang="ts">
import { Check } from 'lucide-vue-next';
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <span class="theme-checkbox">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="checkbox-mark"><Check :size="13" aria-hidden="true" /></span>
  </span>
</template>
