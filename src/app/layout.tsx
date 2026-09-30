import type { Metadata, Viewport } from "next";
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
  metadataBase: new URL("https://chrono.bedelau59.chatgpt.site"),
  title: "Chrono — A living quantum organism",
  description: "Create, touch and evolve a living quantum organism. Eight linked Moth Atlas engines shape its skin, movement, iridescence and sound.",
  applicationName: "Chrono",
  keywords: ["Chrono", "quantum art", "generative art", "Moth Atlas", "interactive organism"],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/icon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/brand/icon-180.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, title: "Chrono", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: {
    title: "Chrono — A living quantum organism",
    description: "Create. Touch. Evolve. Eight linked quantum engines, one living organism.",
    url: "/",
    siteName: "Chrono",
    locale: "en_GB",
    type: "website",
    images: [{ url: "/brand/social-card.png", width: 1200, height: 630, alt: "Chrono phase mark beside an iridescent quantum organism. Create. Touch. Evolve." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chrono — A living quantum organism",
    description: "Create. Touch. Evolve. Eight linked quantum engines, one living organism.",
    images: [{ url: "/brand/social-card.png", alt: "Chrono phase mark beside an iridescent quantum organism. Create. Touch. Evolve." }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#050506",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full bg-stage font-sans text-fg-1">{children}</body>
    </html>
  );
}
