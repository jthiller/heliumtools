import { useNavigate } from "react-router-dom";
import { useWebMcpTools } from "./useWebMcpTools.js";

/**
 * Mounts once inside the SPA's BrowserRouter (see main.jsx) and registers
 * the site-wide WebMCP tools on every route. Renders nothing. The tools
 * module (and the catalog it carries) is imported dynamically so it stays
 * out of the entry bundle. The oui-notifier entry registers the same
 * tools without a router — see src/oui-notifier/Home.jsx.
 */
export default function WebMcpSiteTools() {
  const navigate = useNavigate();
  useWebMcpTools(() => import("./siteTools.js").then((m) => m.makeSiteTools(navigate)), []);
  return null;
}
