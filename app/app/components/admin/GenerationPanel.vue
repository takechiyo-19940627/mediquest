<script setup lang="ts">
import {
  adminError,
  adminStatus,
  parseReceipt,
  parseReceiptHistory,
} from '~/utils/admin-state';
import type { GenerationReceipt, GenerationRun } from '~/utils/admin-state';
const props = defineProps<{ sourceId: number; sourceTitle: string }>();
const emit = defineEmits<{ forbidden: [] }>();
const title = ref(props.sourceTitle);
const count = ref(5);
const receipt = ref<GenerationReceipt | null>(null);
const history = ref<GenerationReceipt[]>([]);
const run = ref<GenerationRun | null>(null);
const sending = ref(false);
const checking = ref(false);
const error = ref('');
const storageWarning = ref('');
const acknowledge = ref(false);
const ready = ref(false);
const needsCaution = ref(false);
let active = true;
let operation = 0;
let requestSequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const storageKey = `mediquest.generation.${props.sourceId}`;
const historyKey = `${storageKey}.history`;
const previousReceipts = computed(() =>
  history.value.filter((value) => value.key !== receipt.value?.key),
);
const statusLabel = computed(() => {
  if (!receipt.value) return '未受付';
  if (!run.value) return '状態不明（受付の応答を確認できていません）';
  return {
    running: '問題を生成中（running）',
    succeeded: '生成が完了しました',
    failed: '生成に失敗しました',
    unknown: '状態不明（生成結果を確認できません）',
  }[run.value.status];
});
function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function persist() {
  if (receipt.value) {
    const current = receipt.value;
    const index = history.value.findIndex((value) => value.key === current.key);
    if (index < 0) history.value.push({ ...current });
    else history.value[index] = { ...current };
  }
  try {
    sessionStorage.setItem(historyKey, JSON.stringify(history.value));
    if (receipt.value)
      sessionStorage.setItem(storageKey, JSON.stringify(receipt.value));
    storageWarning.value = '';
  } catch {
    storageWarning.value =
      'このタブに受付を保存できません。再読み込みせず「同じ受付を確認」を使ってください。';
  }
}
function deny() {
  stopPolling();
  operation++;
  requestSequence++;
  receipt.value = null;
  history.value = [];
  run.value = null;
  title.value = '';
  error.value = '';
  storageWarning.value = '';
  try {
    sessionStorage.removeItem(storageKey);
    sessionStorage.removeItem(historyKey);
  } catch {
    /* No storage access. */
  }
  emit('forbidden');
}
function schedule() {
  stopPolling();
  if (active && run.value?.status === 'running')
    timer = setTimeout(() => {
      void check();
    }, 3000);
}
async function request(post: boolean, background = false) {
  const current = receipt.value;
  if (!current) return;
  const epoch = operation;
  const sequence = ++requestSequence;
  stopPolling();
  if (!background) error.value = '';
  try {
    const result = post
      ? await $fetch<GenerationRun>(
          `/api/admin/sources/${props.sourceId}/generations`,
          {
            method: 'POST',
            body: {
              title: current.title,
              requestedCount: current.requestedCount,
            },
            headers: { 'Idempotency-Key': current.key },
            retry: 0,
          },
        )
      : await $fetch<GenerationRun>(`/api/admin/generations/${current.runId}`, {
          retry: 0,
        });
    if (!active || epoch !== operation || sequence !== requestSequence) return;
    if (result.sourceId !== undefined && result.sourceId !== props.sourceId) {
      error.value = 'この教材の受付を確認できません。';
      return;
    }
    receipt.value = { ...current, runId: result.id };
    persist();
    run.value = result;
    // POST receipts lack timestamps; read the status DTO before reporting the update time.
    if (post) {
      await request(false, true);
      return;
    }
    schedule();
  } catch (cause) {
    if (!active || epoch !== operation || sequence !== requestSequence) return;
    if (adminStatus(cause) === 403) {
      deny();
      return;
    }
    error.value = adminError(cause);
    // A failed lookup says nothing about the server's outcome. Keep the receipt,
    // but remove the stale status rather than reporting it as current.
    run.value = null;
  }
}
async function check() {
  if (checking.value || !receipt.value) return;
  checking.value = true;
  try {
    await request(!receipt.value.runId);
  } finally {
    if (active) {
      checking.value = false;
      if (receipt.value?.runId) sending.value = false;
    }
  }
}
async function start() {
  if (
    !ready.value ||
    sending.value ||
    ((receipt.value || needsCaution.value) && !acknowledge.value)
  )
    return;
  if (
    !title.value.trim() ||
    [...title.value.trim()].length > 200 ||
    !Number.isInteger(Number(count.value)) ||
    Number(count.value) < 1 ||
    Number(count.value) > 10
  ) {
    error.value = 'セット名は1〜200文字、問数は1〜10の整数で指定してください。';
    return;
  }
  const epoch = ++operation;
  stopPolling();
  receipt.value = {
    sourceId: props.sourceId,
    key: crypto.randomUUID(),
    title: title.value.trim(),
    requestedCount: Number(count.value),
  };
  run.value = null;
  acknowledge.value = false;
  persist();
  sending.value = true;
  try {
    await request(true);
  } finally {
    if (active && operation === epoch) sending.value = false;
  }
}
async function selectReceipt(value: GenerationReceipt) {
  operation++;
  requestSequence++;
  stopPolling();
  receipt.value = { ...value };
  run.value = null;
  sending.value = false;
  checking.value = false;
  acknowledge.value = false;
  title.value = value.title;
  count.value = value.requestedCount;
  error.value = '';
  persist();
  await check();
}
onMounted(() => {
  try {
    const raw = sessionStorage.getItem(storageKey);
    const storedHistory = parseReceiptHistory(
      sessionStorage.getItem(historyKey),
      props.sourceId,
    );
    if (storedHistory) history.value = storedHistory;
    else {
      needsCaution.value = true;
      error.value =
        '保存された過去の受付を読み取れません。以前の処理が継続・完了している可能性があります。';
    }
    receipt.value = parseReceipt(raw, props.sourceId);
    if (raw && !receipt.value) {
      needsCaution.value = true;
      error.value =
        '保存された受付を読み取れません。以前の処理が完了している可能性があります。新しい試行は重複生成・追加課金になる場合があります。';
      sessionStorage.removeItem(storageKey);
    }
    if (receipt.value) {
      if (!history.value.some((value) => value.key === receipt.value!.key))
        history.value.push({ ...receipt.value });
      title.value = receipt.value.title;
      count.value = receipt.value.requestedCount;
      // GET is read-only. An unknown receipt is replayed only by an explicit click.
      if (receipt.value.runId) void check();
    }
  } catch {
    needsCaution.value = true;
    storageWarning.value =
      'このタブの受付を読み取れません。以前の生成がある場合、新しい生成を始める前に受付を確認してください。';
  }
  ready.value = true;
});
onBeforeUnmount(() => {
  active = false;
  operation++;
  requestSequence++;
  stopPolling();
});
</script>
<template>
  <UCard>
    <div class="space-y-5">
      <h2 class="text-xl font-semibold">問題を生成</h2>
      <p>生成結果は下書きです。内容を確認するまで学習者には公開されません。</p>
      <section
        v-if="receipt"
        aria-label="生成受付"
        class="space-y-3 border-t border-default pt-4"
      >
        <h3 class="font-semibold" role="status">{{ statusLabel }}</h3>
        <p class="break-words">
          受付したセット: {{ receipt.title }}（{{ receipt.requestedCount }}問）
        </p>
        <p class="break-all">受付キー: {{ receipt.key }}</p>
        <p v-if="run?.updatedAt">
          状態更新日時: {{ new Date(run.updatedAt).toLocaleString('ja-JP') }}
        </p>
        <p v-if="run?.status === 'running'">
          runningは処理の生存を保証しません。プロセス停止後の自動再開や、時間経過による失敗判定は行いません。
        </p>
        <p v-if="run?.status === 'succeeded'">
          作成した下書きセット: #{{
            run.setId
          }}。内容を確認してから公開してください。
        </p>
        <UButton
          v-if="run?.status === 'succeeded'"
          :to="`/admin/sets/${run.setId}`"
          variant="outline"
          >下書きセットを確認</UButton
        >
        <p v-if="run?.status === 'failed'">
          教材は保存されています。原因を確認してから、必要に応じて新しい試行を開始できます。
        </p>
        <UButton
          variant="outline"
          :disabled="checking"
          :loading="checking"
          @click="check"
          >同じ受付を確認</UButton
        >
        <p>
          状態照会と新しい生成は別の操作です。応答を受け取れていない場合は、画面の入力変更にかかわらず、受付時と同じ内容・同じキーで確認します。
        </p>
      </section>
      <section
        v-if="previousReceipts.length"
        aria-label="過去の生成受付"
        class="space-y-3"
      >
        <h3 class="font-semibold">過去の生成受付</h3>
        <p>
          新しい試行の後も、以前の受付を切り替えて確認できます。現在表示中の受付とは別の処理です。
        </p>
        <ul class="space-y-3">
          <li
            v-for="previous in previousReceipts"
            :key="previous.key"
            class="space-y-2"
          >
            <p class="break-words">
              {{ previous.title }}（{{ previous.requestedCount }}問）
            </p>
            <p class="break-all text-sm">受付キー: {{ previous.key }}</p>
            <UButton
              variant="outline"
              :aria-label="`${previous.title}の受付を確認`"
              @click="selectReceipt(previous)"
              >この受付を確認</UButton
            >
          </li>
        </ul>
      </section>
      <form class="space-y-4" @submit.prevent="start">
        <UFormField label="セット名" name="setTitle" required
          ><UInput v-model="title" class="w-full" :disabled="sending"
        /></UFormField>
        <UFormField label="問数" name="requestedCount" required
          ><UInput
            v-model="count"
            type="number"
            :min="1"
            :max="10"
            :step="1"
            :disabled="sending"
        /></UFormField>
        <template v-if="receipt || needsCaution">
          <p>
            新しい試行では別の受付キーを使います。以前の処理が外部で継続し、後から完了する可能性があります。重複生成や追加課金が発生する場合があります。
          </p>
          <UCheckbox
            v-model="acknowledge"
            label="以前の処理が続く可能性と追加課金を理解して、新しい試行を開始する"
            :disabled="sending"
          />
        </template>
        <UButton
          type="submit"
          :disabled="
            !ready ||
            sending ||
            Boolean((receipt || needsCaution) && !acknowledge)
          "
          :loading="sending"
          >{{ receipt ? '新しい試行を開始' : '生成する' }}</UButton
        >
      </form>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="storageWarning" role="alert">{{ storageWarning }}</p>
      <p class="text-sm text-muted">
        現在と過去の受付キー・セット名・問数・受付IDのみをこのタブに保存し、再読み込み後に復元します。教材本文や認証情報は保存しません。タブを閉じると復元できなくなる場合があります。
      </p>
    </div>
  </UCard>
</template>
