<script setup lang="ts">
import { adminError, adminStatus } from '~/utils/admin-state';
import type { SourceSummary } from '~/utils/admin-state';
const items = ref<SourceSummary[]>([]);
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
      items: SourceSummary[];
      nextCursor: string | null;
    }>('/api/admin/sources', {
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
    error.value = adminError(cause);
    if (adminStatus(cause) === 403) {
      items.value = [];
      loaded.value = false;
      cursor.value = null;
    }
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">教材一覧</h1>
    <p>管理者用の教材登録・問題生成です。生成した問題は公開前に確認します。</p>
    <UButton v-if="loaded" to="/admin/sources/new">教材を登録</UButton>
    <p v-if="loading" role="status">教材を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton :disabled="loading" variant="outline" @click="load"
        >再確認</UButton
      >
    </div>
    <p v-if="loaded && !items.length && !loading">
      教材はまだありません。テキスト教材を登録してください。
    </p>
    <ul class="space-y-3">
      <li v-for="item in items" :key="item.id">
        <UCard
          ><NuxtLink
            :to="`/admin/sources/${item.id}`"
            class="break-words font-semibold text-primary underline"
            >{{ item.title }}</NuxtLink
          ></UCard
        >
      </li>
    </ul>
    <UButton
      v-if="cursor && !error"
      :disabled="loading"
      variant="outline"
      @click="load"
      >さらに読み込む</UButton
    >
  </AdminShell>
</template>
