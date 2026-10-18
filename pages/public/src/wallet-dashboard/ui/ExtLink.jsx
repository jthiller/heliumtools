import { NEW_TAB_SR } from "../copy.js";

/**
 * The only way the dashboard renders an external link (Solscan, heliumvote,
 * the terrain tiles credit): opens a new tab, shows "↗", and says so to
 * screen readers (", opens in a new tab"). Internal tool links (/hotspot-map,
 * /hotspot-claimer, /update-location) are plain same-tab links without "↗".
 * `className` replaces the default accent link style (e.g. a Btn2 look).
 */
export function ExtLink({ href, className, children, ...rest }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "font-medium text-accent-text hover:underline"}
      {...rest}
    >
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only">{NEW_TAB_SR}</span>
    </a>
  );
}

export default ExtLink;
