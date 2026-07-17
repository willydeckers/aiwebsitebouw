"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overzicht" },
  { href: "/leads", label: "Leads" },
  { href: "/verstuurd", label: "Verstuurd" },
  { href: "/klanten", label: "Klanten" },
  { href: "/voorkeuren", label: "Voorkeuren" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {LINKS.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={`block rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-blue-600 text-white shadow-md shadow-blue-300/50"
                : "text-slate-700 hover:bg-blue-100/60"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
