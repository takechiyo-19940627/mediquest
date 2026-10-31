<script setup lang="ts">
import { adminStatus, validAdminId } from '~/utils/admin-state';
import {
  selectionPublishable,
  setError,
  setStatusLabel,
} from '~/utils/admin-sets';
import type {
  AdminCandidate,
  AdminSetDetail,
  CandidateContent,
} from '~/utils/admin-sets';
const route = useRoute();
const detail = ref<AdminSetDetail | null>(null);
const loading = ref(true);
const busy = ref(false);
const needsRefresh = ref(false);
const error = ref('');
const notice = ref('');
const selected = ref<number[]>([]);
const reviewed = ref<Record<number, boolean>>({});
const mismatch = ref<Record<number, boolean>>({});
const stopAcknowledged = ref<Record<number, boolean>>({});
const stopped = ref<number[]>([]);
const publishAcknowledged = ref(false);
const archiveAcknowledged = ref(false);
const editor = ref<{
  candidate: AdminCandidate;
  revision: number;
  key: number;
} | null>(null);
const cloneTitle = ref('');
const cloneDescription = ref('');
const cloneAcknowledged = ref(false);
const cloneReceipt = ref<{
  requestKey: string;
  expectedRevision: number;
  title: string;
  description: string;
} | null>(null);
let editorKey = 0;
let epoch = 0;
let fetchSequence = 0;
let active = true;
const orderChanged = computed(() =>
  Boolean(
    detail.value &&
    (selected.value.length !== detail.value.items.length ||
      selected.value.some(
        (id, index) => id !== detail.value!.items[index]?.versionId,
      )),
  ),
);
const blocked = computed(
  () => loading.value || busy.value || needsRefresh.value,
);
const editingAllowed = computed(
  () => detail.value?.status === 'draft' && detail.value.publishedAt === null,
);
const editorStale = computed(() => {
  if (!editor.value || !detail.value) return false;
  const current = detail.value.candidates.find(
    (value) => value.questionId === editor.value!.candidate.questionId,
  );
  return (
    editor.value.revision !== detail.value.revision ||
    current?.id !== editor.value.candidate.id ||
    current.fingerprint !== editor.value.candidate.fingerprint
  );
});
const publishable = computed(() =>
  Boolean(
    detail.value &&
    !editor.value &&
    selectionPublishable(detail.value, selected.value),
  ),
);
function clearPrivate() {
  detail.value = null;
  editor.value = null;
  selected.value = [];
  stopped.value = [];
  reviewed.value = {};
  mismatch.value = {};
  stopAcknowledged.value = {};
  cloneReceipt.value = null;
  cloneTitle.value = '';
  cloneDescription.value = '';
  notice.value = '';
}
async function load(reset = false): Promise<boolean> {
  const identity = epoch;
  const sequence = ++fetchSequence;
  if (reset) clearPrivate();
  loading.value = true;
  error.value = '';
  const id = String(route.params.id);
  if (!validAdminId(id)) {
    error.value = 'セットが見つかりません。';
    loading.value = false;
    return false;
  }
  try {
    const result = await $fetch<AdminSetDetail>(`/api/admin/sets/${id}`, {
      retry: 0,
    });
    if (!active || identity !== epoch || sequence !== fetchSequence)
      return false;
    detail.value = result;
    selected.value = result.items.map((item) => item.versionId);
    for (const item of result.items)
      if (
        item.questionStatus === 'stopped' &&
        !stopped.value.includes(item.questionId)
      )
        stopped.value.push(item.questionId);
    reviewed.value = {};
    mismatch.value = {};
    stopAcknowledged.value = {};
    publishAcknowledged.value = false;
    archiveAcknowledged.value = false;
    if (!cloneReceipt.value) {
      cloneTitle.value = result.title;
      cloneDescription.value = result.description;
    }
    needsRefresh.value = false;
    return true;
  } catch (cause) {
    if (!active || identity !== epoch || sequence !== fetchSequence)
      return false;
    error.value = setError(cause);
    needsRefresh.value = true;
    if (adminStatus(cause) === 403) clearPrivate();
    return false;
  } finally {
    if (active && identity === epoch && sequence === fetchSequence)
      loading.value = false;
  }
}
async function refresh() {
  if (await load())
    notice.value =
      '最新状態を取得しました。保存内容と操作結果を確認してください。';
}
async function mutate(
  path: string,
  method: 'PUT' | 'POST',
  body: Record<string, unknown>,
  success: string,
  done?: () => void,
) {
  if (blocked.value) return;
  const identity = epoch;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await $fetch(path, { method, body, retry: 0 });
    if (!active || identity !== epoch) return;
    done?.();
    if (await load()) notice.value = success;
  } catch (cause) {
    if (!active || identity !== epoch) return;
    error.value = `${setError(cause)} 保存完了とは判断せず、最新状態を取得して確認してください。`;
    needsRefresh.value = true;
    if (adminStatus(cause) === 403) clearPrivate();
  } finally {
    if (active && identity === epoch) busy.value = false;
  }
}
function edit(candidate: AdminCandidate) {
  if (blocked.value || orderChanged.value || !detail.value) return;
  editor.value = {
    candidate: structuredClone(toRaw(candidate)),
    revision: detail.value.revision,
    key: ++editorKey,
  };
  notice.value = '';
}
function rebase() {
  const current = detail.value?.candidates.find(
    (value) => value.questionId === editor.value?.candidate.questionId,
  );
  if (current) edit(current);
}
async function saveContent(content: CandidateContent) {
  if (!editor.value || !detail.value || editorStale.value) return;
  const value = editor.value;
  editor.value = { ...value, candidate: { ...value.candidate, ...content } };
  await mutate(
    `/api/admin/sets/${detail.value.id}/versions/${value.candidate.id}/content`,
    'PUT',
    {
      expectedRevision: value.revision,
      expectedFingerprint: value.candidate.fingerprint,
      ...content,
    },
    '内容を保存しました。変更した問題は再確認が必要です。',
    () => {
      editor.value = null;
    },
  );
}
async function confirm(candidate: AdminCandidate) {
  if (
    !detail.value ||
    !reviewed.value[candidate.id] ||
    (!candidate.quoteVerified && !mismatch.value[candidate.id])
  )
    return;
  await mutate(
    `/api/admin/sets/${detail.value.id}/versions/${candidate.id}/review`,
    'PUT',
    {
      fingerprint: candidate.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: mismatch.value[candidate.id] === true,
    },
    '内容の確認を記録しました。',
  );
}
function select(id: number, value: boolean | 'indeterminate') {
  if (value === true && selected.value.length < 10)
    selected.value = [...selected.value, id];
  else if (value !== true)
    selected.value = selected.value.filter((value) => value !== id);
}
function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= selected.value.length) return;
  const next = [...selected.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  selected.value = next;
}
async function saveOrder() {
  if (!detail.value) return;
  await mutate(
    `/api/admin/sets/${detail.value.id}/items`,
    'PUT',
    {
      expectedRevision: detail.value.revision,
      versionIds: [...selected.value],
    },
    '採用する問題と順序を保存しました。',
  );
}
async function publish() {
  if (!detail.value || !publishable.value || !publishAcknowledged.value) return;
  await mutate(
    `/api/admin/sets/${detail.value.id}/publish`,
    'POST',
    {
      expectedRevision: detail.value.revision,
      publishFingerprint: detail.value.publishFingerprint,
      confirmed: true,
    },
    'セットを公開しました。',
  );
}
async function archive() {
  if (!detail.value || !archiveAcknowledged.value) return;
  await mutate(
    `/api/admin/sets/${detail.value.id}/archive`,
    'POST',
    {},
    'セットの新規演習開始を停止しました。',
  );
}
async function stop(candidate: AdminCandidate) {
  if (!stopAcknowledged.value[candidate.questionId]) return;
  await mutate(
    `/api/admin/questions/${candidate.questionId}/stop`,
    'POST',
    {},
    'この問題の全版の出題を停止しました。',
    () => {
      stopped.value.push(candidate.questionId);
    },
  );
}
async function clone() {
  if (
    !detail.value ||
    blocked.value ||
    (!cloneReceipt.value && !cloneAcknowledged.value)
  )
    return;
  if (!cloneReceipt.value) {
    if (
      !cloneTitle.value.trim() ||
      [...cloneTitle.value.trim()].length > 200 ||
      [...cloneDescription.value].length > 2000
    ) {
      error.value =
        '改訂セット名は1〜200文字、説明は2,000文字以内で入力してください。';
      return;
    }
    cloneReceipt.value = {
      requestKey: crypto.randomUUID(),
      expectedRevision: detail.value.revision,
      title: cloneTitle.value.trim(),
      description: cloneDescription.value,
    };
  }
  const identity = epoch;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await $fetch<{ id: number }>(
      `/api/admin/sets/${detail.value.id}/revisions`,
      { method: 'POST', body: cloneReceipt.value, retry: 0 },
    );
    if (active && identity === epoch)
      await navigateTo(`/admin/sets/${result.id}`);
  } catch (cause) {
    if (!active || identity !== epoch) return;
    error.value = setError(cause);
    if (adminStatus(cause) === 403) clearPrivate();
    else if ([400, 409].includes(adminStatus(cause) ?? 0)) {
      cloneReceipt.value = null;
      needsRefresh.value = true;
    } else
      error.value +=
        ' 改訂受付を保持しています。同じ受付を再確認してください。';
  } finally {
    if (active && identity === epoch) busy.value = false;
  }
}
function initialize() {
  epoch++;
  busy.value = false;
  needsRefresh.value = false;
  cloneAcknowledged.value = false;
  void load(true);
}
onMounted(initialize);
watch(() => route.params.id, initialize);
onBeforeUnmount(() => {
  active = false;
  epoch++;
  fetchSequence++;
});
</script>
<template>
  <AdminShell>
    <p v-if="loading" role="status">セットを読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton variant="outline" :disabled="loading || busy" @click="refresh"
        >最新状態を確認</UButton
      >
    </div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="detail">
      <h1 class="break-words text-2xl font-semibold">{{ detail.title }}</h1>
      <p>
        状態: {{ setStatusLabel[detail.status] }} · セット #{{ detail.id }} ·
        更新番号 {{ detail.revision }}
      </p>
      <p class="whitespace-pre-wrap break-words">{{ detail.description }}</p>
      <UButton :to="`/admin/sources/${detail.sourceId}`" variant="link"
        >元の教材を確認</UButton
      >
      <p v-if="detail.supersedesSetId">
        改訂元:
        <NuxtLink
          :to="`/admin/sets/${detail.supersedesSetId}`"
          class="text-primary underline"
          >セット #{{ detail.supersedesSetId }}</NuxtLink
        >。改訂公開時に元セットの公開停止と新セットの公開を同時に行います。旧版・過去回答は保持します。
      </p>
      <p>
        引用一致は教材との文字列照合です。正答の妥当性や医学的な正しさを保証しません。
      </p>
      <p v-if="orderChanged" role="status">
        採用する問題・順序は未保存です。保存または取り消してから他の操作を行ってください。
      </p>
      <p v-if="!detail.candidates.length">
        候補がまだありません。教材画面で問題を作成するか、生成受付の状態を確認してください。
      </p>
      <section
        v-for="(candidate, index) in detail.candidates"
        :key="candidate.id"
        :aria-label="`候補 ${index + 1}`"
      >
        <UCard
          ><div class="space-y-4 break-words">
            <h2 class="text-xl font-semibold">
              候補 {{ index + 1 }} · 問題 #{{ candidate.questionId }} / 版
              {{ candidate.versionNo }}
            </h2>
            <p v-if="candidate.manualCreatedBy != null">手動登録した問題</p>
            <p>
              {{
                candidate.reviewedAt !== null && candidate.reviewedBy !== null
                  ? '確認済み'
                  : '未確認'
              }}<span v-if="stopped.includes(candidate.questionId)">
                · 全版出題停止</span
              >
            </p>
            <p
              v-if="
                detail.items.some(
                  (item) =>
                    item.versionId === candidate.id &&
                    item.invalidatedAt !== null,
                )
              "
            >
              この版は不備確定済みです。公開には修正した版の再確認、または採用からの除外が必要です。
            </p>
            <h3 class="font-semibold">問題文</h3>
            <p class="whitespace-pre-wrap">{{ candidate.body }}</p>
            <ol class="space-y-2">
              <li
                v-for="(choice, choiceIndex) in candidate.choices"
                :key="choice.id"
              >
                <span class="font-semibold">{{ choiceIndex + 1 }}. </span
                >{{ choice.label
                }}<span
                  v-if="candidate.answerIds.includes(choice.id)"
                  class="font-semibold"
                  >（正答）</span
                >
              </li>
            </ol>
            <p>正答数: {{ candidate.answerIds.length }}</p>
            <h3 class="font-semibold">解説</h3>
            <p class="whitespace-pre-wrap">{{ candidate.explanation }}</p>
            <h3 class="font-semibold">教材からの引用</h3>
            <blockquote
              class="whitespace-pre-wrap border-l-4 border-default pl-4"
            >
              {{ candidate.quote }}
            </blockquote>
            <p>
              {{
                candidate.quoteVerified
                  ? '教材本文に引用が一致しています。正答の保証ではありません。'
                  : '引用が教材本文に一致していません。引用と内容を確認してください。'
              }}
            </p>
            <template v-if="editingAllowed">
              <UButton
                variant="outline"
                :disabled="
                  blocked ||
                  Boolean(editor) ||
                  orderChanged ||
                  stopped.includes(candidate.questionId)
                "
                @click="edit(candidate)"
                >候補 {{ index + 1 }} の内容を編集</UButton
              >
              <AdminCandidateEditor
                v-if="editor?.candidate.questionId === candidate.questionId"
                :key="editor.key"
                :candidate="editor.candidate"
                :disabled="blocked"
                :stale="editorStale"
                @save="saveContent"
                @cancel="editor = null"
                @rebase="rebase"
              />
              <template
                v-if="
                  candidate.reviewedAt === null || candidate.reviewedBy === null
                "
              >
                <UCheckbox
                  v-model="reviewed[candidate.id]"
                  label="問題・選択肢・正答・解説・引用の内容を確認しました"
                  :disabled="blocked || Boolean(editor) || orderChanged"
                />
                <UCheckbox
                  v-if="!candidate.quoteVerified"
                  v-model="mismatch[candidate.id]"
                  label="引用不一致の警告を確認し、内容を確認しました"
                  :disabled="blocked || Boolean(editor) || orderChanged"
                />
                <UButton
                  :disabled="
                    blocked ||
                    Boolean(editor) ||
                    orderChanged ||
                    !reviewed[candidate.id] ||
                    (!candidate.quoteVerified && !mismatch[candidate.id]) ||
                    stopped.includes(candidate.questionId)
                  "
                  @click="confirm(candidate)"
                  >候補 {{ index + 1 }} の確認を記録</UButton
                >
              </template>
              <UCheckbox
                :model-value="selected.includes(candidate.id)"
                :label="`候補 ${index + 1} を採用する`"
                :disabled="
                  blocked ||
                  Boolean(editor) ||
                  (!selected.includes(candidate.id) &&
                    (candidate.reviewedAt === null ||
                      candidate.reviewedBy === null ||
                      stopped.includes(candidate.questionId) ||
                      selected.length >= 10))
                "
                @update:model-value="select(candidate.id, $event)"
              />
            </template>
            <details>
              <summary class="cursor-pointer font-semibold">
                この論理問題の全版を出題停止
              </summary>
              <div class="mt-3 space-y-3">
                <p>
                  この問題のすべての版を新規出題から外し、進行中の未回答問題も対象外にします。通常の停止では回答済みの履歴・採点を削除しません。不備確定とは別の操作で、停止解除はありません。
                </p>
                <UCheckbox
                  v-model="stopAcknowledged[candidate.questionId]"
                  label="全版に影響する出題停止を確認しました"
                  :disabled="
                    blocked ||
                    Boolean(editor) ||
                    orderChanged ||
                    stopped.includes(candidate.questionId)
                  "
                />
                <UButton
                  color="error"
                  variant="outline"
                  :disabled="
                    blocked ||
                    Boolean(editor) ||
                    orderChanged ||
                    !stopAcknowledged[candidate.questionId] ||
                    stopped.includes(candidate.questionId)
                  "
                  @click="stop(candidate)"
                  >問題 #{{ candidate.questionId }} の全版を停止</UButton
                >
              </div>
            </details>
          </div></UCard
        >
      </section>
      <UCard
        ><div class="space-y-4">
          <h2 class="text-xl font-semibold">採用する問題と順序</h2>
          <p v-if="!selected.length">
            採用は0問です。1〜10問を採用し、保存するまで公開できません。
          </p>
          <ol class="space-y-3">
            <li v-for="(id, index) in selected" :key="id" class="space-y-2">
              <p>
                {{ index + 1 }}. 問題 #{{
                  detail.candidates.find((candidate) => candidate.id === id)
                    ?.questionId
                }}
              </p>
              <div v-if="editingAllowed" class="flex flex-wrap gap-3">
                <UButton
                  variant="outline"
                  :aria-label="`採用 ${index + 1} を上へ`"
                  :disabled="blocked || Boolean(editor) || index === 0"
                  @click="move(index, -1)"
                  >上へ</UButton
                ><UButton
                  variant="outline"
                  :aria-label="`採用 ${index + 1} を下へ`"
                  :disabled="
                    blocked || Boolean(editor) || index === selected.length - 1
                  "
                  @click="move(index, 1)"
                  >下へ</UButton
                >
              </div>
            </li>
          </ol>
          <template v-if="editingAllowed"
            ><UButton
              :disabled="blocked || Boolean(editor) || !orderChanged"
              @click="saveOrder"
              >採用と順序を保存</UButton
            ><UButton
              variant="outline"
              :disabled="blocked || Boolean(editor) || !orderChanged"
              @click="selected = detail.items.map((item) => item.versionId)"
              >保存済みの順序に戻す</UButton
            ></template
          >
        </div></UCard
      >
      <UCard v-if="editingAllowed"
        ><div class="space-y-4">
          <h2 class="text-xl font-semibold">
            {{ detail.supersedesSetId ? '改訂セットを公開' : 'セットを公開' }}
          </h2>
          <p>
            保存済みの採用問題がすべて確認済みで、停止・不備のない状態で公開できます。最終条件はサーバーで検証します。
          </p>
          <p v-if="detail.supersedesSetId">
            公開時に改訂元セットを公開停止にします。元の公開状態が変わった場合や他の改訂が先に公開された場合は競合になります。
          </p>
          <UCheckbox
            v-model="publishAcknowledged"
            label="採用した内容・順序と公開範囲を確認して公開します"
            :disabled="blocked || !publishable"
          />
          <UButton
            :disabled="blocked || !publishable || !publishAcknowledged"
            @click="publish"
            >{{
              detail.supersedesSetId ? '改訂を公開する' : '公開する'
            }}</UButton
          >
        </div></UCard
      >
      <UCard v-if="detail.status === 'published'"
        ><div class="space-y-4">
          <h2 class="text-xl font-semibold">セットの公開停止</h2>
          <p>
            このセットからの新しい演習開始を止めます。進行中の演習・過去の回答・問題の版は保持します。問題そのものの全版停止とは異なり、このセットの再公開はできません。
          </p>
          <UCheckbox
            v-model="archiveAcknowledged"
            label="新規の演習開始を停止する影響を確認しました"
            :disabled="blocked"
          />
          <UButton
            color="error"
            variant="outline"
            :disabled="blocked || !archiveAcknowledged"
            @click="archive"
            >セットを公開停止にする</UButton
          >
        </div></UCard
      >
      <UCard v-if="detail.status !== 'draft' && detail.publishedAt !== null"
        ><form class="space-y-4" @submit.prevent="clone">
          <h2 class="text-xl font-semibold">改訂下書きを作成</h2>
          <p>
            公開済みの内容を直接上書きしません。採用済みの版を参照する下書きを作成し、編集・再確認してから改訂公開します。作成だけでは元セットを停止しません。
          </p>
          <UFormField label="改訂セット名" required
            ><UInput
              v-model="cloneTitle"
              class="w-full"
              :disabled="blocked || Boolean(cloneReceipt)"
          /></UFormField>
          <UFormField label="改訂セットの説明"
            ><UTextarea
              v-model="cloneDescription"
              class="w-full"
              :disabled="blocked || Boolean(cloneReceipt)"
          /></UFormField>
          <UCheckbox
            v-model="cloneAcknowledged"
            label="元の公開内容と過去回答を保持して改訂下書きを作成します"
            :disabled="blocked || Boolean(cloneReceipt)"
          />
          <p v-if="cloneReceipt">
            受付を保持しています。画面を再読み込みせず、同じ受付を再確認してください。
          </p>
          <UButton
            type="submit"
            :disabled="blocked || (!cloneReceipt && !cloneAcknowledged)"
            >{{
              cloneReceipt ? '同じ改訂受付を再確認' : '改訂下書きを作成する'
            }}</UButton
          >
        </form></UCard
      >
    </template>
  </AdminShell>
</template>
