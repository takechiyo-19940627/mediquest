<script setup lang="ts">
import { catalogError, validCatalogId } from '~/utils/catalog-state';
import type { CatalogDetail } from '~/utils/catalog-state';

const route = useRoute();
const detail = ref<CatalogDetail | null>(null);
const loading = ref(true);
const error = ref('');
let sequence = 0;
let active = true;
onBeforeUnmount(() => {
  active = false;
  sequence++;
});
async function load() {
  const request = ++sequence;
  detail.value = null;
  error.value = '';
  const id = String(route.params.id);
  if (!validCatalogId(id)) {
    error.value = '現在このセットを表示できません';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await $fetch<CatalogDetail>(`/api/sets/${id}`, { retry: 0 });
    if (active && request === sequence) detail.value = result;
  } catch (cause) {
    if (active && request === sequence) error.value = catalogError(cause, true);
  } finally {
    if (active && request === sequence) loading.value = false;
  }
}
onMounted(load);
watch(() => route.params.id, load);
</script>

<template>
  <LearnerShell>
    <UButton to="/" variant="link">一覧へ戻る</UButton>
    <p v-if="loading" role="status">セットを読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <h1 class="text-2xl font-semibold">{{ error }}</h1>
      <UButton variant="outline" :disabled="loading" @click="load"
        >再試行</UButton
      >
    </div>
    <template v-if="detail">
      <h1 class="break-words text-2xl font-semibold">{{ detail.title }}</h1>
      <UCard>
        <div class="space-y-4 break-words">
          <p class="whitespace-pre-wrap text-muted">{{ detail.description }}</p>
          <p>出題可能: {{ detail.availableQuestionCount }}問</p>
          <p v-if="!detail.canStart">現在出題可能な問題はありません</p>
        </div>
      </UCard>
      <UAlert color="neutral" title="演習画面は準備中です" />
      <p role="status">セットを読み込みました。</p>
    </template>
  </LearnerShell>
</template>
