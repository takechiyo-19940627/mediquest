<script setup lang="ts">
import { contentValid } from '~/utils/admin-sets';
import type { AdminCandidate, CandidateContent } from '~/utils/admin-sets';
const props = defineProps<{
  candidate: AdminCandidate;
  disabled: boolean;
  stale: boolean;
}>();
const emit = defineEmits<{
  save: [content: CandidateContent];
  cancel: [];
  rebase: [];
}>();
const content = reactive<CandidateContent>({
  body: props.candidate.body,
  choices: props.candidate.choices.map((value) => ({ ...value })),
  answerIds: [...props.candidate.answerIds],
  explanation: props.candidate.explanation,
  quote: props.candidate.quote,
});
const error = ref('');
function add() {
  if (content.choices.length < 6)
    content.choices.push({
      id: `c${crypto.randomUUID().slice(0, 8)}`,
      label: '',
    });
}
function remove(id: string) {
  if (content.choices.length <= 2) return;
  content.choices = content.choices.filter((choice) => choice.id !== id);
  content.answerIds = content.answerIds.filter((value) => value !== id);
}
function toggle(id: string, selected: boolean | 'indeterminate') {
  content.answerIds =
    selected === true
      ? [...new Set([...content.answerIds, id])]
      : content.answerIds.filter((value) => value !== id);
}
function save() {
  error.value = '';
  if (!contentValid(content)) {
    error.value =
      '問題文・解説・引用は1〜10,000文字、選択肢は2〜6件で各1〜2,000文字、正答は1件以上選択してください。';
    return;
  }
  emit('save', {
    ...content,
    choices: content.choices.map((value) => ({ ...value })),
    answerIds: [...content.answerIds],
  });
}
</script>
<template>
  <form
    class="space-y-4 border-t border-default pt-4"
    aria-label="候補の内容編集"
    @submit.prevent="save"
  >
    <h3 class="font-semibold">内容を編集</h3>
    <p>
      保存すると引用を再照合し、確認記録を取り消します。共有・公開済みの版は新しい派生版として保存し、旧版や過去回答を変更しません。
    </p>
    <p v-if="stale" role="alert">
      取得した最新状態と編集開始時の状態が異なります。入力は保持しています。保存済み内容を確認してから編集し直してください。
    </p>
    <UButton
      v-if="stale"
      variant="outline"
      :disabled="disabled"
      @click="emit('rebase')"
      >入力を破棄して最新内容から編集し直す</UButton
    >
    <UFormField label="問題文" required
      ><UTextarea
        v-model="content.body"
        class="w-full"
        :rows="4"
        :disabled="disabled"
    /></UFormField>
    <fieldset class="space-y-3">
      <legend>選択肢と正答（複数選択可）</legend>
      <div
        v-for="(choice, index) in content.choices"
        :key="choice.id"
        class="space-y-2"
      >
        <UFormField :label="`選択肢 ${index + 1}`" required
          ><UTextarea
            v-model="choice.label"
            class="w-full"
            :disabled="disabled"
        /></UFormField>
        <div class="flex flex-wrap items-center gap-3">
          <UCheckbox
            :model-value="content.answerIds.includes(choice.id)"
            :label="`選択肢 ${index + 1} を正答にする`"
            :disabled="disabled"
            @update:model-value="toggle(choice.id, $event)"
          />
          <UButton
            variant="outline"
            color="neutral"
            :disabled="disabled || content.choices.length <= 2"
            :aria-label="`選択肢 ${index + 1} を削除`"
            @click="remove(choice.id)"
            >削除</UButton
          >
        </div>
      </div>
      <UButton
        variant="outline"
        :disabled="disabled || content.choices.length >= 6"
        @click="add"
        >選択肢を追加</UButton
      >
    </fieldset>
    <UFormField label="解説" required
      ><UTextarea
        v-model="content.explanation"
        class="w-full"
        :rows="4"
        :disabled="disabled"
    /></UFormField>
    <UFormField label="教材からの引用" required
      ><UTextarea
        v-model="content.quote"
        class="w-full"
        :rows="3"
        :disabled="disabled"
    /></UFormField>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :disabled="disabled || stale">内容を保存</UButton
      ><UButton
        color="neutral"
        variant="outline"
        :disabled="disabled"
        @click="emit('cancel')"
        >編集を終了</UButton
      >
    </div>
  </form>
</template>
