import { installSyntheticPreviewTransport } from './preview-transport.mjs';

async function loadCanonicalShell() {
  const response = await fetch('./index.html', { cache: 'no-store' });
  if (!response.ok) throw new Error('PREVIEW_SHELL_LOAD_FAILED');
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const body = parsed.body.cloneNode(true);
  body.querySelectorAll('script').forEach((script) => script.remove());
  document.body.replaceWith(body);

  const banner = document.createElement('div');
  banner.dataset.syntheticPreview = 'true';
  banner.setAttribute('role', 'status');
  banner.textContent = 'ДЕМО · только синтетические данные · реальные финансы не загружаются';
  banner.style.cssText = 'position:sticky;top:0;z-index:20;padding:8px 12px;text-align:center;background:#fef3c7;color:#78350f;border-bottom:1px solid #fde68a;font:700 12px/1.35 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em';
  document.body.prepend(banner);
  document.title = 'PrihRash — демо интерфейса';
}

try {
  await loadCanonicalShell();
  installSyntheticPreviewTransport();
  await import('./app.mjs');
  const {
    mountSyntheticPreviewExpenseWriter,
    mountSyntheticPreviewIncomeWriter,
    mountSyntheticPreviewTransferWriter,
  } = await import('./preview-writer.mjs');
  await mountSyntheticPreviewExpenseWriter();
  await mountSyntheticPreviewIncomeWriter();
  await mountSyntheticPreviewTransferWriter();
} catch {
  document.body.innerHTML = '<main style="max-width:720px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif"><h1>PrihRash</h1><p>Не удалось запустить безопасный demo preview.</p></main>';
}
