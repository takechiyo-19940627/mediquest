<script setup lang="ts">
import { adminError, validAdminId } from '~/utils/admin-state';
import type { PastExam } from '~/utils/past-exams';
const route = useRoute();
const exam = ref<PastExam | null>(null);
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
  exam.value = null;
  loading.value = true;
  error.value = '';
  const id = String(route.params.id);
  if (!validAdminId(id)) {
    error.value = '過去問が見つかりません。';
    loading.value = false;
    return;
  }
  try {
    const result = await $fetch<PastExam>(`/api/admin/past-exams/${id}`, {
      retry: 0,
    });
    if (active && token === sequence) exam.value = result;
  } catch (cause) {
    if (active && token === sequence) error.value = adminError(cause);
  } finally {
    if (active && token === sequence) loading.value = false;
  }
}
onMounted(load);
watch(() => route.params.id, load);
function forbidden() {
  exam.value = null;
  error.value = '管理者としてこの操作を利用できません。';
}
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">登録した過去問の確認・修正</h1>
    <p v-if="loading" role="status">過去問を読み込み中です。</p>
    <div v-if="error" role="alert" class="space-y-3">
      <p>{{ error }}</p>
      <UButton :disabled="loading" @click="load">再試行</UButton>
    </div>
    <template v-if="exam">
      <UCard
        ><div class="space-y-3">
          <h2 class="text-lg font-semibold">{{ exam.title }}</h2>
          <p>
            登録 {{ exam.questionCount }}問 / 出題可能
            {{ exam.availableQuestionCount }}問
          </p>
          <UButton v-if="exam.status === 'published'" :to="`/sets/${exam.id}`"
            >この過去問を解く</UButton
          >
        </div></UCard
      >
      <template v-if="exam.status === 'published'"
        ><p>
          修正して保存すると、新しい内容で演習できます。過去の解答と中断中の演習は、解いた当時の内容を保持します。
        </p>
        <AdminPastExamForm :key="exam.id" :exam="exam" @forbidden="forbidden"
      /></template>
      <p v-else>
        これは修正前の旧版です。登録済みの過去問一覧から最新の過去問を選んでください。
      </p>
    </template>
  </AdminShell>
</template>
