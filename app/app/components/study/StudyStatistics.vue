<script setup lang="ts">
import type { StudySummary } from '~/utils/study-api';
defineProps<{ statistics: StudySummary['statistics'] }>();
</script>
<template>
  <dl class="grid grid-cols-2 gap-3 text-sm" aria-label="演習の集計">
    <div>
      <dt>正答 / 集計対象</dt>
      <dd>
        {{ statistics.correctEligibleCount }} / {{ statistics.eligibleCount }}問
      </dd>
    </div>
    <div>
      <dt>正答率</dt>
      <dd>
        {{
          statistics.eligibleCount
            ? `${Math.round((statistics.correctEligibleCount / statistics.eligibleCount) * 100)}%`
            : '集計対象なし'
        }}
      </dd>
    </div>
    <div>
      <dt>未回答（スキップを含む）</dt>
      <dd>{{ statistics.unansweredEligibleCount }}問</dd>
    </div>
    <div>
      <dt>うちスキップ</dt>
      <dd>{{ statistics.skippedUnansweredCount }}問</dd>
    </div>
    <div>
      <dt>停止・不備による除外</dt>
      <dd>{{ statistics.excludedCount }}問</dd>
    </div>
  </dl>
</template>
