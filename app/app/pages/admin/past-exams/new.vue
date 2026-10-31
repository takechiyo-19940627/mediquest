<script setup lang="ts">
const forbidden = ref(false);
</script>
<template>
  <AdminShell>
    <h1 class="text-2xl font-semibold">過去問を登録</h1>
    <p>
      お手元の過去問を入力・貼り付けしてください。1問から登録でき、あとで問題や解説を追加できます。
    </p>
    <p v-if="forbidden" role="alert">管理者としてこの操作を利用できません。</p>
    <AdminPastExamForm v-else @forbidden="forbidden = true" />
  </AdminShell>
</template>
