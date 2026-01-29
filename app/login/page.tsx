"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err?.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-primary-50 via-white to-primary-50">
      <div className="w-full max-w-md">
        {/* Logo/Brand Area */}
        <div className="text-center mb-8">
          <div className="inline-flex px-6 py-4 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-400 mb-4 shadow-lg">
            <span className="text-xl font-bold text-white whitespace-nowrap">PurposeFramework</span>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome back</h1>
          <p className="text-slate-600">Sign in to continue to your workspace</p>
        </div>

        {/* Login Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                Email address
              </label>
              <input
                id="email"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                Password
              </label>
              <input
                id="password"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}

            <button
              className="w-full bg-gradient-to-r from-primary-500 to-accent-400 hover:from-primary-600 hover:to-primary-500 text-white font-semibold rounded-xl px-4 py-3 transition shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={loading}
              type="submit"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-200 text-center">
            <p className="text-sm text-slate-600">
              New here?{" "}
              <a 
                className="font-semibold text-primary-500 hover:text-primary-600 transition" 
                href="/register"
              >
                Create an account
              </a>
            </p>
          </div>
        </div>

        {/* Optional: Add a trust indicator */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Secure nonprofit document management and builder platform
        </p>
      </div>
    </main>
  );
}




// "use client";

// import { useState } from "react";
// import { signInWithEmailAndPassword } from "firebase/auth";
// import { auth } from "@/lib/firebaseClient";
// import { useRouter } from "next/navigation";

// export default function LoginPage() {
//   const router = useRouter();
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");
//   const [error, setError] = useState<string | null>(null);
//   const [loading, setLoading] = useState(false);

//   async function handleLogin(e: React.FormEvent) {
//     e.preventDefault();
//     setError(null);
//     setLoading(true);

//     try {
//       await signInWithEmailAndPassword(auth, email, password);
//       router.push("/dashboard");
//     } catch (err: any) {
//       setError(err?.message ?? "Login failed");
//     } finally {
//       setLoading(false);
//     }
//   }

//   return (
//     <main className="min-h-screen flex items-center justify-center p-6">
//       <div className="w-full max-w-md border rounded-xl p-6">
//         <h1 className="text-2xl font-semibold mb-4">Log in</h1>

//         <form onSubmit={handleLogin} className="space-y-3">
//           <input
//             className="w-full border rounded-md p-2"
//             placeholder="Email"
//             value={email}
//             onChange={(e) => setEmail(e.target.value)}
//             type="email"
//             required
//           />
//           <input
//             className="w-full border rounded-md p-2"
//             placeholder="Password"
//             value={password}
//             onChange={(e) => setPassword(e.target.value)}
//             type="password"
//             required
//           />

//           {error && <p className="text-sm text-red-600">{error}</p>}

//           <button
//             className="w-full border rounded-md p-2"
//             disabled={loading}
//             type="submit"
//           >
//             {loading ? "Signing in..." : "Log in"}
//           </button>
//         </form>

//         <p className="text-sm mt-4">
//           New here?{" "}
//           <a className="underline" href="/register">
//             Create an account
//           </a>
//         </p>
//       </div>
//     </main>
//   );
// }

