<script setup lang="ts">
import { validCatalogId } from '~/utils/catalog-state';
import { initialAnswer, selectAnswer } from '~/utils/study-state';
import { studyError, studyStatus } from '~/utils/study-api';
import type { StudyItem, StudySummary } from '~/utils/study-api';

const route = useRoute();
const session = ref<StudySummary | null>(null);
const item = ref<StudyItem | null>(null);
const answer = ref(initialAnswer());
const busy = ref(false);
const error = ref('');
const notice = ref('');
let generation = 0;
let active = true;
const question = computed(() =>
  item.value?.body !== undefined
    ? {
        title: item.value.body,
        choices: item.value.choices!,
        required: item.value.requiredSelectionCount!,
      }
    : null,
);
const answerLabel = computed(
  () =>
    item.value?.choices
      ?.filter((choice) => item.value?.feedback?.answerIds.includes(choice.id))
      .map((choice) => choice.label)
      .join('、') ?? '',
);
const saveMessage = computed(() => {
  if (answer.value.save === 'saving') return '回答を保存中です。';
  if (answer.value.save === 'saved') return '回答は保存済みです。';
  if (answer.value.save === 'failed')
    return '保存結果を確認してください。選択を保持しています。';
  return undefined;
});
function current(token: number) {
  return active && token === generation;
}
function accept(value: StudyItem) {
  item.value = value;
  answer.value = value.feedback
    ? { selected: value.feedback.selectedIds, save: 'saved' }
    : initialAnswer();
}
function fail(cause: unknown) {
  error.value = studyError(cause);
  if ([400, 403, 404].includes(studyStatus(cause) ?? 0)) {
    session.value = null;
    item.value = null;
    answer.value = initialAnswer();
  }
}
async function focusHeading() {
  await nextTick();
  document.getElementById('study-heading')?.focus();
}
async function resume() {
  const token = ++generation;
  item.value = null;
  session.value = null;
  answer.value = initialAnswer();
  error.value = '';
  notice.value = '';
  busy.value = true;
  const id = String(route.params.id);
  if (!validCatalogId(id)) {
    error.value = 'この演習または問題を表示できません。';
    busy.value = false;
    return;
  }
  try {
    const value = await $fetch<StudySummary>(`/api/sessions/${id}/resume`, {
      method: 'POST',
      body: {},
      retry: 0,
    });
    if (!current(token)) return;
    session.value = value;
    if (value.currentItemId !== null) {
      const next = await $fetch<StudyItem>(
        `/api/sessions/${id}/items/${value.currentItemId}`,
        { retry: 0 },
      );
      if (!current(token)) return;
      accept(next);
    }
    await focusHeading();
  } catch (cause) {
    if (current(token)) fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function submit() {
  if (
    busy.value ||
    !item.value ||
    !question.value ||
    answer.value.save === 'saved' ||
    answer.value.selected.length !== question.value.required
  )
    return;
  const token = generation;
  const id = session.value!.id;
  const itemId = item.value.id;
  const selectedIds = [...answer.value.selected];
  busy.value = true;
  error.value = '';
  notice.value = '';
  answer.value = { selected: selectedIds, save: 'saving' };
  try {
    const result = await $fetch<{ item: StudyItem; session: StudySummary }>(
      `/api/sessions/${id}/items/${itemId}/answer`,
      {
        method: 'POST',
        body: { selectedIds },
        retry: 0,
      },
    );
    if (!current(token)) return;
    session.value = result.session;
    accept(result.item);
  } catch (cause) {
    if (!current(token)) return;
    answer.value = { selected: selectedIds, save: 'failed' };
    fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function verify() {
  if (busy.value || !session.value || !item.value) return;
  const token = generation;
  const id = session.value.id;
  const itemId = item.value.id;
  busy.value = true;
  error.value = '';
  try {
    const saved = await $fetch<StudyItem>(
      `/api/sessions/${id}/items/${itemId}`,
      { retry: 0 },
    );
    const state = await $fetch<StudySummary>(`/api/sessions/${id}`, {
      retry: 0,
    });
    if (!current(token)) return;
    session.value = state;
    if (saved.feedback || saved.state === 'excluded') accept(saved);
    else
      notice.value =
        'この回答はまだ保存されていません。同じ選択で保存を再試行できます。';
  } catch (cause) {
    if (current(token)) fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function skip() {
  if (
    busy.value ||
    !session.value ||
    !item.value ||
    answer.value.save !== 'editing'
  )
    return;
  const token = generation;
  busy.value = true;
  error.value = '';
  try {
    await $fetch(
      `/api/sessions/${session.value.id}/items/${item.value.id}/skip`,
      { method: 'POST', body: {}, retry: 0 },
    );
    if (!current(token)) return;
    busy.value = false;
    await resume();
    if (active)
      notice.value =
        'スキップしました。未回答のまま保持され、通常の未回答の後に戻ります。';
  } catch (cause) {
    if (current(token)) fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
onMounted(resume);
watch(() => route.params.id, resume);
onBeforeUnmount(() => {
  active = false;
  generation++;
});
</script>

<template>
  <LearnerShell>
    <h1 id="study-heading" tabindex="-1" class="text-2xl font-semibold">
      問題演習
    </h1>
    <p v-if="busy && !item" role="status">保存済みの進捗を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton v-if="!item" :disabled="busy" @click="resume"
        >再読み込み</UButton
      >
    </div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="session">
      <p>
        回答済み {{ session.statistics.answeredEligibleCount }} /
        {{ session.statistics.eligibleCount }}問
      </p>
      <p v-if="session.statistics.excludedCount" role="status">
        停止または不備により
        {{ session.statistics.excludedCount }}問を除外しています。
      </p>
      <template v-if="question && item">
        <p v-if="item.questionNumber" class="text-muted">
          過去問の問題番号：{{ item.questionNumber }}
        </p>
        <StudyQuestion
          :question="question"
          :answer="answer"
          :busy="busy"
          :save-message="saveMessage"
          @select="
            (id) => {
              if (!busy) answer = selectAnswer(answer, id, question!.required);
            }
          "
          @submit="submit"
          @next="resume"
        >
          <template #feedback>
            <StudyFeedback
              v-if="item.feedback"
              :correct="item.feedback.isCorrect"
              :answer-label="answerLabel"
              :explanation="item.feedback.explanation"
              :quote="item.feedback.quote"
              live
            />
          </template>
        </StudyQuestion>
        <StudyReport
          :key="item.id"
          :session-id="session.id"
          :item-id="item.id"
          :disabled="busy"
          @forbidden="fail({ statusCode: 403 })"
        />
        <UButton
          v-if="answer.save === 'editing'"
          variant="outline"
          :disabled="busy"
          @click="skip"
          >この問題をスキップ</UButton
        >
        <UButton
          v-if="answer.save === 'failed' || error"
          variant="outline"
          :disabled="busy"
          @click="verify"
          >保存状態を確認する</UButton
        >
      </template>
      <div
        v-else-if="item?.state === 'excluded'"
        role="status"
        class="space-y-3"
      >
        <p>
          {{
            item.excludedReason === 'invalidated'
              ? '不備が確定したため、この問題は除外されました。'
              : '出題停止により、この問題は除外されました。'
          }}
        </p>
        <UButton :disabled="busy" @click="resume">次の問題を確認する</UButton>
      </div>
      <UCard v-else-if="!busy && session.status === 'completed'">
        <h2 class="text-xl font-semibold">演習が完了しました</h2>
        <UButton :to="`/sessions/${session.id}/result`">結果を見る</UButton>
        <p v-if="session.statistics.eligibleCount === 0">集計対象なし</p>
        <p v-else>
          正答 {{ session.statistics.correctEligibleCount }} /
          {{ session.statistics.eligibleCount }}問
        </p>
      </UCard>
      <UButton v-if="session.status === 'in_progress'" to="/" variant="outline"
        >中断してホームへ</UButton
      >
      <p v-if="session.status === 'in_progress'" class="text-sm text-muted">
        確定済みの回答は保存されています。このページのURLから再開できます。未確定の選択は保存されません。
      </p>
    </template>
    <UButton
      v-if="!session || session.status === 'completed'"
      to="/"
      variant="link"
      >ホームへ戻る</UButton
    >
  </LearnerShell>
</template>
