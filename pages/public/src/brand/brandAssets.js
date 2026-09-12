/**
 * Single source of truth for the Brand Guidelines page and its WebMCP tools:
 * the hosted logo files, the colorways, and the usage rules.
 *
 * The files themselves are plain static assets in `pages/public/public/brand/`
 * (served at `/brand/<file>`); nothing here is fetched or generated. Dimensions
 * and byte sizes are recorded by hand because the page shows them and agents
 * read them, and there is no build step to derive them — when a file in that
 * directory is replaced, update its row below in the same commit.
 *
 * File names are the product: people embed these URLs in docs, decks, and
 * sites. Renaming or removing one is a breaking change for everyone linking
 * to it. Add new files freely; never rename existing ones.
 */

/**
 * Helium Purple. Official files carry two spellings one step apart:
 * #5F26FC is the Helium Design System's primary token and what the roundel
 * files use; #5E25FD is what the lockup exports (Helium, HeliumOS, Plus)
 * use. They are indistinguishable on screen. New work should use the token.
 */
export const BRAND_PURPLE = "#5F26FC";
export const BRAND_PURPLE_ALT = "#5E25FD";

/** Canonical origin for share/copy links. Previews use relative paths so dev works. */
export const BRAND_ASSET_ORIGIN = "https://heliumtools.org";
export const BRAND_ASSET_PATH = "/brand";

export const COLORWAYS = [
  {
    id: "purple",
    label: "Purple",
    hex: BRAND_PURPLE,
    use: "The primary colorway. Use it on white and light neutral backgrounds.",
    note: `Two spellings exist in official files: ${BRAND_PURPLE} (the design-system token, used by the roundel files) and ${BRAND_PURPLE_ALT} (used by the lockup exports). They look identical; use ${BRAND_PURPLE} in new work.`,
  },
  {
    id: "black",
    label: "Black",
    hex: "#000000",
    use: "For one-color print and anywhere purple is unavailable. Light backgrounds only.",
  },
  {
    id: "white",
    label: "White",
    hex: "#FFFFFF",
    use: "For Helium Purple, dark, and photographic backgrounds. The symbol shows through as the background.",
  },
];

/**
 * `file` is the URL stem: `${file}-${color}.${format}`. The order here is the
 * display order on the page and in agent results.
 */
export const FAMILIES = [
  {
    id: "helium",
    name: "Helium",
    file: "helium-logo",
    kind: "Primary lockup",
    description:
      "The roundel with the helium wordmark. This is the default way to write Helium visually; reach for it before any other mark.",
  },
  {
    id: "roundel",
    name: "Helium Roundel",
    file: "helium-roundel",
    kind: "Symbol",
    description:
      "The symbol on its own, always inside its circle. Use it where the lockup does not fit: app icons, avatars, favicons, and small UI.",
  },
  {
    id: "heliumos",
    name: "HeliumOS",
    file: "heliumos-logo",
    kind: "Product lockup",
    description: "The roundel with the heliumOS wordmark, for the HeliumOS product.",
  },
  {
    id: "plus",
    name: "Helium Plus",
    file: "helium-plus-logo",
    kind: "Product lockup",
    description:
      "The roundel with the Plus wordmark, for Helium Plus, the program that turns existing Wi-Fi hardware into part of the network. The only lockup with a two-tone default: purple roundel, black wordmark.",
  },
];

/**
 * The rest of the palette, from the Helium Design System. Deliberately
 * restrained: the purple does the work against black, white, and grey.
 */
export const SUPPORTING_COLORS = [
  { id: "blue", label: "Primary Blue", hex: "#1088DE", use: "Secondary. Reserved for Hotspot surfaces." },
  { id: "orange", label: "Orange", hex: "#F79009", use: "Accent. Helium Plus calls to action only." },
  { id: "night", label: "Night", hex: "#030A12", use: "Deep navy for full-bleed dark backgrounds." },
  { id: "off-white", label: "Off White", hex: "#F5F5F7", use: "Most surfaces are white or near-white." },
  { id: "light-gray", label: "Light Gray", hex: "#F7F7F7", use: "Soft grey behind product photography." },
  { id: "border", label: "Border", hex: "#E5E7EB", use: "Hairline card borders." },
  { id: "gray", label: "Gray", hex: "#7D7D7D", use: "Secondary text." },
];

