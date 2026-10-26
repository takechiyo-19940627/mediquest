<script setup lang="ts">
import type { AnswerState, StudyQuestionData } from '../../utils/study-state';
defineProps<{ question: StudyQuestionData; answer: AnswerState }>();
defineEmits<{ select: [id: string]; submit: []; next: [] }>();
</script>

<template>
  <section aria-labelledby="question-title" class="space-y-6">
    <div>
      <h2 id="question-title" class="text-xl font-semibold">
        {{ question.title }}
      </h2>
      <p id="selection-hint" class="mt-2 text-muted">
        {{ question.required }}つ選んでから「回答する」を押してください。
      </p>
    </div>
    <fieldset
      :disabled="answer.save !== 'editing'"
      aria-describedby="selection-hint"
      class="space-y-3"
    >
      <legend class="sr-only">回答の選択肢</legend>
      <URadioGroup
        v-if="question.required === 1"
        :items="question.choices"
        value-key="id"
        variant="card"
        :ui="{
          base: 'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4',
        }"
        :model-value="answer.selected[0]"
        :disabled="answer.save !== 'editing'"
        @update:model-value="(value) => value && $emit('select', value)"
      />
      <div
        v-for="choice in question.required > 1 ? question.choices : []"
        :key="choice.id"
        class="rounded-lg border p-4"
        :class="
          answer.selected.includes(choice.id)
            ? 'border-primary bg-elevated'
            : 'border-default'
        "
      >
        <UCheckbox
          :label="choice.label"
          :model-value="answer.selected.includes(choice.id)"
          :disabled="
            answer.save !== 'editing' ||
            (answer.selected.length >= question.required &&
              !answer.selected.includes(choice.id))
          "
          @update:model-value="$emit('select', choice.id)"
        />
        <span
          v-if="answer.selected.includes(choice.id)"
          class="mt-2 block text-sm text-primary"
          >選択中</span
        >
      </div>
    </fieldset>
    <p role="status" aria-live="polite" class="text-sm">
      <template v-if="answer.save === 'editing'"
        >{{ answer.selected.length }} /
        {{ question.required }} 選択済み</template
      >
      <template v-else-if="answer.save === 'saving'"
        >模擬保存中です。実際の記録は保存されません。</template
      >
      <template v-else-if="answer.save === 'failed'"
        >模擬保存に失敗しました。選択を保持しています。</template
      >
      <template v-else
        >模擬保存が完了しました。実際の記録は保存されません。</template
      >
    </p>
    <UButton
      v-if="answer.save !== 'saved'"
      size="lg"
      :loading="answer.save === 'saving'"
      :disabled="
        answer.selected.length !== question.required || answer.save === 'saving'
      "
      @click="$emit('submit')"
    >
      {{ answer.save === 'failed' ? '保存を再試行する' : '回答する' }}
    </UButton>
    <slot v-if="answer.save === 'saved'" name="feedback" />
    <UButton v-if="answer.save === 'saved'" size="lg" @click="$emit('next')"
      >次へ</UButton
    >
  </section>
</template>
