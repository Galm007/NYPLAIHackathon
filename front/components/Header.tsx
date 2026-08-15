import Link from "next/link";
import { BlockIcon } from "./icons";

export function Header() {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur"
      style={{ borderColor: "var(--border-hairline)", background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
    >
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[color:var(--text-primary)]">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--series-building)" }}
          >
            <BlockIcon className="h-4.5 w-4.5" />
          </span>
          MoveCheck NYC
        </Link>
        <nav className="flex items-center gap-5 text-sm text-[color:var(--text-secondary)]">
          <Link href="/compare" className="transition-colors hover:text-[color:var(--text-primary)]">
            Compare
          </Link>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{
              color: "var(--status-warning)",
              background: "color-mix(in srgb, var(--status-warning) 14%, transparent)",
            }}
          >
            Preview · sample data
          </span>
        </nav>
      </div>
    </header>
  );
}