/** Type, in brief. The site itself is not set in the brand face; the specimen on the page is. */
export const TYPE = {
  family: "Figtree",
  weights: "Regular 400, SemiBold 600, Black 900",
  display:
    "Headlines are Figtree Black, uppercase, 0.95 leading, −2.5% tracking, with one clause set in Helium Purple.",
  headings: "Headings are Figtree SemiBold with −2% tracking.",
  body: "Body is Figtree Regular at 18 px. Eyebrows and labels are uppercase with +8% tracking.",
  poster: "Panchang Extrabold appears only on posters, for super-sized display.",
  specimen: { lead: "A network built by people,", accent: "not towers", body: "The Helium Network. It's already in your pocket." },
};

/**
 * Sourced terminology only. "Roundel" is what the source files call the
 * circular mark; "wordmark" and "lockup" are the Helium Design System's words.
 * Everything else is plain description ("the circle", "the symbol's two outer
 * circles"). Do not coin names for parts of the symbol.
 */
export const TERMS = [
  {
    term: "Roundel",
    definition: "The Helium symbol cut out of a solid circle. The name the source files use for the circular mark.",
  },
  {
    term: "Wordmark",
    definition: "The drawn helium, heliumOS, or Plus lettering. Custom artwork, not a typeface.",
  },
  { term: "Lockup", definition: "The roundel paired with a wordmark at a fixed size and spacing." },
];

/**
 * heliumtools.org is a third-party site. It mirrors the official files for
 * convenience and grants no rights in them; the owners' terms govern use.
 */
export const OWNERSHIP = {
  summary:
    "heliumtools.org is a third-party site. The Helium marks belong to Nova Labs and the Helium Foundation. The files on this page are mirrored for convenience, and nothing here grants any right to use them; refer to the owners' terms before using a mark.",
  owners: [
    {
      name: "Nova Labs",
      label: "Website, Hotspot & App Terms of Use",
      url: "https://www.helium.com/legal/website-terms",
    },
    { name: "Helium Foundation", label: "helium.foundation", url: "https://www.helium.foundation/" },
  ],
};

/** The non-logo essentials, so a reader knows what else the brand is made of. */
export const BEYOND_LOGO = [
  {
    title: "Signal bubbles",
    body:
      "The signature motif: soft white circles at about 80% opacity, in varied sizes, clustered off one edge of a photograph. Pure white, never colored or outlined.",
  },
  {
    title: "Photography",
    body:
      "Warm and natural. Real people with phones, installers mounting hardware, products centered on soft grey. Never stock-looking, never corporate.",
  },
  {
    title: "Cards",
    body: "Rounded corners from 24 to 50 px, hairline #E5E7EB borders, near-white fills, and almost no shadow.",
  },
  {
    title: "Voice",
    body: "Direct, declarative, proud. Lead with a number, one idea per headline, and put the punchy half in purple. No emoji.",
  },
];

export function familyById(id) {
  return FAMILIES.find((f) => f.id === id) || null;
}

// family, color, format, width, height, bytes. SVG width/height are viewBox
// units (the files scale freely); PNG width/height are pixels.
const ROWS = [
  ["helium", "purple", "svg", 295, 77, 6736],
  ["helium", "purple", "png", 1001, 257, 17720],
  ["helium", "black", "svg", 295, 77, 6731],
  ["helium", "black", "png", 1001, 257, 12740],
  ["helium", "white", "svg", 295, 77, 4290],
  ["helium", "white", "png", 1001, 257, 13605],
  ["roundel", "purple", "svg", 421, 421, 2548],
  ["roundel", "purple", "png", 841, 841, 30230],
  ["roundel", "black", "svg", 421, 421, 2546],
  ["roundel", "black", "png", 841, 841, 24011],
  ["roundel", "white", "svg", 421, 421, 2546],
  ["roundel", "white", "png", 841, 841, 24444],
  ["heliumos", "purple", "svg", 1647, 298, 9068],
  ["heliumos", "purple", "png", 1647, 298, 31248],
  ["heliumos", "black", "svg", 1647, 298, 9050],
  ["heliumos", "black", "png", 1647, 298, 22804],
  ["heliumos", "white", "svg", 1647, 298, 9050],
  ["heliumos", "white", "png", 1647, 298, 24278],
  ["plus", "purple", "svg", 1001, 339, 5130],
  ["plus", "purple", "png", 1001, 339, 19456],
  ["plus", "black", "svg", 1002, 339, 5150],
  ["plus", "black", "png", 1002, 339, 15581],
  ["plus", "white", "svg", 1002, 339, 5150],
  ["plus", "white", "png", 1002, 339, 16390],
];

