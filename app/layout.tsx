import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

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
      <body className="antialiased">
        <AuthProvider>
          <Suspense fallback={<main className="min-h-screen bg-white" />}>
            <WorkspaceShell>{children}</WorkspaceShell>
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
