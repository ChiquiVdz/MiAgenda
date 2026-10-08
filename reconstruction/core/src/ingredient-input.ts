import { invalid } from "./errors.ts";
export type IngredientUnit = "g" | "ml" | "piece";
export function ingredientName(value: unknown) {
  if (typeof value !== "string") invalid("Escribe el nombre del ingrediente.");
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) invalid("El nombre admite de 1 a 120 caracteres visibles.");
  return name;
}
export function normalizedIngredientName(value: string) {
  return value.normalize("NFKC").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es-MX");
}
export function ingredientUnit(value: unknown): IngredientUnit {
  if (value !== "g" && value !== "ml" && value !== "piece") invalid("Elige gramos, mililitros o piezas.");
  return value;
}
/** Integer thousandths: no floating-point rounding in stock commands. */
export function quantityInput(value: unknown) {
  if (typeof value !== "string") invalid("La cantidad debe enviarse como texto decimal.");
  const input = value.trim().replace(",", ".");
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(input)) invalid("Usa una cantidad entre 0 y 999999999.999, con hasta tres decimales.");
  const [integer, fraction = ""] = input.split(".");
  const thousandths = BigInt(integer) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  return quantityString(thousandths);
}
export function quantityString(value: bigint) {
  const negative = value < BigInt(0); if (negative) value = -value;
  const fraction = String(value % BigInt(1000)).padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${value / BigInt(1000)}${fraction ? `.${fraction}` : ""}`;
}
export function quantityThousandths(value: string) {
  const [integer, fraction = ""] = quantityInput(value).split(".");
  return BigInt(integer) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}
export function similarIngredientName(a: string, b: string) {
  if (a === b) return true;
  const singular = (word: string) => word.replace(/(?:es|s)$/, "");
  // Suggestions only: never assign IDs or merge inventories by similarity.
  if (singular(a) === singular(b)) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, differences = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++differences > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return differences + (a.length - i) + (b.length - j) <= 1;
}