function hosted(filename) {
  const path = `${BRAND_ASSET_PATH}/${filename}`;
  return { filename, path, url: `${BRAND_ASSET_ORIGIN}${path}` };
}

/** Every hosted logo file, flat. Filter with `family` / `color` / `format`. */
export const ASSETS = ROWS.map(([family, color, format, width, height, bytes]) => ({
  family,
  color,
  format,
  width,
  height,
  bytes,
  ...hosted(`${familyById(family).file}-${color}.${format}`),
}));

/** All 24 files in one archive, same names as the hosted URLs. */
export const ZIP = { ...hosted("helium-brand-assets.zip"), bytes: 280695 };

/** `{ svg, png }` for one family + colorway. */
export function assetsFor(family, color) {
  const pick = (format) => ASSETS.find((a) => a.family === family && a.color === color && a.format === format);
  return { svg: pick("svg"), png: pick("png") };
}

export function formatBytes(bytes) {
  return bytes >= 1024 * 100 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ─── Usage rules ──────────────────────────────────────────────────────────────
// Rendered on the page and returned verbatim by get-helium-logo-guidelines.

/** Clear space, expressed against the roundel so it scales with the mark. */
export const CLEAR_SPACE =
  "At least the roundel's radius (half its diameter) on every side, measured from the circle's edge, or from the wordmark's extremes on a lockup. Nothing enters that zone: no text, no other logos, no canvas edge.";

export const MIN_SIZE = {
  roundel: { px: 24, mm: 8 },
  lockup: { px: 96, mm: 25 },
  note: "Below these sizes the symbol's cut-outs fill in and the wordmark loses its counters.",
};

export const LOGO_RULES = {
  principles: [
    {
      id: "circle",
      title: "Always with the circle",
      body:
        "The circle is part of the mark, not a badge around it. The symbol is cut out of the circle, and the two ship as one shape in every file. The symbol is never used on its own.",
    },
    {
      id: "rotation",
      title: "Never rotated",
      body:
        "The symbol's two outer circles sit on a 45° axis rising from lower-left to upper-right. That orientation is fixed. Do not rotate, flip, or mirror the mark, and do not turn it to fit a layout.",
    },
    {
      id: "colorways",
      title: "Three colorways, straight from the files",
      body:
        "Purple, black, or white, exactly as supplied. Purple on light backgrounds, white on purple, dark, or photographic backgrounds, black for one-color print. No tints, gradients, or other colors, and never reverse the colors within the mark.",
    },
    {
      id: "lockups",
      title: "Use the supplied lockups",
      body:
        "The wordmark is custom-drawn. Never re-type it in a font, change the space between roundel and wordmark, or build a stacked or reversed lockup by hand. If a layout needs a compact mark, use the roundel. In running text the name is Helium, capitalized; only the wordmark is lowercase.",
    },
  ],
  dont: [
    {
      id: "no-circle",
      title: "Don't drop the circle",
      body: "The symbol is never used without its circle. This is the most common mistake.",
    },
    {
      id: "rotate",
      title: "Don't rotate",
      body: "The symbol's 45° axis is fixed. No rotating, flipping, or mirroring.",
    },
    {
      id: "stretch",
      title: "Don't stretch or skew",
      body: "Scale proportionally. Lock the aspect ratio in every tool.",
    },
    {
      id: "recolor",
      title: "Don't recolor",
      body: "No gradients, tints, or off-brand colors, and never reverse the colors within the mark. Purple, black, or white only.",
    },
    {
      id: "effects",
      title: "Don't add effects",
      body: "No drop shadows, strokes, glows, bevels, or outlines.",
    },
    {
      id: "contrast",
      title: "Don't sacrifice contrast",
      body: "Purple on a dark or busy background fails. Switch to the white files, and over photography add a scrim or a solid tile behind the mark.",
    },
  ],
};
