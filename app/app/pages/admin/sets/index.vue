<script setup lang="ts">
import { adminStatus } from '~/utils/admin-state';
import { setError, setStatusLabel } from '~/utils/admin-sets';
import type { AdminSetSummary } from '~/utils/admin-sets';
const items = ref<AdminSetSummary[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);
const loaded = ref(false);
const error = ref('');
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function load() {
  if (loading.value && loaded.value) return;
  loading.value = true;
  error.value = '';
  try {
    const result = await $fetch<{
      items: AdminSetSummary[];
      nextCursor: string | null;
    }>('/api/admin/sets', {
      query: { limit: 20, ...(cursor.value ? { before: cursor.value } : {}) },
      retry: 0,
    });
    if (!active) return;
    const known = new Set(items.value.map((item) => item.id));
    items.value.push(...result.items.filter((item) => !known.has(item.id)));
    cursor.value = result.nextCursor;
    loaded.value = true;
  } catch (cause) {
    if (!active) return;
    error.value = setError(cause);
    if (adminStatus(cause) === 403) {
      items.value = [];
      cursor.value = null;
      loaded.value = false;
    }
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">問題セット管理</h1>
    <p>生成した下書きを確認し、採用する問題と順序を決めて公開します。</p>
    <p v-if="loading" role="status">セットを読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton variant="outline" :disabled="loading" @click="load"
        >再確認</UButton
      >
    </div>
    <p v-if="loaded && !items.length && !loading">
      セットはまだありません。教材の詳細から問題を生成してください。
    </p>
    <ul class="space-y-3">
      <li v-for="item in items" :key="item.id">
        <UCard
          ><div class="space-y-2 break-words">
            <NuxtLink
              :to="`/admin/sets/${item.id}`"
              class="font-semibold text-primary underline"
              >{{ item.title }}</NuxtLink
            >
            <p>
              {{ setStatusLabel[item.status] }} · 確認済み
              {{ item.reviewedCount }} / 候補 {{ item.candidateCount }}問
            </p>
          </div></UCard
        >
      </li>
    </ul>
    <UButton
      v-if="cursor && !error"
      variant="outline"
      :disabled="loading"
      @click="load"
      >さらに読み込む</UButton
    >
  </AdminShell>
</template>
