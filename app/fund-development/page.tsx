"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function FundDevelopmentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) return <p className="p-6">Loading...</p>;
  if (!user) return null;

  return (
    <main className="min-h-screen p-6">
      <h1 className="text-3xl font-semibold">Fund Development Plan</h1>
      <p className="mt-2 opacity-80">
        Howdy, You made it WHOOP! Next we’ll add questions + autosave.
      </p>
    </main>
  );
}

