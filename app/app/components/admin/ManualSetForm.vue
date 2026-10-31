<script setup lang="ts">
import { contentValid } from '~/utils/admin-sets';
import type { CandidateContent } from '~/utils/admin-sets';
import { adminError, adminStatus } from '~/utils/admin-state';
import type { SourceDetail } from '~/utils/admin-state';
const props = defineProps<{ source: SourceDetail }>();
const emit = defineEmits<{ forbidden: [] }>();
const title = ref(`${props.source.title}の問題`);
function blank(): CandidateContent {
  return {
    body: '',
    choices: [
      { id: 'a', label: '' },
      { id: 'b', label: '' },
    ],
    answerIds: [],
    explanation: '',
    quote: '',
  };
}
const questions = ref([{ key: 1, content: blank() }]);
let nextKey = 2;
const saving = ref(false);
const error = ref('');
const receipt = ref<{
  key: string;
  body: { title: string; questions: CandidateContent[] };
} | null>(null);
const locked = computed(() => saving.value || receipt.value !== null);
let active = true;
onBeforeUnmount(() => {
  active = false;
});
function addChoice(content: CandidateContent) {
  if (locked.value || content.choices.length >= 6) return;
  content.choices.push({
    id: `c${crypto.randomUUID().slice(0, 8)}`,
    label: '',
  });
}
function removeChoice(content: CandidateContent, id: string) {
  if (locked.value || content.choices.length <= 2) return;
  content.choices = content.choices.filter((choice) => choice.id !== id);
  content.answerIds = content.answerIds.filter((value) => value !== id);
}
function toggle(
  content: CandidateContent,
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
  if (!locked.value && questions.value.length < 10)
    questions.value.push({ key: nextKey++, content: blank() });
}
async function save() {
  if (saving.value) return;
  error.value = '';
  if (!receipt.value) {
    if (!title.value.trim() || [...title.value.trim()].length > 200) {
      error.value = 'セット名を1〜200文字で入力してください。';
      return;
    }
    const invalid = questions.value.findIndex(
      ({ content }) => !contentValid(content),
    );
    if (invalid !== -1) {
      error.value = `問題 ${invalid + 1} を確認してください。問題文・解説・引用は1〜10,000文字、選択肢は2〜6件で各1〜2,000文字、正答は1件以上選択してください。`;
      return;
    }
    receipt.value = {
      key: crypto.randomUUID(),
      body: {
        title: title.value.trim(),
        questions: questions.value.map(({ content }) => ({
          ...content,
          choices: content.choices.map((choice) => ({ ...choice })),
          answerIds: [...content.answerIds],
        })),
      },
    };
  }
  saving.value = true;
  try {
    const result = await $fetch<{ setId: number }>(
      '/api/admin/sources/' + props.source.id + '/manual-sets',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': receipt.value.key },
        body: receipt.value.body,
        retry: 0,
      },
    );
    if (active) await navigateTo(`/admin/sets/${result.setId}`);
  } catch (cause) {
    if (!active) return;
    const status = adminStatus(cause);
    if (status === 403) {
      emit('forbidden');
      return;
    }
    if ([400, 413, 415].includes(status ?? 0)) {
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
    <UCard>
      <h2 class="text-lg font-semibold">元の教材：{{ source.title }}</h2>
      <details class="mt-3">
        <summary class="cursor-pointer">教材本文を確認する</summary>
        <p class="mt-3 whitespace-pre-wrap break-words">{{ source.body }}</p>
      </details>
    </UCard>
    <form class="space-y-6" @submit.prevent="save">
      <UFormField
        label="セット名"
        required
        help="学習ホームに表示する名前です。最大200文字。"
        ><UInput v-model="title" class="w-full" :disabled="locked"
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
          label="解説"
          required
          help="なぜその選択肢が正解かを記入します。"
          ><UTextarea
            v-model="entry.content.explanation"
            class="w-full"
            :rows="3"
            :disabled="locked"
        /></UFormField>
        <UFormField
          label="教材からの引用"
          required
          help="問題の根拠になる箇所を教材本文からコピーしてください。"
          ><UTextarea
            v-model="entry.content.quote"
            class="w-full"
            :rows="3"
            :disabled="locked"
        /></UFormField>
        <p
          v-if="
            entry.content.quote && !source.body.includes(entry.content.quote)
          "
          role="status"
        >
          引用が教材本文と一致しません。保存後の確認画面でも警告が表示されます。
        </p>
        <UButton
          v-if="questions.length > 1"
          variant="outline"
          color="neutral"
          :disabled="locked"
          :aria-label="`問題 ${index + 1} を削除`"
          @click="questions.splice(index, 1)"
          >この問題を削除</UButton
        >
      </section>
      <UButton
        variant="outline"
        :disabled="locked || questions.length >= 10"
        @click="addQuestion"
        >問題を追加（{{ questions.length }} / 10問）</UButton
      >
      <p>
        保存してもまだ公開されません。次の画面で各問題を確認し、採用して公開します。入力中の内容は、画面を離れたり再読み込みすると失われます。
      </p>
      <p v-if="receipt && !saving" role="status">
        保存結果が確認できるまでは入力を固定しています。再送しても同じ問題を重複登録しません。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="flex flex-wrap gap-3">
        <UButton type="submit" :loading="saving" :disabled="saving">{{
          receipt ? '同じ内容で保存結果を確認' : '下書きを保存して確認へ'
        }}</UButton>
        <UButton to="/admin/sets" variant="outline" color="neutral"
          >保存済みセットを確認する</UButton
        >
      </div>
    </form>
  </div>
</template>
