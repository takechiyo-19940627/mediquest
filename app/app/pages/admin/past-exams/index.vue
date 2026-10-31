<script setup lang="ts">
import { adminError } from '~/utils/admin-state';
import type { PastExam } from '~/utils/past-exams';
const items = ref<PastExam[]>([]);
const loading = ref(true);
const cursor = ref<string | null>(null);
const error = ref('');
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function load(more = false) {
  loading.value = true;
  error.value = '';
  try {
    const result = await $fetch<{
      items: PastExam[];
      nextCursor: string | null;
    }>('/api/admin/past-exams', {
      query: {
        limit: 20,
        ...(more && cursor.value ? { before: cursor.value } : {}),
      },
      retry: 0,
    });
    if (active) {
      items.value = more
        ? [
            ...items.value,
            ...result.items.filter(
              (item) =>
                !items.value.some((existing) => existing.id === item.id),
            ),
          ]
        : result.items;
      cursor.value = result.nextCursor;
    }
  } catch (cause) {
    if (active) {
      items.value = [];
      error.value = adminError(cause);
    }
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(() => load());
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">過去問の管理</h1>
    <p>
      試験・年度・科目ごとに過去問を登録します。登録した問題はホームから解けます。
    </p>
    <UButton to="/admin/past-exams/new">新しい過去問を登録</UButton>
    <p v-if="loading" role="status">過去問を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton :disabled="loading" @click="load(false)">再試行</UButton>
    </div>
    <UCard v-if="!loading && !error && !items.length"
      ><h2 class="text-lg font-semibold">まずは1問、登録してみましょう</h2>
      <p class="mt-2">
        「新しい過去問を登録」から問題文と選択肢を入力し、正答を選ぶだけで始められます。
      </p></UCard
    >
    <ul class="space-y-4" aria-label="登録済みの過去問">
      <li v-for="item in items" :key="item.id">
        <UCard
          ><div class="space-y-3 break-words">
            <h2 class="text-lg font-semibold">{{ item.title }}</h2>
            <p>
              {{ item.questionCount }}問 ·
              {{
                item.status === 'archived'
                  ? '旧版（履歴を保持）'
                  : `出題可能 ${item.availableQuestionCount}問`
              }}
            </p>
            <UButton
              :to="`/admin/past-exams/${item.id}`"
              variant="outline"
              :aria-label="`${item.title}を確認・修正`"
              >確認・修正</UButton
            >
          </div></UCard
        >
      </li>
    </ul>
    <UButton
      v-if="cursor && !error"
      :disabled="loading"
      variant="outline"
      @click="load(true)"
      >もっと見る</UButton
    >
  </AdminShell>
</template>
