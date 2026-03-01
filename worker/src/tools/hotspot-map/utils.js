/**
 * Title-case a kebab-case hotspot name.
 * "spare-pewter-toad" → "Spare Pewter Toad"
 */
export function titleCase(name) {
  if (!name) return null;
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
