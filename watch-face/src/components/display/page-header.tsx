import type { ReactNode } from "react";

export type PageTone = "blue" | "green" | "amber" | "red";

// One header for every page so titles, kickers and meta line up identically while paging.
export function PageHeader({ kicker, title, tone = "blue", aside }: { kicker: string; title: ReactNode; tone?: PageTone; aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        <p className="page-kicker" data-tone={tone}>{kicker}</p>
        <h2 className="page-title">{title}</h2>
      </div>
      {aside && <div className="page-meta">{aside}</div>}
    </header>
  );
}
