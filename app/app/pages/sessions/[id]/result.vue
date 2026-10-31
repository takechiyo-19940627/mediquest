<script setup lang="ts">
import { validCatalogId } from '~/utils/catalog-state';
import { studyError, studyStatus } from '~/utils/study-api';
import type { StudySummary, StudyItem } from '~/utils/study-api';
const route = useRoute();
const session = ref<StudySummary | null>(null);
const items = ref<StudyItem[]>([]);
const busy = ref(false);
const starting = ref(false);
const error = ref('');
const reviewError = ref('');
const pendingKey = ref<string | null>(null);
const forbidden = ref(false);
let active = true;
let generation = 0;
const canReview = computed(
  () =>
    session.value?.status === 'completed' &&
    items.value.some((item) => item.feedback?.isCorrect === false),
);
const current = (token: number) => active && token === generation;
function storageKey() {
  return `mediquest:review:${Number(route.params.id)}`;
}
function label(item: StudyItem, ids: string[]) {
  return (
    item.choices
      ?.filter((choice) => ids.includes(choice.id))
      .map((choice) => choice.label)
      .join('、') ?? ''
  );
}
function clearSensitive() {
  session.value = null;
  items.value = [];
}
async function load() {
  const token = ++generation;
  clearSensitive();
  busy.value = true;
  starting.value = false;
  error.value = '';
  reviewError.value = '';
  forbidden.value = false;
  pendingKey.value = null;
  const id = String(route.params.id);
  if (!validCatalogId(id)) {
    error.value = 'この演習または問題を表示できません。';
    busy.value = false;
    return;
  }
  try {
    pendingKey.value = sessionStorage.getItem(storageKey());
  } catch {
    /* Start refuses unavailable storage before posting. */
  }
  try {
    const summary = await $fetch<StudySummary>(`/api/sessions/${id}`, {
      retry: 0,
    });
    const rows = await Promise.all(
      summary.items.map((item) =>
        $fetch<StudyItem>(`/api/sessions/${id}/items/${item.id}`, { retry: 0 }),
      ),
    );
    if (!current(token)) return;
    session.value = summary;
    items.value = rows;
  } catch (cause) {
    if (!current(token)) return;
    clearSensitive();
    error.value = studyError(cause);
    forbidden.value = [400, 403, 404].includes(studyStatus(cause) ?? 0);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function startReview() {
  if (
    starting.value ||
    busy.value ||
    forbidden.value ||
    (!pendingKey.value && !canReview.value)
  )
    return;
  const token = generation;
  const id = Number(route.params.id);
  const keyName = storageKey();
  starting.value = true;
  reviewError.value = '';
  try {
    let key = pendingKey.value ?? sessionStorage.getItem(keyName);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
    }
    pendingKey.value = key;
    const result = await $fetch<{ session: StudySummary }>(
      `/api/sessions/${id}/reviews`,
      {
        method: 'POST',
        body: {},
        headers: { 'Idempotency-Key': key },
        retry: 0,
      },
    );
    if (!current(token)) return;
    await navigateTo(`/sessions/${result.session.id}`);
    sessionStorage.removeItem(keyName);
  } catch (cause) {
    if (!current(token)) return;
    reviewError.value =
      studyStatus(cause) === 409
        ? '現在復習できる誤答がないか、公開状態が変わりました。結果を更新して確認してください。'
        : studyError(cause);
    if ([400, 403, 404].includes(studyStatus(cause) ?? 0)) {
      clearSensitive();
      forbidden.value = true;
      error.value = reviewError.value;
    }
  } finally {
    if (current(token)) starting.value = false;
  }
}
onMounted(load);
watch(() => route.params.id, load);
onBeforeUnmount(() => {
  active = false;
  generation++;
});
</script>
<template>
  <LearnerShell>
    <h1 class="text-2xl font-semibold">演習結果</h1>
    <p v-if="busy" role="status">
      当時の問題と保存済みの回答を読み込み中です。
    </p>
    <div v-if="error" role="alert" class="space-y-2">
      <p>{{ error }}</p>
      <UButton :disabled="busy || starting" @click="load">結果を再試行</UButton>
    </div>
    <template v-if="session">
      <p>
        {{
          session.status === 'completed'
            ? '完了した演習です。'
            : session.statistics.unansweredEligibleCount > 0
              ? '未回答が残る演習です。'
              : '再開すると、対象のない演習の完了状態を更新できます。'
        }}
      </p>
      <StudyStatistics :statistics="session.statistics" />
      <p class="text-sm text-muted">
        正答率は集計対象全体を分母とし、未回答も含みます。不備による除外を除き、通常の改訂では当時の正誤を変更しません。
      </p>
      <div class="flex flex-wrap gap-3">
        <UButton
          v-if="session.status === 'in_progress'"
          :to="`/sessions/${session.id}`"
          >演習を再開する</UButton
        >
        <UButton :disabled="busy || starting" variant="outline" @click="load"
          >結果を更新する</UButton
        >
      </div>
      <p v-if="reviewError" role="alert">{{ reviewError }}</p>
      <UButton
        v-if="!pendingKey"
        :disabled="!canReview || starting || busy"
        :loading="starting"
        @click="startReview"
        >誤答を復習する</UButton
      >
      <p v-if="!canReview">
        完了済みの演習に復習できる誤答がある場合に開始できます。
      </p>
      <p class="text-sm text-muted">
        停止・不備や公開停止がある場合は、新しい復習を開始できません。開始時にサーバーが対象を確認します。
      </p>
      <ol aria-label="各問の振り返り" class="space-y-5">
        <li v-for="(item, index) in items" :key="item.id">
          <UCard
            ><div class="space-y-4 break-words">
              <h2 class="text-lg font-semibold">
                問題 {{ index + 1 }}{{ item.body ? `: ${item.body}` : '' }}
              </h2>
              <p v-if="item.state === 'excluded'">
                {{
                  item.excludedReason === 'invalidated'
                    ? '不備確定のため集計から除外'
                    : '出題停止のため除外'
                }}
              </p>
              <template v-else-if="item.feedback">
                <p>
                  あなたの回答: {{ label(item, item.feedback.selectedIds) }}
                </p>
                <StudyFeedback
                  :correct="item.feedback.isCorrect"
                  :answer-label="label(item, item.feedback.answerIds)"
                  :explanation="item.feedback.explanation"
                  :quote="item.feedback.quote"
                  live
                />
              </template>
              <p v-else>
                {{
                  session.items.find((row) => row.id === item.id)?.skippedAt
                    ? 'スキップ済み・未回答'
                    : '未回答'
                }}（正解・解説は回答確定後に表示します）
              </p>
              <StudyReport
                v-if="item.state !== 'excluded'"
                :session-id="session.id"
                :item-id="item.id"
                :disabled="busy || starting"
                @forbidden="
                  clearSensitive();
                  forbidden = true;
                  error = 'この操作は許可されていません。';
                "
              /></div
          ></UCard>
        </li>
      </ol>
    </template>
    <div v-if="pendingKey && !forbidden" class="space-y-3">
      <p>前の復習開始要求が残っています。同じ受付を確認できます。</p>
      <UButton
        :disabled="starting || busy"
        :loading="starting"
        @click="startReview"
        >同じ復習要求を確認する</UButton
      >
    </div>
    <UButton to="/history" variant="link">履歴へ戻る</UButton>
  </LearnerShell>
</template>
