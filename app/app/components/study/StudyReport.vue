<script setup lang="ts">
import { studyError, studyStatus } from '~/utils/study-api';
import type { ReportReceipt } from '~/utils/report-api';
const props = defineProps<{
  sessionId: number;
  itemId: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ forbidden: [] }>();
const open = ref(false);
const message = ref('');
const pending = ref<string | null>(null);
const receipt = ref<ReportReceipt | null>(null);
const busy = ref(false);
const error = ref('');
let active = true;
onBeforeUnmount(() => {
  active = false;
});
async function submit() {
  if (busy.value || receipt.value || props.disabled) return;
  const text = pending.value ?? message.value.trim();
  if (!text || [...text].length > 2000) return;
  pending.value = text;
  busy.value = true;
  error.value = '';
  try {
    const result = await $fetch<ReportReceipt>(
      `/api/sessions/${props.sessionId}/items/${props.itemId}/reports`,
      {
        method: 'POST',
        body: { message: text },
        retry: 0,
      },
    );
    if (!active) return;
    receipt.value = result;
    pending.value = null;
  } catch (cause) {
    if (!active) return;
    error.value = studyError(cause);
    if ([400, 403, 404].includes(studyStatus(cause) ?? 0)) {
      pending.value = null;
      if (studyStatus(cause) === 403) {
        message.value = '';
        receipt.value = null;
        open.value = false;
        emit('forbidden');
      }
    }
  } finally {
    if (active) busy.value = false;
  }
}
</script>
<template>
  <UModal
    v-model:open="open"
    title="問題の不備を報告"
    description="報告だけでは出題や成績は変わりません。管理者が確認します。"
    :dismissible="!busy"
  >
    <UButton variant="link" :disabled="disabled" @click="open = true"
      >この問題の不備を報告</UButton
    >
    <template #body>
      <div class="space-y-4">
        <template v-if="receipt">
          <p role="status">
            {{
              receipt.replayed
                ? 'この版への未対応の報告を確認しました。'
                : '報告を受け付けました。'
            }}（報告 #{{ receipt.id }}）
          </p>
          <p>受付済みの内容:</p>
          <p class="whitespace-pre-wrap break-words">{{ receipt.message }}</p>
          <p v-if="receipt.message !== message.trim()">
            今回の入力とは異なる、既存の報告内容です。上書きしていません。
          </p>
          <p>
            未回答の問題は、演習画面の「この問題をスキップ」から学習を続けられます。
          </p>
        </template>
        <template v-else>
          <UFormField label="不備の理由" required>
            <UTextarea
              v-model="message"
              :disabled="busy || pending !== null"
              :maxlength="2000"
              :rows="5"
              class="w-full"
              placeholder="問題文・正解・解説など、気づいた点を記入してください。"
            />
          </UFormField>
          <p v-if="pending && !busy">
            受付結果を確認できません。同じ内容を再送して確認してください。ページを閉じると入力は失われます。
          </p>
          <p v-if="busy" role="status">報告の受付を確認中です。</p>
          <p v-if="error" role="alert">{{ error }}</p>
          <UButton
            :disabled="busy || !message.trim()"
            :loading="busy"
            @click="submit"
            >{{ pending ? '同じ報告を再送する' : '報告を送信する' }}</UButton
          >
        </template>
        <UButton variant="outline" :disabled="busy" @click="open = false"
          >閉じる</UButton
        >
      </div>
    </template>
  </UModal>
</template>
