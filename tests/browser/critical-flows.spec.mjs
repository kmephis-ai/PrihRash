import { expect, test } from '@playwright/test';

async function guardedBrowser(page, run) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  try {
    return await run();
  } finally {
    expect(errors, `unexpected browser errors:\n${errors.join('\n')}`).toEqual([]);
  }
}

async function logNavigationMetric(page, label) {
  const metric = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    return navigation ? {
      durationMs: Math.round(navigation.duration),
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
    } : null;
  });
  console.log(`[browser-metric] ${label} ${JSON.stringify(metric)}`);
}

async function waitForPreview(page) {
  await expect(page.locator('[data-synthetic-preview="true"]')).toContainText('только синтетические данные');
  await expect(page.locator('[data-sync-state]')).toHaveText('Обновлено');
  await expect(page.locator('[data-preview-writer="expense"]')).toBeVisible();
  await expect(page.locator('[data-preview-writer="income"]')).toBeVisible();
  await expect(page.locator('[data-preview-writer="transfer"]')).toBeVisible();
}

async function fillCreateForm(panel, values) {
  await panel.locator('input[name="amount"]').fill(values.amount);
  await panel.locator('input[name="occurredOn"]').fill(values.occurredOn);
  if (values.accountIndex !== undefined) await panel.locator('select[name="accountId"]').selectOption({ index: values.accountIndex });
  if (values.categoryIndex !== undefined) await panel.locator('select[name="categoryId"]').selectOption({ index: values.categoryIndex });
  if (values.fromAccountIndex !== undefined) await panel.locator('select[name="fromAccountId"]').selectOption({ index: values.fromAccountIndex });
  if (values.toAccountIndex !== undefined) await panel.locator('select[name="toAccountId"]').selectOption({ index: values.toAccountIndex });
  if (values.description !== undefined) await panel.locator('input[name="description"]').fill(values.description);
}

test('desktop Reader supports deterministic filter, refresh and pagination flows', async ({ page }) => {
  await guardedBrowser(page, async () => {
    await page.goto('/');
    await waitForPreview(page);
    await expect(page.getByRole('heading', { name: 'Операции', level: 1 })).toBeVisible();
    await expect(page.locator('[data-operations-table] tr')).toHaveCount(6);
    await expect(page.locator('[data-operations-table]')).toContainText('Супермаркет · демо');

    await page.locator('[data-filter-type]').selectOption('INCOME');
    await expect(page.locator('[data-sync-state]')).toHaveText('Фильтр применён');
    await expect(page.locator('[data-operations-table]')).toContainText('Зарплата · демо');
    await expect(page.locator('[data-operations-table]')).not.toContainText('Супермаркет · демо');

    await page.locator('[data-reset-filters]').click();
    await expect(page.locator('[data-sync-state]')).toHaveText('Обновлено');
    await page.locator('[data-refresh-reader]').click();
    await expect(page.locator('[data-refresh-reader]')).toHaveText('Обновить');
    await expect(page.locator('[data-load-more]')).toBeVisible();
    await page.locator('[data-load-more]').click();
    await expect(page.locator('[data-page-state]')).toHaveText('Больше операций нет.');
    await expect(page.locator('[data-operations-table]')).toContainText('Исторические расходы за месяц · демо');
    await logNavigationMetric(page, 'desktop-reader');
  });
});

test('mobile critical controls stay accessible and INCOME/TRANSFER local-first smoke works', async ({ page }) => {
  await guardedBrowser(page, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForPreview(page);

    await expect(page.locator('[data-operations-cards] .operation-card')).toHaveCount(6);
    await expect(page.locator('[data-refresh-reader]')).toBeVisible();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const income = page.locator('[data-preview-writer="income"]');
    await fillCreateForm(income, {
      amount: '1234,56',
      occurredOn: '2026-09-10',
      accountIndex: 1,
      categoryIndex: 1,
      description: 'Доход · browser demo',
    });
    await income.locator('[data-preview-income-save]').click();
    await expect(income.locator('[data-preview-income-writer-status]')).toContainText('Сохранено локально');
    await expect(income.locator('[data-preview-income-pending-count]')).toContainText(': 1');

    const transfer = page.locator('[data-preview-writer="transfer"]');
    await fillCreateForm(transfer, {
      amount: '500,00',
      occurredOn: '2026-09-10',
      fromAccountIndex: 1,
      toAccountIndex: 2,
      description: 'Перевод · browser demo',
    });
    await transfer.locator('[data-preview-transfer-save]').click();
    await expect(transfer.locator('[data-preview-transfer-writer-status]')).toContainText('Сохранено локально');
    await expect(transfer.locator('[data-preview-transfer-pending-count]')).toContainText(': 1');
    await logNavigationMetric(page, 'mobile-writer-smoke');
  });
});

