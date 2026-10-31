<template>
  <LearnerShell>
    <nav aria-label="管理メニュー" class="flex flex-wrap gap-3">
      <UButton to="/admin/sources" variant="link">教材一覧</UButton>
      <UButton to="/admin/sets" variant="link">問題セット管理</UButton>
      <UButton to="/admin/reports" variant="link">不備報告</UButton>
      <UButton to="/" variant="link">学習ホーム</UButton>
    </nav>
    <slot />
  </LearnerShell>
</template>
