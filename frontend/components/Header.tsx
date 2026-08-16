import Link from "next/link";
import { BlockIcon } from "./icons";

export function Header() {
  return (
    <header
      className="sticky top-0 z-30 bg-[color:var(--surface-1)]/90 backdrop-blur"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-[color:var(--text-primary)]"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-[10px] text-white"
            style={{ background: "var(--brand)", boxShadow: "var(--shadow-sm)" }}
          >
            <BlockIcon className="h-4.5 w-4.5" />
          </span>
          Streetwise
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/compare"
            className="font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--brand)]"
          >
            Compare
          </Link>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              color: "var(--status-warning)",
              background: "color-mix(in srgb, var(--status-warning) 12%, transparent)",
            }}
          >
            Preview · sample data
          </span>
        </nav>
      </div>
    </header>
  );
}
