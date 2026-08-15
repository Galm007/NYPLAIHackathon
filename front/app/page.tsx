import Link from "next/link";
import { AddressSearch } from "@/components/AddressSearch";
import { BuildingIcon, BlockIcon, MapPinIcon } from "@/components/icons";

const EXAMPLE_ADDRESSES = [
  "123 Ludlow St, New York, NY 10002",
  "456 Park Ave, New York, NY 10022",
  "88 Bedford Ave, Brooklyn, NY 11249",
  "37-11 74th St, Jackson Heights, NY 11372",
];

const FEATURES = [
  {
    icon: BuildingIcon,
    title: "Building Health Score",
    body: "Heat/hot water outages, unsanitary conditions, and plumbing failures tied to the specific address — the record nobody reads before signing a lease.",
    colorVar: "--series-building",
  },
  {
    icon: BlockIcon,
    title: "Block Quality Score",
    body: "Noise and illegal parking are the two highest-volume 311 categories citywide. See what the block is actually like before you move in.",
    colorVar: "--series-block",
  },
  {
    icon: MapPinIcon,
    title: "Grounded in public records",
    body: "Every score traces back to NYC 311 Service Requests — no reviews, no rumors, just the complaint history.",
    colorVar: "--status-good",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <section className="mx-auto max-w-3xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
          style={{ color: "var(--series-building)", background: "color-mix(in srgb, var(--series-building) 12%, transparent)" }}
        >
          Built on NYC 311 public data
        </span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[color:var(--text-primary)] sm:text-5xl">
          Know before you sign the lease.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-[color:var(--text-secondary)]">
          Search any NYC address for a Building Health Score and a Block Quality
          Score — landlord complaint history and neighborhood livability, in one
          report.
        </p>
        <div className="mx-auto mt-8 max-w-xl">
          <AddressSearch autoFocus />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="text-[color:var(--text-muted)]">Try:</span>
          {EXAMPLE_ADDRESSES.map((a) => (
            <Link
              key={a}
              href={`/report?address=${encodeURIComponent(a)}`}
              className="rounded-full border px-3 py-1 text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
              style={{ borderColor: "var(--border-hairline)" }}
            >
              {a.split(",")[0]}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-10 sm:grid-cols-3 sm:px-6">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ color: `var(${f.colorVar})`, background: `color-mix(in srgb, var(${f.colorVar}) 14%, transparent)` }}
            >
              <f.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-semibold text-[color:var(--text-primary)]">{f.title}</h3>
            <p className="mt-1.5 text-sm text-[color:var(--text-secondary)]">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
          How it works
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {[
            { step: "1", title: "Enter an address", body: "Type any NYC address — we geocode it and pull nearby 311 history." },
            { step: "2", title: "Two radii, two scores", body: "A tight radius scores the building itself; a wider radius scores the block." },
            { step: "3", title: "Decide with confidence", body: "See the verdict, the complaint breakdown, and the trend before you tour." },
          ].map((s) => (
            <div key={s.step} className="text-center">
              <div
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: "var(--gridline)", color: "var(--text-primary)" }}
              >
                {s.step}
              </div>
              <h3 className="mt-3 font-medium text-[color:var(--text-primary)]">{s.title}</h3>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-4 py-10 text-center text-xs text-[color:var(--text-muted)] sm:px-6">
        Data source: NYC 311 Service Requests (Socrata, dataset erm2-nwe9). This
        preview uses generated sample data — live backend integration is next.
      </footer>
    </main>
  );
}
