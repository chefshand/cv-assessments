import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SwRegister } from "@/components/SwRegister";

export const metadata: Metadata = {
  title: "CV Assessments",
  description: "Guideline-based cardiology clinic decision support with copy-ready Assessment & Plan.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "CV A&P", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/favicon-48.png", sizes: "48x48" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
