import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { seedStudy } from './fixtures/study-db';
import { seedHistory } from './fixtures/history-db';
import { database, sql } from './fixtures/catalog-db';
import { startSession } from '../../server/services/study/service';
import {
  createReport,
  resolveReport,
} from '../../server/services/reports/service';

async function seed() {
  const { setId } = await seedStudy();
  const c = database();
  try {
    return startSession(c, { setId }, randomUUID()).session;
  } finally {
    c.close();
  }
}
function reportCount() {
  const c = database();
  try {
    return (
      c.client.prepare('select count(*) n from issue_reports').get() as {
        n: number;
      }
    ).n;
  } finally {
    c.close();
  }
}
async function report(page: Page, message: string) {
  await page
    .getByRole('button', { name: 'この問題の不備を報告', exact: true })
    .first()
    .click();
  await page.getByRole('textbox', { name: '不備の理由' }).fill(message);
  await page
    .getByRole('button', { name: '報告を送信する', exact: true })
    .click();
}

test('report, skip, explicit admin confirmation and result exclusion preserve answers', async ({
  page,
}, info) => {
  const s = await seed();
  await page.goto(`/sessions/${s.id}`);
  await report(page, '引用と正解の関係を確認してください');
  await expect(
    page.getByText('報告を受け付けました。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page
    .getByRole('button', { name: 'この問題をスキップ', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '問題2', exact: true }),
  ).toBeVisible();
  await page.getByRole('radio', { name: '選択肢A', exact: true }).check();
  await page.getByRole('button', { name: '回答する', exact: true }).click();
  await expect(page.getByText('回答は保存済みです。')).toBeVisible();
  expect(reportCount()).toBe(1);
  const c = database();
  try {
    expect(
      c.client
        .prepare(
          'select count(*) n from study_items where answered_at is not null',
        )
        .get(),
    ).toEqual({
      n: 1,
    });
    expect(
      c.client
        .prepare(
          'select count(*) n from question_versions where invalidated_at is not null',
        )
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    c.close();
  }
  await page.goto('/admin/reports');
  await page.getByRole('link', { name: /報告 #/ }).click();
  await expect(
    page.getByRole('heading', { name: '問題1', exact: true }),
  ).toBeVisible();
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`report-admin-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole('textbox', { name: '判断の理由' })
    .fill('引用から正解を裏付けられないため');
  await page
    .getByRole('button', { name: 'この判断を確定する', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: /報告 #.*不備確定/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: '未対応の報告へ戻る' }).click();
  await expect(page.getByText('未対応の報告はありません。')).toBeVisible();
  await page.goto(`/sessions/${s.id}/result`);
  await expect(
    page.getByText('不備確定のため集計から除外', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('あなたの回答: 選択肢A')).toBeVisible();
  const d = database();
  try {
    expect(
      d.client
        .prepare(
          'select count(*) n from study_items where answered_at is not null',
        )
        .get(),
    ).toEqual({
      n: 1,
    });
  } finally {
    d.close();
  }
});

test('lost report response replays one open receipt and existing message remains authoritative', async ({
  page,
}, info) => {
  const s = await seed();
  await page.goto(`/sessions/${s.id}`);
  let calls = 0;
  await page.route('**/reports', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++;
    const response = await route.fetch();
    if (calls === 1) return route.abort('failed');
    await route.fulfill({ response });
  });
  await report(page, '最初の報告');
  await expect(
    page.getByText('受付結果を確認できません。', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '不備の理由' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '同じ報告を再送する' }).click();
  await expect(
    page.getByText('この版への未対応の報告を確認しました。', { exact: false }),
  ).toBeVisible();
  expect(reportCount()).toBe(1);
  await page.reload();
  await report(page, '別の内容');
  await expect(page.getByText('最初の報告', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      '今回の入力とは異なる、既存の報告内容です。上書きしていません。',
    ),
  ).toBeVisible();
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: 'この問題の不備を報告' }).click();
    await page.screenshot({
      path: info.outputPath(`report-modal-${theme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(reportCount()).toBe(1);
});

test('resolution loss same retry and conflicting judgment use saved server result', async ({
  page,
}) => {
  const s = await seed();
  const c = database();
  let id: number;
  try {
    id = createReport(c, s.id, s.items[0]!.id, { message: '理由' }).id;
  } finally {
    c.close();
  }
  await page.goto(`/admin/reports/${id}`);
  await page
    .getByRole('combobox', { name: '判断', exact: true })
    .selectOption('dismissed');
  await page
    .getByRole('textbox', { name: '判断の理由' })
    .fill('原文と一致している');
  let calls = 0;
  await page.route('**/resolution', async (route) => {
    calls++;
    const response = await route.fetch();
    if (calls === 1) return route.abort('failed');
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'この判断を確定する' }).click();
  await expect(
    page.getByRole('button', { name: '同じ判断を再送する' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '同じ判断を再送する' }).click();
  await expect(
    page.getByRole('heading', { name: /報告 #.*問題なし/ }),
  ).toBeVisible();
  const d = database();
  let second: number;
  try {
    second = createReport(d, s.id, s.items[1]!.id, { message: '競合' }).id;
  } finally {
    d.close();
  }
  await page.goto(`/admin/reports/${second}`);
  await expect(page.getByRole('textbox', { name: '判断の理由' })).toBeVisible();
  const e = database();
  try {
    resolveReport(e, second, { decision: 'dismissed', note: '別タブの判断' });
  } finally {
    e.close();
  }
  await page
    .getByRole('textbox', { name: '判断の理由' })
    .fill('こちらは不備判断');
  await page.getByRole('button', { name: 'この判断を確定する' }).click();
  await expect(
    page.getByText(
      '別の判断が保存されています。保存済みの結果を確認してください。',
    ),
  ).toBeVisible();
  await expect(page.getByText('判断理由: 別タブの判断')).toBeVisible();
});

test('real 403 erases learner/admin content and other owner items cannot report', async ({
  page,
  request,
}) => {
  const f = await seedHistory();
  await page.goto(`/sessions/${f.completed}/result`);
  await page
    .getByRole('button', { name: 'この問題の不備を報告' })
    .first()
    .click();
  await page.getByRole('textbox', { name: '不備の理由' }).fill('秘密の報告');
  sql("update users set role='learner' where id=1");
  // Learner reporting remains permitted; administrator data is rejected.
  await page.getByRole('button', { name: '報告を送信する' }).click();
  await expect(
    page.getByText('報告を受け付けました。', { exact: false }),
  ).toBeVisible();
  await page.goto('/admin/reports');
  await expect(
    page.getByText('この環境では報告を利用できません。'),
  ).toBeVisible();
  await expect(page.getByText('秘密の報告', { exact: true })).toHaveCount(0);
  const c = database();
  let item: number;
  try {
    item = (
      c.client
        .prepare('select id from study_items where session_id=?')
        .get(f.other) as { id: number }
    ).id;
  } finally {
    c.close();
  }
  const response = await request.post(
    `/api/sessions/${f.other}/items/${item}/reports`,
    { data: { message: '他人' }, headers: { Origin: 'http://127.0.0.1:3100' } },
  );
  expect(response.status()).toBe(404);
  sql("update users set role='admin' where id=1");
  await page.goto('/admin/reports');
  await page.getByRole('link', { name: /報告 #/ }).click();
  sql("update users set role='learner' where id=1");
  await page.getByRole('button', { name: '保存済みの判断を確認する' }).click();
  await expect(page.getByText('秘密の報告', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '判断の理由' })).toHaveCount(
    0,
  );
  sql("update users set role='admin' where id=1");
  await page.goto(`/sessions/${f.completed}/result`);
  await page
    .getByRole('button', { name: 'この問題の不備を報告' })
    .first()
    .click();
  await page.getByRole('textbox', { name: '不備の理由' }).fill('再確認');
  await page.route('**/reports', (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await page.getByRole('button', { name: '報告を送信する' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('あなたの回答:', { exact: false })).toHaveCount(
    0,
  );
});
