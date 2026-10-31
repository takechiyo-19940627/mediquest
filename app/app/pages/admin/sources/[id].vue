<script setup lang="ts">
import { adminError, validAdminId } from '~/utils/admin-state';
import type { SourceDetail } from '~/utils/admin-state';
const route = useRoute();
const source = ref<SourceDetail | null>(null);
const loading = ref(true);
const error = ref('');
let active = true;
let sequence = 0;
onBeforeUnmount(() => {
  active = false;
  sequence++;
});
function forbidden() {
  source.value = null;
  error.value = '管理者としてこの操作を利用できません。';
}
async function load() {
  const request = ++sequence;
  source.value = null;
  error.value = '';
  loading.value = true;
  const id = String(route.params.id);
  if (!validAdminId(id)) {
    error.value = '教材が見つかりません。';
    loading.value = false;
    return;
  }
  try {
    const result = await $fetch<SourceDetail>(`/api/admin/sources/${id}`, {
      retry: 0,
    });
    if (active && request === sequence) source.value = result;
  } catch (cause) {
    if (active && request === sequence) error.value = adminError(cause);
  } finally {
    if (active && request === sequence) loading.value = false;
  }
}
onMounted(load);
watch(() => route.params.id, load);
</script>
<template>
  <AdminShell>
    <p v-if="loading" role="status">教材を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <h1 class="text-2xl font-semibold">{{ error }}</h1>
      <UButton variant="outline" :disabled="loading" @click="load"
        >再確認</UButton
      >
    </div>
    <template v-if="source">
      <h1 class="break-words text-2xl font-semibold">{{ source.title }}</h1>
      <UCard
        ><h2 class="mb-3 text-lg font-semibold">教材本文</h2>
        <p class="whitespace-pre-wrap break-words">{{ source.body }}</p></UCard
      >
      <UCard>
        <h2 class="text-lg font-semibold">自分で問題を作る</h2>
        <p class="my-3">
          問題文・選択肢・正答・解説を手入力できます。AIの設定や接続は不要です。
        </p>
        <UButton :to="`/admin/manual-sets/new?sourceId=${source.id}`"
          >手動で問題を登録する</UButton
        >
      </UCard>
      <AdminGenerationPanel
        :key="source.id"
        :source-id="source.id"
        :source-title="source.title"
        @forbidden="forbidden"
      />
    </template>
  </AdminShell>
</template>
