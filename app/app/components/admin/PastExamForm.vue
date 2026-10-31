<script setup lang="ts">
import type { PastExam, PastQuestion } from '~/utils/past-exams';
import { adminError, adminStatus } from '~/utils/admin-state';
const props = defineProps<{ exam?: PastExam }>();
const emit = defineEmits<{ forbidden: [] }>();
const examName = ref(props.exam?.examName ?? '');
const year = ref(props.exam?.year ?? '');
const subject = ref(props.exam?.subject ?? '');
const sourceReference = ref(props.exam?.sourceReference ?? '');
const confirmed = ref(false);
function blank(): PastQuestion {
  return {
    questionNumber: '1',
    body: '',
    choices: [
      { id: 'a', label: '' },
      { id: 'b', label: '' },
    ],
    answerIds: [],
    explanation: '',
  };
}
const questions = ref(
  (props.exam?.questions ?? [blank()]).map((content, index) => ({
    key: index + 1,
    content: JSON.parse(JSON.stringify(content)) as PastQuestion,
  })),
);
let nextKey = questions.value.length + 1;
const saving = ref(false);
const error = ref('');
const conflict = ref(false);
const recoveryText = computed(() =>
  JSON.stringify(receipt.value?.body ?? {}, null, 2),
);
function downloadInput() {
  const url = URL.createObjectURL(
    new Blob([recoveryText.value], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mediquest-past-exam-input.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const receipt = ref<{
  key: string;
  body: {
    examName: string;
    year: string;
    subject: string;
    sourceReference: string;
    confirmed: boolean;
    revision?: number;
    questions: PastQuestion[];
  };
} | null>(null);
const locked = computed(() => saving.value || receipt.value !== null);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
function addChoice(content: PastQuestion) {
  if (locked.value || content.choices.length >= 6) return;
  content.choices.push({
    id: `c${crypto.randomUUID().slice(0, 8)}`,
    label: '',
  });
}
function removeChoice(content: PastQuestion, id: string) {
  if (locked.value || content.choices.length <= 2) return;
  content.choices = content.choices.filter((choice) => choice.id !== id);
  content.answerIds = content.answerIds.filter((value) => value !== id);
}
function toggle(
  content: PastQuestion,
  id: string,
  selected: boolean | 'indeterminate',
) {
  if (locked.value) return;
  content.answerIds =
    selected === true
      ? [...new Set([...content.answerIds, id])]
      : content.answerIds.filter((value) => value !== id);
}
function addQuestion() {
  if (!locked.value && questions.value.length < 100)
    questions.value.push({
      key: nextKey++,
      content: {
        ...blank(),
        questionNumber: String(
          Math.max(
            0,
            ...questions.value.map(
              (q) => Number(q.content.questionNumber) || 0,
            ),
          ) + 1,
        ),
      },
    });
}
async function save() {
  if (saving.value || conflict.value) return;
  error.value = '';
  if (!receipt.value) {
    if (
      !examName.value.trim() ||
      !year.value.trim() ||
      !subject.value.trim() ||
      !confirmed.value
    ) {
      error.value =
        '試験名・年度・科目を入力し、正答の確認にチェックしてください。';
      return;
    }
    const invalid = questions.value.findIndex(
      ({ content }) =>
        !content.questionNumber.trim() ||
        !content.body.trim() ||
        content.choices.some((choice) => !choice.label.trim()) ||
        !content.answerIds.length,
    );
    if (invalid !== -1) {
      error.value = `問題 ${invalid + 1} を確認してください。問題番号・問題文・選択肢を入力し、正答を1件以上選択してください。`;
      return;
    }
    if (
      new Set(questions.value.map((q) => q.content.questionNumber.trim()))
        .size !== questions.value.length
    ) {
      error.value =
        '問題番号が重複しています。各問題に異なる番号を付けてください。';
      return;
    }
    receipt.value = {
      key: crypto.randomUUID(),
      body: {
        examName: examName.value.trim(),
        year: year.value.trim(),
        subject: subject.value.trim(),
        sourceReference: sourceReference.value.trim(),
        confirmed: true,
        ...(props.exam ? { revision: props.exam.revision } : {}),
        questions: questions.value.map(({ content }) => ({
          questionNumber: content.questionNumber,
          body: content.body,
          explanation: content.explanation,
          ...(content.originalQuestionVersionId
            ? { originalQuestionVersionId: content.originalQuestionVersionId }
            : {}),
          choices: content.choices.map((choice) => ({ ...choice })),
          answerIds: [...content.answerIds],
        })),
      },
    };
  }
  saving.value = true;
  try {
    const result = await $fetch<{ setId: number }>(
      props.exam
        ? `/api/admin/past-exams/${props.exam.id}/revisions`
        : '/api/admin/past-exams',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': receipt.value.key },
        body: receipt.value.body,
        retry: 0,
      },
    );
    if (active) await navigateTo(`/admin/past-exams/${result.setId}`);
  } catch (cause) {
    if (!active) return;
    const status = adminStatus(cause);
    if (status === 403) {
      emit('forbidden');
      return;
    }
    if (status === 409) {
      conflict.value = true;
      error.value =
        '別の更新が先に保存されたか、受付内容が競合しています。入力は保持しています。下のボタンで入力をファイルに保存してから、登録済みの過去問一覧で最新の内容を開いてください。保存したファイルの問題文や解説をコピーして再入力できます。';
    } else if ([400, 413, 415].includes(status ?? 0)) {
      receipt.value = null;
      error.value =
        '入力内容と文字数を確認してください。量が多い場合は問題を減らして保存してください。';
    } else {
      error.value = `${status === 503 ? '保存処理を利用できません。' : adminError(cause)} 入力は保持しています。「同じ内容で保存結果を確認」で再送してください。`;
    }
  } finally {
    if (active) saving.value = false;
  }
}
</script>
<template>
  <div class="space-y-5">
    <form class="space-y-6" @submit.prevent="save">
      <UFormField label="試験名" required
        ><UInput
          v-model="examName"
          class="w-full"
          placeholder="例：医療情報技師能力検定試験"
          :disabled="locked"
      /></UFormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="年度" required
          ><UInput
            v-model="year"
            class="w-full"
            placeholder="例：2025"
            :disabled="locked"
        /></UFormField>
        <UFormField label="科目" required
          ><UInput
            v-model="subject"
            class="w-full"
            placeholder="例：情報処理技術系"
            :disabled="locked"
        /></UFormField>
      </div>
      <UFormField
        label="出典メモ（任意）"
        help="過去問題集の名前や掲載ページなど。"
        ><UInput v-model="sourceReference" class="w-full" :disabled="locked"
      /></UFormField>
      <section
        v-for="(entry, index) in questions"
        :key="entry.key"
        :aria-labelledby="`manual-question-${entry.key}`"
        class="space-y-4 rounded-lg border border-default p-4"
      >
        <h2 :id="`manual-question-${entry.key}`" class="text-lg font-semibold">
          問題 {{ index + 1 }}
        </h2>
        <p v-if="entry.content.unavailable" role="status" class="text-warning">
          この問題は停止または不備確定のため出題されません。内容を修正しても出題対象には戻りません。不要であれば、この過去問から削除できます。
        </p>
        <UFormField label="問題番号" required
          ><UInput v-model="entry.content.questionNumber" :disabled="locked"
        /></UFormField>
        <UFormField label="問題文" required
          ><UTextarea
            v-model="entry.content.body"
            class="w-full"
            :rows="3"
            :disabled="locked"
        /></UFormField>
        <fieldset class="space-y-3" :disabled="locked">
          <legend class="mb-2">
            選択肢と正答（正しいものにチェック、複数可）
          </legend>
          <div
            v-for="(choice, choiceIndex) in entry.content.choices"
            :key="choice.id"
            class="space-y-2"
          >
            <UFormField :label="`選択肢 ${choiceIndex + 1}`" required
              ><UTextarea
                v-model="choice.label"
                class="w-full"
                :disabled="locked"
            /></UFormField>
            <div class="flex flex-wrap items-center gap-3">
              <UCheckbox
                :label="`選択肢 ${choiceIndex + 1} を正答にする`"
                :model-value="entry.content.answerIds.includes(choice.id)"
                :disabled="locked"
                @update:model-value="toggle(entry.content, choice.id, $event)"
              />
              <UButton
                variant="outline"
                color="neutral"
                :disabled="locked || entry.content.choices.length <= 2"
                :aria-label="`選択肢 ${choiceIndex + 1} を削除`"
                @click="removeChoice(entry.content, choice.id)"
                >削除</UButton
              >
            </div>
          </div>
          <UButton
            variant="outline"
            :disabled="locked || entry.content.choices.length >= 6"
            @click="addChoice(entry.content)"
            >選択肢を追加</UButton
          >
        </fieldset>
        <UFormField
          label="解説（任意）"
          help="空欄でも登録できます。後から追加できます。"
          ><UTextarea
            v-model="entry.content.explanation"
            class="w-full"
            :rows="3"
            :disabled="locked"
        /></UFormField>
        <UButton
          v-if="questions.length > 1"
          variant="outline"
          color="neutral"
          :disabled="locked"
          :aria-label="`問題 ${index + 1} を削除`"
          @click="questions.splice(index, 1)"
          >問題 {{ index + 1 }} を削除</UButton
        >
      </section>
      <UButton
        variant="outline"
        :disabled="locked || questions.length >= 100"
        @click="addQuestion"
        >問題を追加（{{ questions.length }} / 100問）</UButton
      >
      <p>
        登録するとすぐに演習できます。入力中の内容は、画面を離れたり再読み込みすると失われます。
      </p>
      <UCheckbox
        v-model="confirmed"
        label="問題文・選択肢・正答を確認しました"
        :disabled="locked"
      />
      <p v-if="receipt && !saving" role="status">
        保存結果が確認できるまでは入力を固定しています。再送しても同じ問題を重複登録しません。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div v-if="conflict" class="space-y-3">
        <UButton variant="outline" @click="downloadInput"
          >入力内容をファイルに保存</UButton
        >
        <details>
          <summary>コピー用の入力内容を表示</summary>
          <UTextarea
            :model-value="recoveryText"
            readonly
            class="mt-3 w-full"
            :rows="8"
            aria-label="競合した入力内容（コピー用）"
          />
        </details>
      </div>
      <div class="flex flex-wrap gap-3">
        <UButton
          v-if="!conflict"
          type="submit"
          :loading="saving"
          :disabled="saving"
          >{{
            receipt
              ? '同じ内容で保存結果を確認'
              : exam
                ? '修正を保存する'
                : '過去問を登録する'
          }}</UButton
        >
        <UButton to="/admin/past-exams" variant="outline" color="neutral"
          >登録済みの過去問を見る</UButton
        >
      </div>
    </form>
  </div>
</template>
