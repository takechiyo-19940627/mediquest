<script setup lang="ts">
defineProps<{
  correct: boolean;
  answerLabel: string;
  explanation: string;
  quote: string;
  live?: boolean;
}>();
</script>

<template>
  <section
    aria-label="回答の振り返り"
    class="space-y-5 break-words rounded-lg border border-default bg-elevated p-5"
  >
    <h3 class="text-lg font-semibold">
      {{ correct ? '✓ 正解です' : '！不正解です' }}
    </h3>
    <p><strong>正答：</strong>{{ answerLabel }}</p>
    <div>
      <h4 class="font-semibold">AI解説{{ live ? '' : '（デモ）' }}</h4>
      <p>{{ explanation }}</p>
    </div>
    <div>
      <h4 class="font-semibold">教材からの引用{{ live ? '' : '（デモ）' }}</h4>
      <blockquote class="mt-2 border-l-4 border-primary pl-4">
        {{ quote }}
      </blockquote>
    </div>
    <p class="text-sm text-muted">
      引用の一致は、正解の妥当性を保証するものではありません。
    </p>
  </section>
</template>
