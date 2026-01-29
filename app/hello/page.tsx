"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function HelloPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) return <p className="p-6">Loading...</p>;
  if (!user) return null;

  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-3xl font-semibold">Hello World!</h1>
    </main>
  );
}

