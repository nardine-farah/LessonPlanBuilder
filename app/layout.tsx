import type { Metadata } from "next";
import { Fraunces, Karla } from "next/font/google";
import { AuthProvider } from "./components/AuthProvider";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "SOFT", "WONK"],
});

const karla = Karla({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Lesson Plan Builder — Biblica",
  description:
    "Turn any Biblica PDF, in any language, into a reviewed lesson plan for the Scripture Studio library.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${karla.variable}`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
