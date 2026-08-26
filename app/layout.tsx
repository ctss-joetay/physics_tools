import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Physics Tools",
  description:
    "Browser-based instruments for physics practical work — real-time data collection on a tablet, no app install.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Locked: pinch-zoom on the tracking canvas would fight tap-to-mark.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <header className="border-b border-[var(--border)] bg-[var(--surface-1)]">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight text-[var(--text-primary)]"
            >
              Physics Tools
            </Link>
            <Link
              href="/kinematics"
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Kinematics
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
