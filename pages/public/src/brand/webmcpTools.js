import {
  ASSETS,
  BEYOND_LOGO,
  BRAND_ASSET_ORIGIN,
  BRAND_ASSET_PATH,
  BRAND_PURPLE,
  BRAND_PURPLE_ALT,
  CLEAR_SPACE,
  COLORWAYS,
  FAMILIES,
  LOGO_RULES,
  MIN_SIZE,
  OWNERSHIP,
  SUPPORTING_COLORS,
  TERMS,
  TYPE,
  ZIP,
} from "./brandAssets.js";

/**
 * WebMCP tools for /brand. Both are pure reads over the static module the
 * page renders from, so an agent sees exactly the URLs and rules a human
 * does. Nothing here fetches: the files are static assets and the rules are
 * data, so the tools work even before the page has painted.
 */
export const brandTools = [
  {
    name: "list-helium-brand-assets",
    title: "List Helium brand assets",
    description:
      "Direct-link URLs for the official Helium logo files mirrored on heliumtools.org (a third-party site; the marks belong to Nova Labs and the Helium Foundation, whose terms govern use): the Helium lockup, the roundel (symbol in its circle), and the HeliumOS and Plus product lockups, each in purple, black, and white as SVG and PNG. Filter by family, color, or format; omit all three for every file. Each result carries the stable URL to embed or download, its dimensions (viewBox units for SVG, pixels for PNG), and byte size. Read get-helium-logo-guidelines before placing a logo.",
    inputSchema: {
      type: "object",
      properties: {
        family: {
          type: "string",
          enum: FAMILIES.map((f) => f.id),
          description:
            "Which mark: helium (primary lockup), roundel (symbol alone, always in its circle), heliumos, or plus (product lockups).",
        },
        color: {
          type: "string",
          enum: COLORWAYS.map((c) => c.id),
          description: "Colorway: purple for light backgrounds, white for purple/dark backgrounds, black for one-color print.",
        },
        format: { type: "string", enum: ["svg", "png"], description: "File format. Prefer svg wherever it is supported." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute({ family, color, format }) {
      const assets = ASSETS.filter(
        (a) => (!family || a.family === family) && (!color || a.color === color) && (!format || a.format === format),
      );
      return {
        notice: OWNERSHIP.summary,
        base: `${BRAND_ASSET_ORIGIN}${BRAND_ASSET_PATH}/`,
        urlPattern: `${BRAND_ASSET_ORIGIN}${BRAND_ASSET_PATH}/{helium-logo|helium-roundel|heliumos-logo|helium-plus-logo}-{purple|black|white}.{svg|png}`,
        zip: { url: ZIP.url, bytes: ZIP.bytes, contents: "all 24 files, same names as the hosted URLs" },
        families: FAMILIES.map(({ id, name, kind, description }) => ({ id, name, kind, description })),
        assets: assets.map(({ family: f, color: c, format: fmt, url, width, height, bytes }) => ({
          family: f,
          color: c,
          format: fmt,
          url,
          width,
          height,
          dimensionUnit: fmt === "svg" ? "viewBox" : "px",
          bytes,
        })),
      };
    },
  },
  {
    name: "get-helium-logo-guidelines",
    title: "Get Helium logo usage guidelines",
    description:
      "The rules for using the Helium marks: the symbol is always used inside its circle (never on its own), it is never rotated (its two outer circles sit on a fixed 45° axis), and it appears only in the supplied purple, black, or white files. Returns the brand purple hex, which colorway belongs on which background, clear space, minimum sizes, and the full do/don't list, plus a brief supporting palette and type summary (Figtree) from the Helium Design System for anyone building something branded. Also states who owns the marks: heliumtools.org is a third-party mirror, and Nova Labs' and the Helium Foundation's terms govern use. Use list-helium-brand-assets for the file URLs.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute() {
      const { specimen, ...type } = TYPE;
      return {
        ownership: OWNERSHIP,
        terms: TERMS,
        brandPurple: BRAND_PURPLE,
        brandPurpleAlt: `${BRAND_PURPLE_ALT} (spelling used by the lockup exports; visually identical, prefer brandPurple)`,
        colorways: COLORWAYS.map(({ id, hex, use }) => ({ id, hex, use })),
        principles: LOGO_RULES.principles.map(({ title, body }) => ({ title, body })),
        dont: LOGO_RULES.dont.map(({ title, body }) => ({ title, body })),
        clearSpace: CLEAR_SPACE,
        minimumSize: MIN_SIZE,
        supportingColors: SUPPORTING_COLORS.map(({ label, hex, use }) => ({ label, hex, use })),
        type,
        beyondLogo: BEYOND_LOGO,
        assets: `list-helium-brand-assets returns direct URLs; the guidelines page is ${BRAND_ASSET_ORIGIN}/brand`,
      };
    },
  },
];
