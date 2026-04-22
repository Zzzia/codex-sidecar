export function formatThreadTitle(
  title: string | null | undefined,
  fallback: string,
): string {
  const compact = (title ?? "").replace(/\s+/g, " ").trim();
  return compact || fallback;
}
