import { useEffect, useState } from "react";

const MQ = "(prefers-color-scheme: dark)";

export default function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia(MQ).matches);

  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const handler = (e) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return dark;
}
