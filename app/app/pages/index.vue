<script setup lang="ts">
import { catalogError } from '~/utils/catalog-state';
import type { PastExam } from '~/utils/past-exams';
type CatalogPage = {
  items: (PastExam & { availableQuestionCount: number })[];
  nextCursor: string | null;
};
type CatalogSet = PastExam & { availableQuestionCount: number };

const items = ref<CatalogSet[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);
const error = ref('');
const loaded = ref(false);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function load(more = false) {
  if (loading.value && loaded.value) return;
  loading.value = true;
  error.value = '';
  try {
    const page = await $fetch<CatalogPage>('/api/past-exams', {
      query: {
        limit: 20,
        ...(more && cursor.value ? { before: cursor.value } : {}),
      },
      retry: 0,
    });
    if (!active) return;
    items.value = more
      ? [
          ...items.value,
          ...page.items.filter(
            (item) => !items.value.some((existing) => existing.id === item.id),
          ),
        ]
      : page.items;
    cursor.value = page.nextCursor;
    loaded.value = true;
  } catch (cause) {
    if (!active) return;
    error.value = catalogError(cause);
    if ((cause as { statusCode?: number }).statusCode === 403) {
      items.value = [];
      cursor.value = null;
      loaded.value = false;
    }
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(() => load());
</script>

<template>
  <LearnerShell>
    <h1 class="text-2xl font-semibold">過去問で学ぶ</h1>
    <p>登録した過去問を解き、間違えた問題を繰り返し復習しましょう。</p>
    <UButton to="/admin/past-exams/new" variant="outline"
      >過去問を登録する</UButton
    >
    <StudyHistory interrupted />
    <p v-if="loading" role="status">過去問を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton variant="outline" :disabled="loading" @click="load(loaded)"
        >再試行</UButton
      >
    </div>
    <UCard v-if="loaded && !items.length && !error">
      <h2 class="text-lg font-semibold">学習できる問題はまだありません</h2>
      <p class="mt-2 text-muted">
        お手元の過去問を1問から登録できます。問題文・選択肢・正答を入力すると、ここから演習を始められます。
      </p>
    </UCard>
    <ul v-if="items.length" class="space-y-6" aria-label="過去問">
      <li v-for="item in items" :key="item.id">
        <UCard>
          <div class="min-w-0 space-y-3 break-words">
            <h2 class="text-lg font-semibold">{{ item.title }}</h2>
            <p class="whitespace-pre-wrap text-muted">
              {{ item.examName }} / {{ item.year }} / {{ item.subject }}
            </p>
            <p>出題可能: {{ item.availableQuestionCount }}問</p>
            <UButton
              :to="`/sets/${item.id}`"
              :aria-label="`${item.title}の詳細を見る`"
              >詳細を見る</UButton
            >
          </div>
        </UCard>
      </li>
    </ul>
    <UButton
      v-if="cursor && !error"
      variant="outline"
      :disabled="loading"
      @click="load(true)"
      >もっと見る</UButton
    >
    <p v-if="loaded && !loading && items.length" role="status">
      {{ items.length }}件の過去問を表示しています。
    </p>
  </LearnerShell>
</template>
