import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "@fontsource-variable/geist";
import "@fontsource-variable/source-code-pro";
import "./globals.css";

// Typeface: Geist + Geist Mono, chosen for developer-tool legibility (crisp
// tabular data, compact numerals) while staying visually neutral so the
// "Stealth" mascot and kurama avatar carry the brand personality.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stealth Hosting",
  description: "Sign in to Stealth Hosting.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      {process.env.NODE_ENV === "development" ? (
        <head>
          {/* react-grab is a dev-time browser extension helper, not a production
              dependency: loading it for every visitor in production would add a
              third-party script to every page for no benefit. */}
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        </head>
      ) : null}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
