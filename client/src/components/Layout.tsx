import { NavLink, Outlet, useLocation } from "react-router-dom";
import { RasaLogo } from "@/components/RasaLogo";
import { cn } from "@/lib/utils";

export function Layout() {
  const { pathname } = useLocation();
  const isDiscover = pathname === "/";

  return (
    <div
      className={cn(
        "grid min-h-dvh grid-rows-[auto_1fr]",
        isDiscover && "overflow-hidden",
      )}
    >
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2.5">
            <RasaLogo className="h-8 w-8 drop-shadow-[0_2px_8px_rgba(139,92,246,0.45)]" />
            <span className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight">Rasa</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Recommendation Engine
              </span>
            </span>
          </NavLink>
          <nav className="flex items-center gap-1" aria-label="Main">
            {[
              { to: "/", label: "Discover", end: true },
              { to: "/watchlist", label: "Watchlist" },
              { to: "/profile", label: "Profile" },
            ].map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto w-full max-w-6xl px-4 py-5",
          isDiscover
            ? "flex h-full max-h-[calc(100dvh-3.5rem)] flex-col overflow-hidden py-3"
            : "overflow-y-auto pb-12",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
