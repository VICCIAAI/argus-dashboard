"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { NodeSwitcher } from "@/components/NodeSwitcher";

// One header for every console page, so there is always a way back to
// the console from the live feed and the alerts feed — and to them from
// it. Kept in a component rather than the /dashboard layout because the
// pages own their own data fetching and each needs a different title.
const LINKS = [
  { href: "/dashboard", label: "Console" },
  { href: "/dashboard/live", label: "Live feed" },
  { href: "/dashboard/alerts", label: "Alerts" },
  { href: "/dashboard/label", label: "Label" },
  { href: "/dashboard/federated", label: "Federated" },
  { href: "/dashboard/thermal", label: "Thermal" },
] as const;

export function DashboardNav({
  title,
  alertCount,
}: {
  title: string;
  /** Unconfirmed alerts, badged on the Alerts tab. Omit where unknown. */
  alertCount?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link
          href="/dashboard"
          className="font-mono text-xs tracking-[0.3em] text-muted uppercase transition-colors hover:text-accent"
        >
          ARGUS
        </Link>
        <h1 className="mt-1 text-lg font-medium text-foreground">{title}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <NodeSwitcher />

        <nav className="flex items-center gap-1 rounded border border-border bg-surface p-1">
          {LINKS.map((link) => {
            // Exact match only: /dashboard must not light up while its
            // own sub-pages are open.
            const isActive = pathname === link.href;
            const showBadge = link.href === "/dashboard/alerts" && !!alertCount;

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2 rounded px-3 py-2 font-mono text-xs tracking-[0.2em] uppercase transition-colors ${
                  isActive
                    ? "bg-surface-raised text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {link.label}
                {showBadge && (
                  <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] leading-none text-danger">
                    {alertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => logout().then(() => router.replace("/login"))}
          className="rounded border border-border px-3 py-2 font-mono text-xs tracking-[0.2em] text-muted uppercase transition-colors hover:border-accent hover:text-foreground"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
