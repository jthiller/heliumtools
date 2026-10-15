// Tool-card grounds. Each landing section owns one contiguous OKLCH hue arc that
// no other section uses, and each tool in it takes the next step:
//
//   Wallet   rose 8           Network  teal 195, cyan 228, neutral stone
//   Hotspot  orange 48, amber 80, green 134, jade 166, then orange 44 and
//            amber 75 as second shade steps     Holders  azure 244, indigo 276,
//            violet 306                         Brand    orchid 342
//
// `hue` is the OKLCH hue a tone was generated at; `null` marks a neutral (no
// visible hue). Every card flows through one grid in ../sections.js order (3
// columns from a ~1050px viewport, 2 from ~680px, 1 below; a section may start
// mid-row; a featured card spans two columns), so cards of different sections
// share rows. Neighbours (side by
// side, or one above the other; at 1 column, the next card down) differ by
// >= 30° of hue at 3, 2 and 1 columns. A neutral passes beside any hued tone
// (it differs by chroma, not hue), but two neutrals may never touch.
// scripts/tool-previews/bake.mjs checks every adjacency at all three widths,
// that each hued ground measures its declared `hue`, and that a neutral's
// grounds stay under chroma .02. The Hotspot section has six tools and
// four hues, so two pairs share a hue at a second shade step: IoT Setup and
// Reward Claimer, Mobile WiFi and Hotspot Map. Neither pair touches at any
// width; reordering sections.js can change that, and the bake will say so.
//
// Tokens, per theme:
//   g1 → g2  the ground gradient (top → bottom)
//   glow     a soft pool of light under the stack (dark: 70% alpha baked in)
//   ink      name / description / badge text
//   shade    "r g b" of the hue-tinted print shadows
//
// Invariant: description ink (ink at landing.css --desc, mirrored in DESC_INK
// below) is >= 4.5:1 on g1 and g2. Checked by scripts/tool-previews/bake.mjs.
//
// Light grounds are pastels (OKLCH L .87-.94) with the darkest step of the same
// hue as ink. Dark grounds are clearly colored mid-dark fields (L .45-.54,
// C .10-.15) that brighten toward the stack, so the dark captures and their
// graphite frames separate from the ground and the field reads as color, not as
// a near-black. Warm darks stay at h >= 44 so nothing reads red beside a green,
// amber stays at L >= .48 so it reads ochre, not brown, and nothing sits in the
// 85-115° olive band. Generated from OKLCH specs (L, C, h) and gamut-mapped by
// chroma; tweak a tone by its OKLCH values, not by hand-picking hex.

const WALLET = [
  {
    // rose
    hue: 8,
    light: { g1: "#FCDDE2", g2: "#F6C6CD", glow: "#FFF4F5", ink: "#421520", shade: "146 73 88" },
    dark: { g1: "#912946", g2: "#A73554", glow: "#CF4E6FB3", ink: "#FFF8F9", shade: "32 5 11" },
  },
];

const NETWORK = [
  {
    // teal (OUI Notifier)
    hue: 195,
    light: { g1: "#CCEEED", g2: "#B0E1E0", glow: "#EDFAFA", ink: "#002D2D", shade: "1 114 114" },
    dark: { g1: "#026565", g2: "#007575", glow: "#019696B3", ink: "#F1FDFD", shade: "0 19 19" },
  },
  {
    // cyan (Mint Data Credits)
    hue: 228,
    light: { g1: "#CFEBF9", g2: "#B4DDF0", glow: "#EEF9FE", ink: "#012B3A", shade: "2 109 142" },
    dark: { g1: "#02617F", g2: "#027092", glow: "#0090BBB3", ink: "#F4FBFF", shade: "0 18 27" },
  },
  {
    // neutral stone (Buy Data Credits, hidden for now): chroma under .012, so it has
    // no hue to see and is exempt from the hue-step rule; it stands apart from
    // its neighbours by being colorless.
    hue: null,
    light: { g1: "#E5E9E7", g2: "#D5DAD7", glow: "#F6F7F6", ink: "#2B2F2C", shade: "94 101 97" },
    dark: { g1: "#535654", g2: "#636765", glow: "#808482B3", ink: "#F8FBF9", shade: "13 16 14" },
  },
];

