<template>
  <div class="min-h-screen bg-default text-default">
    <a href="#main" class="sr-only focus:not-sr-only">本文へ移動</a>
    <header class="border-b border-default">
      <div
        class="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 p-6"
      >
        <span class="text-xl font-semibold text-primary">Mediquest</span>
        <nav aria-label="学習ナビゲーション" class="flex flex-wrap gap-2">
          <UButton to="/" variant="link">ホーム</UButton>
          <UButton to="/history" variant="link">履歴</UButton>
          <UButton to="/admin/sources" variant="link"
            >教材管理（管理者用）</UButton
          >
        </nav>
        <ThemePicker />
      </div>
    </header>
    <main
      id="main"
      class="mx-auto max-w-3xl space-y-6 px-6 py-12"
      tabindex="-1"
    >
      <slot />
    </main>
  </div>
</template>
