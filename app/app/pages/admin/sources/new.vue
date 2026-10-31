<script setup lang="ts">
import { adminError, adminStatus } from '~/utils/admin-state';
const title = ref('');
const body = ref('');
const allowed = ref(false);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
let active = true;
let receipt: { key: string; title: string; body: string } | null = null;
onBeforeUnmount(() => {
  active = false;
});
async function authorize() {
  loading.value = true;
  error.value = '';
  try {
    await $fetch('/api/admin/sources', { query: { limit: 1 }, retry: 0 });
    if (active) allowed.value = true;
  } catch (cause) {
    if (active) error.value = adminError(cause);
  } finally {
    if (active) loading.value = false;
  }
}
onMounted(authorize);
async function save() {
  if (saving.value || !allowed.value) return;
  if (
    !title.value.trim() ||
    !body.value.trim() ||
    [...title.value.trim()].length > 200 ||
    [...body.value].length > 100000
  ) {
    error.value =
      'タイトルは1〜200文字、本文は1〜100,000文字で入力してください。';
    return;
  }
  if (
    receipt &&
    (receipt.title !== title.value.trim() || receipt.body !== body.value)
  ) {
    error.value =
      '保存結果を確認するまでは、最初に送った内容に戻して再送してください。';
    return;
  }
  receipt ??= {
    key: crypto.randomUUID(),
    title: title.value.trim(),
    body: body.value,
  };
  saving.value = true;
  error.value = '';
  try {
    const result = await $fetch<{ id: number }>('/api/admin/sources', {
      method: 'POST',
      headers: { 'Idempotency-Key': receipt.key },
      body: { title: receipt.title, body: receipt.body },
      retry: 0,
    });
    if (active) await navigateTo(`/admin/sources/${result.id}`);
  } catch (cause) {
    if (!active) return;
    error.value = adminError(cause);
    if (adminStatus(cause) === 403) {
      allowed.value = false;
      title.value = '';
      body.value = '';
      receipt = null;
    } else if ([400, 413, 415].includes(adminStatus(cause) ?? 0))
      receipt = null;
  } finally {
    if (active) saving.value = false;
  }
}
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">教材を登録</h1>
    <p v-if="loading" role="status">管理者権限を確認中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton
        v-if="!allowed"
        variant="outline"
        :disabled="loading"
        @click="authorize"
        >権限を再確認</UButton
      >
    </div>
    <form v-if="allowed" class="space-y-5" @submit.prevent="save">
      <UFormField label="タイトル" name="title" required
        ><UInput v-model="title" class="w-full" :disabled="saving"
      /></UFormField>
      <UFormField
        label="教材本文"
        name="body"
        required
        help="テキストを貼り付けてください。最大100,000文字。"
        ><UTextarea v-model="body" class="w-full" :rows="12" :disabled="saving"
      /></UFormField>
      <p>
        この画面の入力はブラウザに保存しません。通信に失敗した場合は内容を保持し、同じ受付で再送します。
      </p>
      <UButton type="submit" :loading="saving" :disabled="saving">{{
        saving ? '保存中' : '保存する'
      }}</UButton>
    </form>
  </AdminShell>
</template>
