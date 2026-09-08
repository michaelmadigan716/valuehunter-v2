import type { Metadata } from "next";
import "./swing.css";
import { Nav } from "@/app/swing/_components/Nav";
import { data } from "@/app/swing/_lib/data";

export const metadata: Metadata = {
  title: "Swing Trade Hunter",
  description: "Trade history - positions, executions, and realized P&L.",
  robots: { index: false, follow: false },
};

export default function SwingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="swing-root min-h-screen flex flex-col antialiased">
      <Nav />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {data.refresh_note && <p className="card p-3 mb-5 text-sm text-ink-2">{data.refresh_note}</p>}
        {children}
      </main>
      <footer className="text-xs text-muted px-6 py-6 max-w-7xl mx-auto w-full">
        Built from the complete Vanguard transaction history, Vanguard&apos;s cost-basis (lot) reports and its monthly
        performance record. Finalized realized P&amp;L uses Vanguard&apos;s assigned lots at original purchase cost;
        any provisional executions are identified above.
      </footer>
    </div>
  );
}
