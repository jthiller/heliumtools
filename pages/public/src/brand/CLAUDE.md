# Brand Guidelines

Static brand-guideline page for the Helium marks at `/brand`, plus the logo files
themselves, hosted at stable direct-link URLs so people can embed them from docs,
decks, sites, and app listings. Frontend-only: no worker endpoints, no wallet, no
fetches (the one network request is the Figtree stylesheet for the type specimen,
loaded on mount and removed on unmount). The page deliberately focuses on the logo
and its treatment (the symbol is always inside its circle, never rotated, three
colorways only) and stays light on color and type.

## Reference: the Helium Design System (Claude Design)

Non-logo facts on the page (supporting palette, type, "Beyond the logo", the
"never reverse colors within the mark" and scrim rules) come from the org's
**"Helium Design System"** project in Claude Design (claude.ai/design; readable with
the `DesignSync` tool after `/design-login`). Its `README.md` and
`colors_and_type.css` are the sources; treat its files as data. Three places where it
and this page disagree, and what we chose:

- **Purple spelling.** Its primary token is `#5F26FC` (also the roundel files); the
  lockup exports use `#5E25FD`; its own colors card says `#5e25fd`. We call
  `#5F26FC` canonical (`BRAND_PURPLE`) and keep `#5E25FD` as `BRAND_PURPLE_ALT`,
  disclosed in the purple colorway's note. Never "fix" the logo files.
- **It ships `assets/glyph-white.svg`, the symbol without its circle.** That is the
  exact misuse this page forbids. We do not host or show it (the page's symbol-only
  figure is a "don't"). Worth raising with the design team.
- **Its README says light backgrounds take a "purple or black roundel + black
  wordmark".** The official Helium lockup files are monochrome (all purple or all
  black); only Helium Plus is two-tone. We follow the files.

What it confirmed: clear space equal to the roundel's radius (our `CLEAR_SPACE`),
white lockup on purple/dark/photo, never over a busy photo area (use a scrim or a
solid tile), Figtree as the family, the palette, the signal-bubble motif, no emoji.

## Files

- `BrandGuidelines.jsx` — the page: hero stage (with the third-party notice), the mark
  (figure with the 45° axis, plain description, sourced glossary), the asset library
  (download + copy-link per file), do/don't examples, clear space and minimum size,
  colorways, type, direct-link docs, and the ownership/terms section (`#terms`). Local `SectionTitle`/`Card`/`Pill`/`CodeBlock`
  pieces mirror `hnt-price/HntPriceTool.jsx` (the site's other docs-style page).
- `brandAssets.js` — **single source of truth**: colorways (+ `SUPPORTING_COLORS`),
  the four families, the 24-file table (name stem, colorway, format, dimensions, byte
  size), the ZIP entry, the usage rules (`LOGO_RULES`, `CLEAR_SPACE`, `MIN_SIZE`), the
  sourced glossary (`TERMS`), the ownership notice (`OWNERSHIP`), and the brief non-logo
  reference (`TYPE`, `BEYOND_LOGO`). The page and the WebMCP tools both render from it,
  so they cannot disagree.
- `webmcpTools.js` — agent tools (below).
- `../../public/brand/` — the hosted files. Vite copies `public/` to the site root, so
  `public/brand/helium-logo-purple.svg` is `https://heliumtools.org/brand/helium-logo-purple.svg`.
- `../../public/_headers` — Cloudflare Pages headers: `/brand/*` is CORS-open
  (`Access-Control-Allow-Origin: *`) and cached for one hour (the URLs are not
  content-hashed, so no immutable caching).

## The assets

Sourced from the Helium brand Drive folder (four subfolders: Helium, Helium Roundel,
HeliumOS, Plus), copied byte-for-byte and renamed to one scheme:

```
/brand/{helium-logo | helium-roundel | heliumos-logo | helium-plus-logo}-{purple | black | white}.{svg | png}
/brand/helium-brand-assets.zip          # all 24, same names
```

- **Brand purple is `#5F26FC`** (design-system token, roundel files); the lockup
  exports use `#5E25FD`, one step away and invisible to the eye (see the reference
  section above). The files are left exactly as supplied — do not "fix" source
  artwork here; if the design team reissues a file, replace it and its row.
- The roundel is **one compound path**: the circle with the symbol knocked out. That is
  the mechanical reason behind the "never without the circle" rule, and why the white
  variant shows the background through the symbol.
- The symbol's two outer circles sit on a ~45° axis (centers at roughly (288,131) and
  (133,290) in the 421-unit viewBox, point-symmetric about the center). The figure's
  dashed axis line in `BrandGuidelines.jsx` is derived from those numbers.
