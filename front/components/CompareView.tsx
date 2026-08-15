"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CompareColumn } from "./CompareColumn";

export function CompareView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const a = searchParams.get("a") ?? "";
  const b = searchParams.get("b") ?? "";

  function updateParam(key: "a" | "b", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.replace(`/compare?${params.toString()}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
        Compare two addresses
      </h1>
      <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
        Side-by-side building and block scores to help you pick between options.
      </p>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <CompareColumn label="Address A" initialAddress={a} onAddressChange={(v) => updateParam("a", v)} />
        <CompareColumn label="Address B" initialAddress={b} onAddressChange={(v) => updateParam("b", v)} />
      </div>
    </div>
  );
}
