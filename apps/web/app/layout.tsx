import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopNavigation } from "./components/top-navigation";
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
  children: ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <ThemeProvider>
          <SessionProvider>
            <TopNavigation />
            {children}
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
