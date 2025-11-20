import { HeartIcon } from "@heroicons/react/24/solid";

export default function Header() {
  return (
    <header className="bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-3 text-slate-900 hover:text-indigo-700">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-semibold text-white shadow-sm">
            HT
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold">Helium Tools</p>
            <p className="text-xs text-slate-500">Operator utilities</p>
          </div>
        </a>
        <nav className="flex items-center gap-4 text-sm font-semibold text-slate-700">
          <a
            className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
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
