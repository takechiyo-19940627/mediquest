<script setup lang="ts">
import { validCatalogId } from '~/utils/catalog-state';
import { studyStatus } from '~/utils/study-api';
import { reportStatus, reportError } from '~/utils/report-api';
import type { AdminReport } from '~/utils/report-api';
const route = useRoute();
const report = ref<AdminReport | null>(null);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const note = ref('');
const decision = ref<'confirmed' | 'dismissed'>('confirmed');
const pending = ref<{
  decision: 'confirmed' | 'dismissed';
  note: string;
} | null>(null);
let generation = 0;
let active = true;
const current = (token: number) => active && token === generation;
function fail(cause: unknown) {
  error.value = reportError(cause);
  if ([400, 403, 404].includes(studyStatus(cause) ?? 0)) {
    report.value = null;
    note.value = '';
    pending.value = null;
  }
}
async function load() {
  if (busy.value) return;
  const token = generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await $fetch<AdminReport>(
      `/api/admin/reports/${route.params.id}`,
      { retry: 0 },
    );
    if (!current(token)) return;
    report.value = result;
    if (result.status !== 'open') {
      if (pending.value)
        notice.value =
          result.status === pending.value.decision &&
          result.resolutionNote === pending.value.note
            ? '同じ判断が保存済みです。'
            : '別の判断が保存されています。保存済みの結果を確認してください。';
      pending.value = null;
    }
  } catch (cause) {
    if (current(token)) fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
async function resolve() {
  if (busy.value || report.value?.status !== 'open') return;
  const input = pending.value ?? {
    decision: decision.value,
    note: note.value.trim(),
  };
  if (!input.note || [...input.note].length > 2000) return;
  pending.value = input;
  const token = generation;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await $fetch(`/api/admin/reports/${report.value.id}/resolution`, {
      method: 'PUT',
      body: input,
      retry: 0,
    });
    if (!current(token)) return;
    notice.value = '判断を保存しました。最新の詳細を確認してください。';
    busy.value = false;
    await load();
  } catch (cause) {
    if (!current(token)) return;
    if (studyStatus(cause) === 409) {
      notice.value = '判断が競合しました。保存済みの結果を確認します。';
      busy.value = false;
      await load();
    } else fail(cause);
  } finally {
    if (current(token)) busy.value = false;
  }
}
function initialize() {
  generation++;
  busy.value = false;
  report.value = null;
  pending.value = null;
  note.value = '';
  notice.value = '';
  if (!validCatalogId(String(route.params.id))) {
    error.value = '報告を表示できません。';
    return;
  }
  void load();
}
onMounted(initialize);
watch(() => route.params.id, initialize);
onBeforeUnmount(() => {
  active = false;
  generation++;
});
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">不備報告の確認</h1>
    <p v-if="busy" role="status">報告の状態を確認中です。</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <UButton :disabled="busy" variant="outline" @click="load"
      >保存済みの判断を確認する</UButton
    >
    <template v-if="report">
      <h2 class="text-xl font-semibold">
        報告 #{{ report.id }} · {{ reportStatus[report.status] }}
      </h2>
      <p class="whitespace-pre-wrap break-words">{{ report.message }}</p>
      <p>対象の問題版 #{{ report.versionId }}</p>
      <UCard
        ><div class="space-y-4 break-words">
          <h3 class="text-lg font-semibold">{{ report.version.body }}</h3>
          <ul>
            <li v-for="choice in report.version.choices" :key="choice.id">
              {{ choice.label
              }}{{
                report.version.answerIds.includes(choice.id) ? '（正解）' : ''
              }}
            </li>
          </ul>
          <h4 class="font-semibold">AI解説</h4>
          <p class="whitespace-pre-wrap">{{ report.version.explanation }}</p>
          <h4 class="font-semibold">教材からの引用</h4>
          <blockquote
            class="border-l-4 border-primary pl-3 whitespace-pre-wrap"
          >
            {{ report.version.quote }}
          </blockquote>
          <p class="text-sm text-muted">
            引用の一致は、正解の妥当性を保証するものではありません。
          </p>
        </div></UCard
      >
      <p v-if="report.version.invalidatedAt">
        この版は不備による除外済みです。理由:
        {{ report.version.invalidationReason }}
      </p>
      <template v-if="report.status === 'open'">
        <p>
          不備確定はこの問題版を出題・集計から除外します。回答履歴は残ります。全版を停止する操作とは異なります。「問題なし」はこの報告を閉じ、すでに除外された版を復帰させません。
        </p>
        <UFormField label="判断"
          ><select
            v-model="decision"
            aria-label="判断"
            :disabled="busy || pending !== null"
            class="rounded border border-default bg-default p-2"
          >
            <option value="confirmed">不備確定</option>
            <option value="dismissed">問題なし</option>
          </select></UFormField
        >
        <UFormField label="判断の理由" required
          ><UTextarea
            v-model="note"
            :disabled="busy || pending !== null"
            :rows="4"
            :maxlength="2000"
            class="w-full"
        /></UFormField>
        <p v-if="pending">
          前の判断内容を保持しています。状態確認または同じ判断の再送ができます。
        </p>
        <UButton
          :disabled="busy || !note.trim()"
          :loading="busy"
          @click="resolve"
          >{{ pending ? '同じ判断を再送する' : 'この判断を確定する' }}</UButton
        >
      </template>
      <template v-else
        ><p>判断理由: {{ report.resolutionNote }}</p>
        <p>
          判断日時:
          {{
            report.resolvedAt
              ? new Date(report.resolvedAt).toLocaleString('ja-JP')
              : ''
          }}
        </p></template
      >
      <div class="flex flex-wrap gap-3">
        <UButton
          :to="`/admin/sources/${report.version.sourceId}`"
          variant="outline"
          >対象の教材を確認する</UButton
        ><UButton to="/admin/sets" variant="outline"
          >セットを選んで修正・改訂する</UButton
        >
      </div>
      <p class="text-sm text-muted">
        教材と問題版を照合して対象セットを選んでください。公開済みセットは改訂を作り、内容・引用を確認して公開します。
      </p>
    </template>
    <UButton to="/admin/reports" variant="link">未対応の報告へ戻る</UButton>
  </AdminShell>
</template>
