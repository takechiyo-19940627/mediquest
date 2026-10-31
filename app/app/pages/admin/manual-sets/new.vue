<script setup lang="ts">
import { adminError, validAdminId } from '~/utils/admin-state';
import type { SourceDetail } from '~/utils/admin-state';
const route = useRoute();
const source = ref<SourceDetail | null>(null);
const loading = ref(true);
const error = ref('');
let active = true;
let sequence = 0;
onBeforeUnmount(() => {
  active = false;
  sequence++;
});
async function load() {
  const token = ++sequence;
  source.value = null;
  loading.value = true;
  error.value = '';
  const id = String(route.query.sourceId ?? '');
  if (!validAdminId(id)) {
    error.value =
      '教材管理から教材を選び、「手動で問題を登録する」を押してください。';
    loading.value = false;
    return;
  }
  try {
    const result = await $fetch<SourceDetail>(`/api/admin/sources/${id}`, {
      retry: 0,
    });
    if (active && token === sequence) source.value = result;
  } catch (cause) {
    if (active && token === sequence) error.value = adminError(cause);
  } finally {
    if (active && token === sequence) loading.value = false;
  }
}
onMounted(load);
watch(() => route.query.sourceId, load);
function forbidden() {
  source.value = null;
  error.value = '管理者としてこの操作を利用できません。';
}
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">手動で問題を登録</h1>
    <p>
      AIを使わずに問題を作れます。保存後に内容を確認し、採用・公開すると学習できるようになります。
    </p>
    <p v-if="loading" role="status">教材を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton :disabled="loading" variant="outline" @click="load"
        >再確認</UButton
      >
      <UButton to="/admin/sources" variant="outline">教材管理へ戻る</UButton>
    </div>
    <AdminManualSetForm
      v-if="source"
      :key="source.id"
      :source="source"
      @forbidden="forbidden"
    />
  </AdminShell>
</template>
