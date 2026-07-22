/**
 * The three positional dictionaries behind an angry-purple-tiger name
 * (`adjective color animal`), imported straight from the package so the
 * typeahead options always match what the hash actually produces. Each list
 * is 256 entries (a few adjectives/animals repeat); we dedupe + sort for the
 * pickers. Words are lowercase [a-z] with no spaces, so a name splits back
 * into its three positions on the space separator.
 *
 * "tiger" lives in BOTH colors and animals — the reason grinding is positional
 * (pick "animal: tiger") rather than a free substring search.
 */
import adjImport from "angry-purple-tiger/lib/adjectives.js";
import colImport from "angry-purple-tiger/lib/colors.js";
import aniImport from "angry-purple-tiger/lib/animals.js";

const asArray = (x) => (Array.isArray(x) ? x : x.default);
const uniqSort = (arr) => [...new Set(asArray(arr))].sort();

export const ADJECTIVES = uniqSort(adjImport);
export const COLORS = uniqSort(colImport);
export const ANIMALS = uniqSort(aniImport);

export const POSITIONS = [
  { key: "adjective", label: "Adjective", words: ADJECTIVES },
  { key: "color", label: "Color", words: COLORS },
  { key: "animal", label: "Animal", words: ANIMALS },
];
