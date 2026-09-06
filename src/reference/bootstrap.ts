export type CategoryKind = 'EXPENSE' | 'INCOME';

export function normalizeSourceLabel(label: string): string {
  return label.normalize('NFC').trim();
}

export function categoryBootstrapKey(kind: CategoryKind, sourceLabel: string): string {
  return `${kind}\u0000${normalizeSourceLabel(sourceLabel)}`;
}

export function accountBootstrapKey(sourceLabel: string): string {
  return `${normalizeSourceLabel(sourceLabel)}\u0000RUB`;
}

export function mapLegacyVikaFlag(value: string | null): 'VIKA' | null {
  return value === 'Да' ? 'VIKA' : null;
}
