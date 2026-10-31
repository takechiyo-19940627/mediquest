<script setup lang="ts">
import { catalogError, validCatalogId } from '~/utils/catalog-state';
import type { CatalogDetail } from '~/utils/catalog-state';
import { studyError, studyStatus } from '~/utils/study-api';
import type { StudySummary } from '~/utils/study-api';

const route = useRoute();
const detail = ref<CatalogDetail | null>(null);
const loading = ref(true);
const error = ref('');
const starting = ref(false);
const startError = ref('');
const pendingKey = ref<string | null>(null);
const forbidden = ref(false);
let sequence = 0;
let active = true;
onBeforeUnmount(() => {
  active = false;
  sequence++;
});
async function load() {
  const request = ++sequence;
  detail.value = null;
  startError.value = '';
  starting.value = false;
  error.value = '';
  const id = String(route.params.id);
  forbidden.value = false;
  pendingKey.value = null;
  if (validCatalogId(id)) {
    try {
      pendingKey.value = sessionStorage.getItem(
        `mediquest:start:${Number(id)}`,
      );
    } catch {
      /* Starting reports unavailable browser storage before sending. */
    }
  }
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
    if (active && request === sequence) {
      error.value = catalogError(cause, true);
      forbidden.value = studyStatus(cause) === 403;
    }
  } finally {
    if (active && request === sequence) loading.value = false;
  }
}
async function start() {
  if (
    starting.value ||
    forbidden.value ||
    (!pendingKey.value && !detail.value?.canStart)
  )
    return;
  const request = sequence;
  const setId = Number(route.params.id);
  const storageKey = `mediquest:start:${setId}`;
  starting.value = true;
  startError.value = '';
  try {
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(storageKey, key);
    }
    pendingKey.value = key;
    const result = await $fetch<{ session: StudySummary }>('/api/sessions', {
      method: 'POST',
      body: { setId },
      headers: { 'Idempotency-Key': key },
      retry: 0,
    });
    if (!active || request !== sequence) return;
    await navigateTo(`/sessions/${result.session.id}`);
    sessionStorage.removeItem(storageKey);
  } catch (cause) {
    if (active && request === sequence) {
      startError.value = studyError(cause);
      if (studyStatus(cause) === 403) {
        forbidden.value = true;
        error.value = startError.value;
        detail.value = null;
      }
    }
  } finally {
    if (active && request === sequence) starting.value = false;
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

      <UButton
        v-if="startError && !pendingKey"
        variant="outline"
        :disabled="starting"
        @click="load"
        >セットの状態を確認する</UButton
      >
      <UButton
        v-if="!pendingKey"
        :disabled="!detail.canStart || starting"
        :loading="starting"
        @click="start"
      >
        {{ startError ? '同じ開始要求を再試行する' : '演習を始める' }}
      </UButton>
      <p role="status">セットを読み込みました。</p>
    </template>
    <p v-if="startError && !forbidden" role="alert">{{ startError }}</p>
    <div v-if="pendingKey && !forbidden" class="space-y-3">
      <p>
        前の開始要求が残っています。同じ受付を確認し、保存済みの演習へ戻れます。
      </p>
      <UButton
        :disabled="starting || loading"
        :loading="starting"
        @click="start"
        >同じ開始要求を確認する</UButton
      >
    </div>
  </LearnerShell>
</template>
