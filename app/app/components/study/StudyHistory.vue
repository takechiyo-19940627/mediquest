<script setup lang="ts">
import { studyError, studyStatus } from '~/utils/study-api';
import type { StudyHistoryPage, StudyHistoryEntry } from '~/utils/study-api';
const props = defineProps<{ interrupted?: boolean }>();
const entries = ref<StudyHistoryEntry[]>([]);
const cursor = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const retryMore = ref(false);
let active = true;
let sequence = 0;
async function load(more = false) {
  if (busy.value) return;
  const token = ++sequence;
  busy.value = true;
  retryMore.value = more;
  error.value = '';
  try {
    const data = await $fetch<StudyHistoryPage>('/api/sessions', {
      query: {
        limit: props.interrupted ? 5 : 20,
        ...(props.interrupted ? { status: 'in_progress' } : {}),
        ...(more && cursor.value ? { before: cursor.value } : {}),
      },
      retry: 0,
    });
    if (!active || sequence !== token) return;
    const merged = more ? [...entries.value, ...data.items] : data.items;
    entries.value = merged.filter(
      (entry, index) =>
        merged.findIndex((other) => other.id === entry.id) === index,
    );
    cursor.value = data.nextCursor;
    loaded.value = true;
  } catch (cause) {
    if (!active || sequence !== token) return;
    error.value = studyError(cause);
    if (studyStatus(cause) === 403) {
      entries.value = [];
      cursor.value = null;
      loaded.value = false;
    }
  } finally {
    if (active && sequence === token) busy.value = false;
  }
}
onMounted(() => load());
onBeforeUnmount(() => {
  active = false;
  sequence++;
});
</script>
<template>
  <section
    :aria-label="interrupted ? '中断した演習' : '演習履歴'"
    class="space-y-4"
  >
    <h2 v-if="interrupted" class="text-xl font-semibold">中断した演習</h2>
    <p v-if="busy" role="status">履歴を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-2">
      <p>{{ error }}</p>
      <UButton :disabled="busy" variant="outline" @click="load(retryMore)"
        >履歴を再試行</UButton
      >
    </div>
    <p v-if="loaded && !entries.length && !error">
      {{
        interrupted
          ? '中断した演習はありません。'
          : '演習履歴はまだありません。'
      }}
    </p>
    <ul
      v-if="entries.length"
      class="space-y-4"
      :aria-label="interrupted ? '中断一覧' : '履歴一覧'"
    >
      <li v-for="entry in entries" :key="entry.id">
        <UCard
          ><div class="space-y-3 break-words">
            <component
              :is="interrupted ? 'h3' : 'h2'"
              class="text-lg font-semibold"
              >{{ entry.setTitle }}</component
            >
            <p>
              {{ entry.mode === 'review' ? '誤答復習' : '通常演習' }} ·
              {{ entry.status === 'completed' ? '完了' : '中断中' }}
            </p>
            <p class="text-sm text-muted">
              開始日時: {{ new Date(entry.startedAt).toLocaleString('ja-JP') }}
            </p>
            <StudyStatistics :statistics="entry.statistics" />
            <div class="flex flex-wrap gap-3">
              <UButton
                v-if="entry.status === 'in_progress'"
                :to="`/sessions/${entry.id}`"
                :aria-label="`演習${entry.id}を再開する`"
                >再開する</UButton
              >
              <UButton
                :to="`/sessions/${entry.id}/result`"
                variant="outline"
                :aria-label="`演習${entry.id}の結果を見る`"
                >結果を見る</UButton
              >
            </div>
          </div></UCard
        >
      </li>
    </ul>
    <UButton
      v-if="cursor && !error"
      :disabled="busy"
      variant="outline"
      @click="load(true)"
      >履歴をもっと見る</UButton
    >
    <UButton
      v-if="loaded && !error"
      :disabled="busy"
      variant="link"
      @click="load(false)"
      >履歴を更新する</UButton
    >
  </section>
</template>
