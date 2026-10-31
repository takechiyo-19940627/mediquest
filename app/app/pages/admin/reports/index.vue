<script setup lang="ts">
import { reportError } from '~/utils/report-api';
import { studyStatus } from '~/utils/study-api';
import type { ReportReceipt } from '~/utils/report-api';
const items = ref<(ReportReceipt & { versionId: number })[]>([]);
const cursor = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const retryMore = ref(false);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function load(more = false) {
  if (busy.value) return;
  busy.value = true;
  retryMore.value = more;
  error.value = '';
  try {
    const result = await $fetch<{
      items: typeof items.value;
      nextCursor: string | null;
    }>('/api/admin/reports', {
      query: {
        limit: 20,
        ...(more && cursor.value ? { before: cursor.value } : {}),
      },
      retry: 0,
    });
    if (!active) return;
    const rows = more ? [...items.value, ...result.items] : result.items;
    items.value = rows.filter(
      (row, index) => rows.findIndex((other) => other.id === row.id) === index,
    );
    cursor.value = result.nextCursor;
    loaded.value = true;
  } catch (cause) {
    if (!active) return;
    error.value = reportError(cause);
    if (studyStatus(cause) === 403) {
      items.value = [];
      cursor.value = null;
      loaded.value = false;
    }
  } finally {
    if (active) busy.value = false;
  }
}
onMounted(() => load());
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">不備報告</h1>
    <p>
      未対応の報告を表示しています。判断済みの報告は一覧から除かれ、詳細URLから判断結果を確認できます。
    </p>
    <p v-if="busy" role="status">報告を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-2">
      <p>{{ error }}</p>
      <UButton :disabled="busy" @click="load(retryMore)"
        >報告一覧を再試行</UButton
      >
    </div>
    <p v-if="loaded && !items.length && !error">未対応の報告はありません。</p>
    <ul aria-label="未対応の報告" class="space-y-4">
      <li v-for="item in items" :key="item.id">
        <UCard
          ><div class="space-y-3 break-words">
            <NuxtLink
              :to="`/admin/reports/${item.id}`"
              class="font-semibold text-primary underline"
              >報告 #{{ item.id }} · 問題版 #{{ item.versionId }}</NuxtLink
            >
            <p>
              未対応 · {{ new Date(item.createdAt).toLocaleString('ja-JP') }}
            </p>
            <p class="whitespace-pre-wrap">{{ item.message }}</p>
          </div></UCard
        >
      </li>
    </ul>
    <UButton v-if="cursor && !error" :disabled="busy" @click="load(true)"
      >報告をもっと見る</UButton
    >
    <UButton
      v-if="loaded && !error"
      :disabled="busy"
      variant="outline"
      @click="load(false)"
      >報告一覧を更新する</UButton
    >
  </AdminShell>
</template>