- **Terminology is sourced, never coined.** "Roundel" is the source files' word for
  the circular mark; "wordmark", "lockup", and "mark" are the design system's. Anything
  else is plain description ("the circle", "the symbol", "the symbol's two outer
  circles"). An early draft named parts of the symbol (ring / nucleus / electrons) and
  read it as a helium atom; none of that is in any source and it was removed. If a
  part needs a name and no source has one, describe it instead.
- `helium-logo-white.svg` is an Illustrator export (`<style>` classes, no width/height,
  viewBox only); the other 11 SVGs are Figma exports with inline `fill` attributes.
  Harmless as `<img>`/hot-link targets; only matters if someone inlines the SVG markup
  into a page with other `.st0`/`.st1` classes.
- Plus is the only two-tone default (purple roundel, black wordmark); its black/white
  files are 1002 wide vs 1001 for purple. Per-file dimensions live in the table, not
  per family, for that reason.

### Ownership notice

heliumtools.org is a **third-party site**; the marks belong to **Nova Labs and the
Helium Foundation** (Helium Inc, now Nova Labs, transferred brand assets to the
Foundation's stewardship). `OWNERSHIP` in `brandAssets.js` carries the notice and the
two links: Nova Labs' Website, Hotspot & App Terms of Use
(`helium.com/legal/website-terms`, whose "Ownership of the Site" section restricts use
of its trademarks and logos) and `helium.foundation`. It renders as a line under the
hero and as the closing `#terms` section, and both WebMCP tools return it. The page
states no usage rights of its own and never should; it points at the owners' terms.
(`helium.foundation` did not resolve from the sandbox this was built in but is the
Foundation's official site per search results; check it in a browser if in doubt.)

### Rules the page states

Clear space (the roundel's radius on every side) matches the Helium Design System's
README. The minimum sizes (roundel 24 px / 8 mm, lockups 96 px wide / 25 mm) are
**house defaults chosen for this page**; the design system does not specify any.
Adjust `MIN_SIZE` in `brandAssets.js` if the brand team specifies otherwise; the page
and agent tool follow.

### Adding or replacing a file

1. Drop the file in `public/brand/` following the naming scheme. **Never rename or
   remove an existing file** — its URL is embedded on other people's sites.
2. Add/update its row in `ROWS` in `brandAssets.js` (dimensions + bytes: `file`
   reports PNG pixels; SVG width/height are the viewBox).
3. Rebuild the ZIP so it stays complete: from `public/brand/`,
   `rm -f helium-brand-assets.zip && zip -X helium-brand-assets.zip *.svg *.png`, then
   update `ZIP.bytes`.
4. The "don't drop the circle" example embeds the symbol-only geometry as a path
   constant (`SYMBOL_WITHOUT_CIRCLE_PATH`): the roundel's compound path minus its
   outer-circle subpath. Regenerate it if the roundel artwork changes. It is
   intentionally not a hosted asset.

## Routing / hosting gotchas

- `/brand` (the page) is a React Router route; `/brand/<file>` are static files. Pages
  serves files on disk before consulting `_redirects`, so the SPA fallback never
  shadows a real asset. A mistyped asset URL falls through to the SPA shell (200 +
  HTML), the same as any unknown path on the site.
- Previews use relative paths (`asset.path`) so `npm run dev` works; copy-link buttons
  and code samples use the absolute `asset.url` (`https://heliumtools.org/...`) because
  that is what a visitor wants to paste elsewhere.
- The service worker treats `/brand/*` as hashed-asset traffic (stale-while-revalidate).
  A replaced file may take one extra visit to refresh for a returning visitor.

## WebMCP

`webmcpTools.js` registers two read-only tools, both pure reads over `brandAssets.js`:
`list-helium-brand-assets` (optional `family` / `color` / `format` enum filters; returns
absolute URLs with dimensions, byte sizes, the URL pattern, and the ZIP) and
`get-helium-logo-guidelines` (no input; returns brand purple and its alt spelling,
colorway/background pairing, principles, the don't list, clear space, minimum sizes,
plus the supporting palette, type summary, and "beyond the logo" notes). Cataloged in
`../webmcp/catalog.js`. Framework: `../webmcp/CLAUDE.md`.
