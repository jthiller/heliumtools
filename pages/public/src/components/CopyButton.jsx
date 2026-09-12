import { useState } from "react";
import { ClipboardDocumentIcon, CheckIcon } from "@heroicons/react/24/outline";
import Tooltip from "./Tooltip.jsx";

export default function CopyButton({ text, size = "h-4 w-4", label = "Copy to clipboard" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center text-content-tertiary hover:text-content-secondary transition-colors"
        aria-label={label}
      >
        {copied ? (
          <CheckIcon className={`${size} text-emerald-500`} />
        ) : (
          <ClipboardDocumentIcon className={size} />
        )}
      </button>
    </Tooltip>
  );
}
