<template>
  <LearnerShell>
    <nav aria-label="管理メニュー" class="flex flex-wrap gap-3">
      <UButton to="/admin/past-exams" variant="link">登録済みの過去問</UButton>
      <UButton to="/admin/past-exams/new" variant="link">過去問を登録</UButton>
      <UButton to="/admin/reports" variant="link">不備報告</UButton>
      <UButton to="/" variant="link">学習ホーム</UButton>
    </nav>
    <slot />
  </LearnerShell>
</template>
