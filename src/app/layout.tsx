import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Memento — turn a memory into something you can hold",
  description:
    "Describe a memory and Memento turns it into illustrated artwork printed on a handcrafted pillow.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                const recoveryKey = "memento:chunk-recovery";
                window.addEventListener("error", (event) => {
                  const target = event.target;
                  const url = target && (target.src || target.href);
                  if (!url || !url.includes("/_next/static/")) return;

                  if (sessionStorage.getItem(recoveryKey)) {
                    console.error("[memento:recovery] Next.js asset failed after retry", url);
                    return;
                  }

                  sessionStorage.setItem(recoveryKey, "pending");
                  const nextUrl = new URL(window.location.href);
                  nextUrl.searchParams.set("_asset_retry", Date.now().toString());
                  window.location.replace(nextUrl);
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
