import { useNavigate } from "react-router-dom";
import { useWebMcpTools } from "./useWebMcpTools.js";
import { makeSiteTools } from "./siteTools.js";

/**
 * Mounts once inside the SPA's BrowserRouter (see main.jsx) and registers
 * the site-wide WebMCP tools on every route. Renders nothing. The
 * oui-notifier entry registers the same tools without a router — see
 * src/oui-notifier/main.jsx.
 */
export default function WebMcpSiteTools() {
  const navigate = useNavigate();
  useWebMcpTools(() => makeSiteTools(navigate), []);
  return null;
}
