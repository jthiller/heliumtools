import { HeartIcon } from "@heroicons/react/24/outline";

export default function Header() {
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-3 text-slate-900 hover:text-slate-700">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
            HT
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold">Helium Tools</p>
            <p className="text-xs text-slate-500">Operator utilities</p>
          </div>
        </a>
        <nav className="flex items-center gap-4 text-sm font-medium text-slate-600">
          <a
            className="inline-flex items-center gap-1.5 hover:text-slate-900 transition-colors"
            href="/donate"
          >
            <HeartIcon className="h-4 w-4" aria-hidden="true" />
            Donate
          </a>
        </nav>
      </div>
    </header>
  );
}
