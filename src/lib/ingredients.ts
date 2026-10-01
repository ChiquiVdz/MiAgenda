export function normalizeIngredientName(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");

  // Common misspellings should resolve to the shared catalog entry rather
  // than creating private ingredients that look like duplicate suggestions.
  const aliases: Record<string, string> = { arros: "arroz", arrox: "arroz" };
  return aliases[normalized] ?? normalized;
}
