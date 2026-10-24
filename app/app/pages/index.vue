<template>
  <div class="min-h-screen bg-default text-default">
    <a href="#main" class="sr-only focus:not-sr-only">本文へ移動</a>
    <header class="border-b border-default">
      <div
        class="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4 p-6"
      >
        <span class="text-xl font-semibold text-primary">Mediquest</span>
        <ThemePicker />
      </div>
    </header>
    <main
      id="main"
      class="mx-auto max-w-3xl space-y-6 px-6 py-12"
      tabindex="-1"
    >
      <h1 class="text-2xl font-semibold">学習ホーム</h1>
      <UCard>
        <h2 class="text-lg font-semibold">学習できる問題はまだありません</h2>
        <p class="mt-2 text-muted">問題が公開されるまでお待ちください。</p>
      </UCard>
    </main>
  </div>
</template>
