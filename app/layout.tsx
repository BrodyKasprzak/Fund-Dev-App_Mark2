import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PurposeFramework",
  description: "Purpose-built document operations for fundraisers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} antialiased`}
      >
        <AuthProvider>
          <Suspense fallback={<main className="min-h-screen bg-white" />}>
            <WorkspaceShell>{children}</WorkspaceShell>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
