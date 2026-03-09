import {
    CheckCircleIcon,
    BellAlertIcon,
    ExclamationTriangleIcon,
    InformationCircleIcon,
    ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { classNames } from "../lib/utils.js";

const variants = {
    success: {
        wrapper: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50",
        icon: "text-emerald-600 dark:text-emerald-400",
        Icon: CheckCircleIcon,
    },
    info: {
        wrapper: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/50",
        icon: "text-sky-600 dark:text-sky-400",
        Icon: InformationCircleIcon,
    },
    warning: {
        wrapper: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50",
        icon: "text-amber-600 dark:text-amber-400",
        Icon: ExclamationTriangleIcon,
    },
    error: {
        wrapper: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50",
        icon: "text-rose-600 dark:text-rose-400",
        Icon: ExclamationTriangleIcon,
    },
    muted: {
        wrapper: "bg-surface-inset text-content-secondary border-border",
        icon: "text-content-tertiary",
        Icon: BellAlertIcon,
    },
    loading: {
        wrapper: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/50",
        icon: "text-sky-600 dark:text-sky-400",
        Icon: ArrowPathIcon,
    },
};

/**
 * A reusable status banner component for displaying alerts, info, errors, etc.
 * @param {Object} props
 * @param {'success'|'info'|'warning'|'error'|'muted'|'loading'} [props.tone='muted'] - The visual tone
 * @param {string} props.message - The message to display
 */
export default function StatusBanner({ tone = "muted", message }) {
    if (!message) return null;

    const { wrapper, icon, Icon } = variants[tone] || variants.muted;
    const isLoading = tone === "loading";

    return (
        <div className={classNames("flex gap-3 rounded-lg border p-4 text-sm", wrapper)}>
            <Icon
                className={classNames("h-5 w-5 shrink-0", icon, isLoading && "animate-spin")}
                aria-hidden="true"
            />
            <p>{message}</p>
        </div>
    );
}
