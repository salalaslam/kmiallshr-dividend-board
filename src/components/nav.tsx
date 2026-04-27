"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="top-nav">
      <span className="brand">PSX Board</span>
      <Link href="/" className={pathname === "/" ? "active" : ""}>
        Dividend Board
      </Link>
      <Link
        href="/capital-gains"
        className={pathname === "/capital-gains" ? "active" : ""}
      >
        Capital Gains
      </Link>
    </nav>
  );
}