const HOTSPOT = [
  {
    // orange, step 1 (IoT Hotspot Setup)
    hue: 48,
    light: { g1: "#FFE1D2", g2: "#FDC9AE", glow: "#FFF4EF", ink: "#411902", shade: "144 80 44" },
    dark: { g1: "#9A4301", g2: "#AD4C02", glow: "#D5661FB3", ink: "#FFF9F6", shade: "31 8 0" },
  },
  {
    // amber, step 1 (Mobile WiFi Onboarding)
    hue: 80,
    light: { g1: "#FFE8C2", g2: "#FAD596", glow: "#FFF6E7", ink: "#352300", shade: "129 92 10" },
    dark: { g1: "#835D02", g2: "#8C6301", glow: "#B17E00B3", ink: "#FEF9F1", shade: "23 13 0" },
  },
  {
    // green (Update Hotspot Location)
    hue: 134,
    light: { g1: "#DBF2CD", g2: "#C2E6AD", glow: "#F1FAEB", ink: "#172D05", shade: "75 111 49" },
    dark: { g1: "#3B6911", g2: "#457718", glow: "#5D972EB3", ink: "#F7FCF4", shade: "6 20 0" },
  },
  {
    // jade (Add a Hotspot)
    hue: 166,
    light: { g1: "#D0F1E2", g2: "#B3E5CE", glow: "#EDFAF4", ink: "#002F20", shade: "14 117 86" },
    dark: { g1: "#01684C", g2: "#037958", glow: "#099A72B3", ink: "#F3FDF8", shade: "0 20 12" },
  },
  {
    // orange, step 2 (Reward Claimer)
    hue: 44,
    light: { g1: "#FFD8C7", g2: "#FCC2A9", glow: "#FFF4F0", ink: "#411905", shade: "146 78 48" },
    dark: { g1: "#8F3701", g2: "#A54104", glow: "#CD5B20B3", ink: "#FEF9F6", shade: "32 6 0" },
  },
  {
    // amber, step 2 (Hotspot Map)
    hue: 75,
    light: { g1: "#FFDDAF", g2: "#F9CA87", glow: "#FFF5E8", ink: "#362200", shade: "132 90 15" },
    dark: { g1: "#7E5401", g2: "#8D5E02", glow: "#B37903B3", ink: "#FFF9F2", shade: "24 13 0" },
  },
];

const HOLDERS = [
  {
    // azure (HNT Price API)
    hue: 244,
    light: { g1: "#D2E8FB", g2: "#B5D7F5", glow: "#F0F8FF", ink: "#002944", shade: "39 104 152" },
    dark: { g1: "#005A8E", g2: "#026BA8", glow: "#148AD3B3", ink: "#F6FBFF", shade: "0 17 32" },
  },
  {
    // indigo (veHNT Positions)
    hue: 276,
    light: { g1: "#DBE1FE", g2: "#C4CDF9", glow: "#F4F6FE", ink: "#1E2248", shade: "84 93 156" },
    dark: { g1: "#40469E", g2: "#4F56B7", glow: "#6873E1B3", ink: "#F9FAFF", shade: "10 12 37" },
  },
  {
    // violet (L1 Migration)
    hue: 306,
    light: { g1: "#EBDEFA", g2: "#DDC9F4", glow: "#F9F5FF", ink: "#2F1C41", shade: "113 83 144" },
    dark: { g1: "#66388E", g2: "#7947A5", glow: "#9961CDB3", ink: "#FBF9FF", shade: "21 8 32" },
  },
];

const BRAND = [
  {
    // orchid: >= 30° from L1 Migration's violet, the card before it, at every
    // width. Wallet's rose is 26° away but they never touch.
    hue: 342,
    light: { g1: "#FADCEE", g2: "#F2C5E0", glow: "#FFF3FA", ink: "#3C1730", shade: "137 74 115" },
    dark: { g1: "#833269", g2: "#99407C", glow: "#BF589DB3", ink: "#FFF8FC", shade: "29 5 21" },
  },
];

// Section rules: the colored line drawn across each heading row of the card
// grid, one per section, keyed by the section's `id` in ../sections.js. One
// representative hue of the section's family at a mid tone (light: OKLCH L .60,
// C .15; dark: L .74, C .13, both gamut-mapped by chroma), >= 3:1 against the
// page background in its theme at full strength; landing.css draws it as a
// 1px hairline at 50% opacity.
export const SECTION_RULES = {
  wallet: { hue: 8, light: "#C8536F", dark: "#EF869B" },
  "network-operators": { hue: 210, light: "#0590A2", dark: "#00C0D7" },
  "hotspot-operators": { hue: 62, light: "#B96A00", dark: "#E5974C" },
  "hnt-holders": { hue: 275, light: "#6875D8", dark: "#93A3FC" },
  brand: { hue: 342, light: "#BA5799", dark: "#E288C2" },
};

// The description's ink strength per theme; must match landing.css --desc.
export const DESC_INK = { light: 0.8, dark: 0.94 };

export const TONES = { wallet: WALLET, network: NETWORK, hotspot: HOTSPOT, holders: HOLDERS, brand: BRAND };
