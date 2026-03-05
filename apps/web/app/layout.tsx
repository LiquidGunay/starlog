import type { Metadata } from "next";
import Link from "next/link";
import { SessionProvider } from "./session-provider";
import { ThemeProvider } from "./theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Starlog",
  description: "Clip-first personal knowledge and scheduling system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <ThemeProvider>
          <SessionProvider>
            <nav className="top-nav">
              <Link href="/">Home</Link>
              <Link href="/artifacts">Artifacts</Link>
              <Link href="/planner">Planner</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/review">Review</Link>
              <Link href="/mobile-share">Mobile Share</Link>
            </nav>
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
