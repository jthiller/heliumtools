import useMediaQuery from "./useMediaQuery.js";

export default function useDarkMode() {
  return useMediaQuery("(prefers-color-scheme: dark)");
}
