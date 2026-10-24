<script setup lang="ts">
const colorMode = useColorMode();
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <fieldset class="flex flex-wrap items-center gap-2">
    <legend class="mb-2 text-sm">表示テーマ</legend>
    <UButton
      v-for="theme in [
        { value: 'system', label: 'システム' },
        { value: 'light', label: 'ライト' },
        { value: 'dark', label: 'ダーク' },
      ]"
      :key="theme.value"
      color="neutral"
      variant="outline"
      :aria-pressed="
        !mounted || colorMode.unknown
          ? undefined
          : colorMode.preference === theme.value
      "
      @click="colorMode.preference = theme.value"
    >
      {{ theme.label }}
    </UButton>
  </fieldset>
</template>
