"use client";

import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useRouter } from "next/navigation";

function getAuthErrorCode(err: unknown) {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      router.push("/onboarding/org");
    } catch (err: unknown) {
      const code = getAuthErrorCode(err);

      if (code === "auth/email-already-in-use") {
        try {
          await signInWithEmailAndPassword(auth, email, password);
          router.push("/org-picker?force=1");
          return;
        } catch (signInErr: unknown) {
          const signInCode = getAuthErrorCode(signInErr);
          if (
            signInCode === "auth/invalid-credential" ||
            signInCode === "auth/wrong-password"
          ) {
            setError("Account already exists. Enter the existing password to continue.");
          } else if (signInErr instanceof Error) {
            setError(signInErr.message);
          } else {
            setError("Account exists, but sign-in failed.");
          }
          return;
        }
      }

      if (err instanceof Error) setError(err.message);
      else setError("Registration failed");
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
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Create your account</h1>
          <p className="text-slate-600">Start building and managing professional fundraising documents</p>
        </div>

        {/* Register Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xl shadow-slate-200/50">
          <form onSubmit={handleRegister} className="space-y-5">
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
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                minLength={6}
              />
              <p className="mt-2 text-xs text-slate-500">Must be at least 6 characters long</p>
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
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-200 text-center">
            <p className="text-sm text-slate-600">
              Already have an account?{" "}
              <a 
                className="font-semibold text-primary-500 hover:text-primary-600 transition" 
                href="/login"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        {/* Trust indicator */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Free to get started • Secure nonprofit document management
        </p>
      </div>
    </main>
  );
}




// "use client";

// import { useState } from "react";
// import { createUserWithEmailAndPassword } from "firebase/auth";
// import { auth } from "@/lib/firebaseClient";
// import { useRouter } from "next/navigation";

// export default function RegisterPage() {
//   const router = useRouter();
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");
//   const [error, setError] = useState<string | null>(null);
//   const [loading, setLoading] = useState(false);

//   async function handleRegister(e: React.FormEvent) {
//     e.preventDefault();
//     setError(null);
//     setLoading(true);

//     try {
//       await createUserWithEmailAndPassword(auth, email, password);
//       router.push("/onboarding/org");
//     } catch (err: any) {
//       setError(err?.message ?? "Registration failed");
//     } finally {
//       setLoading(false);
//     }
//   }

//   return (
//     <main className="min-h-screen flex items-center justify-center p-6">
//       <div className="w-full max-w-md border rounded-xl p-6">
//         <h1 className="text-2xl font-semibold mb-4">Create account</h1>

//         <form onSubmit={handleRegister} className="space-y-3">
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
//             placeholder="Password (min 6 chars)"
//             value={password}
//             onChange={(e) => setPassword(e.target.value)}
//             type="password"
//             required
//             minLength={6}
//           />

//           {error && <p className="text-sm text-red-600">{error}</p>}

//           <button
//             className="w-full border rounded-md p-2"
//             disabled={loading}
//             type="submit"
//           >
//             {loading ? "Creating..." : "Sign up"}
//           </button>
//         </form>

//         <p className="text-sm mt-4">
//           Already have an account?{" "}
//           <a className="underline" href="/login">
//             Log in
//           </a>
//         </p>
//       </div>
//     </main>
//   );
// }

