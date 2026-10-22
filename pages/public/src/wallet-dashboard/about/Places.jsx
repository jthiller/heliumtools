import { Fragment, memo } from "react";
import { Card, CardHead, Chip, StatusMark, Tag } from "../ui/index.js";
import { fmtCount, plural } from "../format.js";
import { Block, HotspotName, RankRow, TextButton } from "./Composition.jsx";

const CAP = "text-wd-cap text-wd-ink-3";

/**
 * About: Places, as recorded. City rows (share of the whole fleet; each
 * shows its Hotspots in the list by city), names under each city for fleets
 * of 10 or fewer, the rest as one line ("1,434 more in 332 other city
 * labels, or with no city"; "Show all 19 cities" up to 200 Hotspots), the
 * unasserted line, the duplicate-spelling note, and state labels when the
 * cities don't already place every Hotspot. `model` is aboutModel.placesOf;
 * `onShow(patch)` filters the list; `onToggleAll` expands or collapses the
 * city list.
 */
export default memo(function Places({ model, onShow, onOpenHotspot, onToggleAll, className = "" }) {
  const { caption, eyebrow, citiesCaption, rows, rest, unasserted, canExpand, expanded, cityTotal, note, states } = model;
  const toggle = canExpand ? (
    <TextButton onClick={onToggleAll} aria-expanded={expanded}>
      {expanded ? "Show top 8 cities" : `Show all ${cityTotal} cities`}
    </TextButton>
  ) : null;
  return (
    <Card as="article" aria-labelledby="about-place-title" className={`flex flex-col gap-4 ${className}`}>
      <CardHead id="about-place-title" title="Places" right={caption} />
      <Block eyebrow={eyebrow} caption={citiesCaption}>
        {rows.length === 0 && <p className="m-0 text-sm text-wd-ink-2">None of this wallet&apos;s Hotspots have a city on record.</p>}
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((c) => (
            <li key={c.key}>
              <RankRow
                label={c.label}
                tag={c.spellings ? <Tag>{`${c.spellings} spellings`}</Tag> : null}
                count={c.count}
                share={c.share}
                width={c.width}
                onClick={c.query ? () => onShow({ q: c.query }) : undefined}
                ariaLabel={`${c.label}: ${plural(c.count, "Hotspot")}, ${c.share} of the fleet. ${
                  c.matches != null && c.matches !== c.count
                    ? `Show the ${plural(c.matches, "Hotspot")} matching "${c.query}" in the Hotspot list.`
                    : "Show them in the Hotspot list."
                }`}
              />
              {c.names && (
                <p className="-mt-0.5 mb-1.5 text-wd-cap leading-[18px] text-wd-ink-2">
                  {c.names.map((n, i) => (
                    <Fragment key={n.key}>
                      <HotspotName
                        item={n}
                        onOpenHotspot={onOpenHotspot}
                        className="text-wd-ink-2 underline decoration-dotted underline-offset-[3px] hover:text-accent-text hover:decoration-solid"
                      />
                      {i < c.names.length - 1 ? ", " : ""}
                    </Fragment>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
        {(rest || (expanded && toggle)) && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 pt-1.5 text-wd-sm text-wd-ink-2">
            <span>{rest?.text ?? ""}</span>
            <span className="flex items-baseline gap-2.5 whitespace-nowrap">
              {rest && <span className="tabular-nums">{rest.share}</span>}
              {toggle}
            </span>
          </div>
        )}
        {unasserted && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 pt-1.5 text-wd-sm text-wd-ink-2">
            <span className="flex min-w-0 items-center gap-2">
              <StatusMark tier="quiet" />
              {`${fmtCount(unasserted.count)} without an asserted location`}
            </span>
            <span className="flex items-baseline gap-2.5 whitespace-nowrap">
              <span className="tabular-nums">{unasserted.share}</span>
              <TextButton onClick={() => onShow({ status: "noLocation" })} label="View the Hotspots without an asserted location in the list">
                View in list
              </TextButton>
            </span>
          </div>
        )}
        {note && <p className={`m-0 ${CAP}`}>{note}</p>}
      </Block>
      {states && (
        <Block eyebrow={states.eyebrow} caption={states.caption}>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {states.chips.map((s) => (
              <li key={s.label}>
                <Chip
                  count={s.count}
                  ariaLabel={`${s.label}: ${plural(s.count, "Hotspot")}`}
                  className="!text-wd-sm max-md:h-9 [&_b]:font-medium [&_b]:text-wd-ink [&_b]:opacity-100"
                >
                  {s.label}
                </Chip>
              </li>
            ))}
          </ul>
          {states.note && <p className={`m-0 ${CAP}`}>{states.note}</p>}
        </Block>
      )}
    </Card>
  );
});
