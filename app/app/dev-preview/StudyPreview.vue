<script setup lang="ts">
import StudyQuestion from '../components/study/StudyQuestion.vue';
import StudyFeedback from '../components/study/StudyFeedback.vue';
import {
  initialAnswer,
  selectAnswer,
  submitAnswer,
  finishSaving,
  nextAnswer,
} from '../utils/study-state';

// MEDIQUEST_DEVELOPMENT_STUDY_FIXTURE_ONLY: never register this page in production.
const questions = [
  {
    title: 'この練習画面で、回答を確定する操作はどれですか？',
    required: 1,
    choices: [
      { id: 'a', label: '選択肢を選んだ直後に自動で確定する' },
      { id: 'b', label: '選択後に「回答する」を押す' },
      { id: 'c', label: '画面を閉じる' },
    ],
    correct: ['b'],
    explanation: '選択した後も、回答するまでは選び直せます。',
    quote: '選択 → 回答する、の順に確定します。',
  },
  {
    title: 'この練習画面の操作について、正しいものを2つ選んでください。',
    required: 2,
    choices: [
      { id: 'a', label: '保存失敗時は選択が保持される' },
      { id: 'b', label: '保存完了後は自動で次の問題に進む' },
      { id: 'c', label: '「次へ」を押して次の問題に進む' },
    ],
    correct: ['a', 'c'],
    explanation:
      '保存失敗は再試行できます。解説を確認してから、自分で次に進みます。',
    quote: '失敗時は選択を保持し、自動で次へは進めません。',
  },
];
const index = ref(0);
const answer = ref(initialAnswer());
const failNext = ref(false);
const question = computed(() => questions[index.value]!);
const correct = computed(
  () =>
    answer.value.selected.length === question.value.correct.length &&
    question.value.correct.every((id) => answer.value.selected.includes(id)),
);
const correctLabel = computed(() =>
  question.value.choices
    .filter((choice) => question.value.correct.includes(choice.id))
    .map((choice) => choice.label)
    .join('、'),
);
let timeout: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timeout));
function submit() {
  const next = submitAnswer(answer.value, question.value.required);
  if (next === answer.value) return;
  answer.value = next;
  const success = !failNext.value;
  failNext.value = false;
  timeout = setTimeout(() => {
    answer.value = finishSaving(answer.value, success);
  }, 800);
}
function advance() {
  const next = nextAnswer(answer.value);
  if (next === answer.value) return;
  answer.value = next;
  index.value = (index.value + 1) % questions.length;
  nextTick(() => document.getElementById('preview-heading')?.focus());
}
</script>

<template>
  <main class="mx-auto max-w-3xl space-y-6 px-5 py-8">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="font-semibold text-primary">Mediquest · デザイン確認用</p>
        <h1 id="preview-heading" tabindex="-1" class="text-2xl font-semibold">
          演習画面のプレビュー
        </h1>
      </div>
      <ThemePicker />
    </div>
    <UAlert
      title="操作確認用・記録は保存されません"
      description="基準デザインは未確定です。教材の内容ではなく、画面の操作を確認するデモです。"
      color="warning"
      variant="soft"
    />
    <p class="text-muted">
      問題 {{ index + 1 }} /
      {{ questions.length }}（最後は最初のデモに戻ります）
    </p>
    <UCard>
      <StudyQuestion
        :key="index"
        :question="question"
        :answer="answer"
        @select="answer = selectAnswer(answer, $event, question.required)"
        @submit="submit"
        @next="advance"
      >
        <template #feedback
          ><StudyFeedback
            :correct="correct"
            :answer-label="correctLabel"
            :explanation="question.explanation"
            :quote="question.quote"
        /></template>
      </StudyQuestion>
    </UCard>
    <details class="rounded-lg border border-default p-4">
      <summary class="cursor-pointer font-semibold">保存失敗の動作確認</summary>
      <UCheckbox
        v-model="failNext"
        class="mt-3"
        :disabled="answer.save === 'saving'"
        label="次の模擬保存を1回だけ失敗させる"
      />
      <p class="mt-2 text-sm text-muted">
        チェックを入れて回答すると失敗を表示し、その後の再試行で成功します。
      </p>
    </details>
  </main>
</template>
