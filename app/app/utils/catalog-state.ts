export interface CatalogSet {
  id: number;
  title: string;
  description: string;
  publishedAt: number | null;
  availableQuestionCount: number;
}
export interface CatalogPage {
  items: CatalogSet[];
  nextCursor: string | null;
}
export interface CatalogDetail extends CatalogSet {
  canStart: boolean;
}
export function appendCatalog(current: CatalogSet[], incoming: CatalogSet[]) {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}
export function validCatalogId(id: string) {
  return /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id));
}
export function catalogError(error: unknown, detail = false) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 403) return '利用設定または権限のため取得できません。';
  if (detail && (status === 400 || status === 404))
    return '現在このセットを表示できません';
  return '読み込みに失敗しました。もう一度お試しください。';
}