test('EXPENSE draft survives reload, offline create is durable, and only validated ACK clears its intent', async ({ page, context }) => {
  await guardedBrowser(page, async () => {
    await page.goto('/');
    await waitForPreview(page);
    const expense = page.locator('[data-preview-writer="expense"]');
    await fillCreateForm(expense, {
      amount: '42,75',
      occurredOn: '2026-09-11',
      accountIndex: 1,
      categoryIndex: 1,
      description: 'Расход · browser demo',
    });
    await expect(expense.locator('[data-preview-expense-writer-status]')).toContainText('Черновик сохранён локально');

    await page.reload();
    await waitForPreview(page);
    const restoredExpense = page.locator('[data-preview-writer="expense"]');
    await expect(restoredExpense.locator('input[name="amount"]')).toHaveValue('42,75');
    await expect(restoredExpense.locator('input[name="occurredOn"]')).toHaveValue('2026-09-11');
    await expect(restoredExpense.locator('input[name="description"]')).toHaveValue('Расход · browser demo');

    await context.setOffline(true);
    await restoredExpense.locator('[data-preview-expense-save]').click();
    await expect(restoredExpense.locator('[data-preview-expense-writer-status]')).toContainText('Сохранено локально');
    await expect(restoredExpense.locator('[data-preview-expense-pending-count]')).toContainText(': 1');

    const income = page.locator('[data-preview-writer="income"]');
    await fillCreateForm(income, {
      amount: '100,00',
      occurredOn: '2026-09-11',
      accountIndex: 1,
      categoryIndex: 1,
      description: 'Остаётся pending · browser demo',
    });
    await income.locator('[data-preview-income-save]').click();
    await expect(income.locator('[data-preview-income-pending-count]')).toContainText(': 1');

    const offlineKinds = await page.evaluate(async () => {
      const { createIndexedDbPreviewOutbox } = await import('/preview-writer-outbox.mjs');
      return (await createIndexedDbPreviewOutbox(indexedDB).listPending()).map((intent) => intent.kind).sort();
    });
    expect(offlineKinds).toEqual(['CREATE_EXPENSE', 'CREATE_INCOME']);

    await context.setOffline(false);
    const deliveryEvidence = await page.evaluate(async () => {
      const { createIndexedDbPreviewOutbox } = await import('/preview-writer-outbox.mjs');
      const { deliverPreviewExpenseIntent } = await import('/preview-writer-delivery.mjs');
      const outbox = createIndexedDbPreviewOutbox(indexedDB);
      const pending = await outbox.listPending();
      const expenseIntent = pending.find((intent) => intent.kind === 'CREATE_EXPENSE');
      let invalidCode = null;
      try {
        await deliverPreviewExpenseIntent({
          outbox,
          intent: expenseIntent,
          sender: {
            sendExpenseCreate: async () => ({
              apiVersion: 1,
              outcome: 'CREATED',
              idempotencyKey: '50000000-0000-0000-0000-000000000099',
              transactionId: '60000000-0000-0000-0000-000000000099',
              version: 1,
            }),
          },
        });
      } catch (error) {
        invalidCode = error?.message ?? null;
      }
      const afterInvalid = (await outbox.listPending()).map((intent) => intent.kind).sort();
      const ack = await deliverPreviewExpenseIntent({
        outbox,
        intent: expenseIntent,
        sender: {
          sendExpenseCreate: async (request) => ({
            apiVersion: 1,
            outcome: 'CREATED',
            idempotencyKey: request.idempotencyKey,
            transactionId: '60000000-0000-0000-0000-000000000001',
            version: 1,
          }),
        },
      });
      const afterValid = (await outbox.listPending()).map((intent) => intent.kind).sort();
      return { invalidCode, afterInvalid, afterValid, outcome: ack.outcome };
    });
    expect(deliveryEvidence).toEqual({
      invalidCode: 'INVALID_PREVIEW_EXPENSE_ACK',
      afterInvalid: ['CREATE_EXPENSE', 'CREATE_INCOME'],
      afterValid: ['CREATE_INCOME'],
      outcome: 'CREATED',
    });
  });
});

test('optimistic edit conflict never silently overwrites and requires explicit rebase', async ({ page }) => {
  await guardedBrowser(page, async () => {
    await page.goto('/');
    await waitForPreview(page);
    const edit = page.locator('[data-preview-expense-edit]');
    const description = edit.locator('input[name="description"]');
    await description.fill('Мои изменения · browser demo');
    await edit.locator('[data-preview-expense-edit-save]').click();

    const conflict = edit.locator('[data-preview-expense-edit-conflict]');
    await expect(conflict).toBeVisible();
    await expect(conflict.getByRole('heading', { name: 'Ничего не перезаписано' })).toBeVisible();
    await expect(edit.locator('[data-preview-expense-edit-status]')).toContainText('Ничего не перезаписано');
    await expect(conflict.locator('[data-preview-expense-edit-local]')).toContainText('Мои изменения · browser demo');
    await expect(conflict.locator('[data-preview-expense-edit-current]')).toContainText('Изменено в другом окне · демо');
    await expect(description).toBeDisabled();

    await edit.locator('[data-preview-expense-edit-rebase]').click();
    await expect(conflict).toBeHidden();
    await expect(description).toHaveValue('Мои изменения · browser demo');
    await expect(edit.locator('[data-preview-expense-edit-status]')).toContainText('Нажмите «Сохранить изменения» ещё раз');
    await edit.locator('[data-preview-expense-edit-save]').click();
    await expect(edit.locator('[data-preview-expense-edit-status]')).toContainText('Сохранено · версия 3');
  });
});
