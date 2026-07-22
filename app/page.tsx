"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./components/AuthProvider";

export default function WelcomePage() {
  const router = useRouter();
  const { user, loading, error, signIn } = useAuth();

  useEffect(() => {
    if (!loading && user) router.replace("/plans");
  }, [loading, user, router]);

  if (loading || user) return null;

  return (
    <div className="welcome">
      <div className="welcome-panel">
        <div className="brand-kicker">Biblica · Scripture Studio</div>
        <h1 className="welcome-title">
          Lesson Plan <em>Builder</em>
        </h1>
        <p className="welcome-lede">
          Turn any Biblica program PDF — in any language — into a reviewed lesson plan for the
          Scripture Studio library.
        </p>

        <ul className="welcome-points">
          <li>
            <strong>Feed it a PDF.</strong> The builder reads the document, translates if
            needed, and proposes a draft plan.
          </li>
          <li>
            <strong>You curate.</strong> A guided interview walks every lesson, quiz, and tag —
            the AI proposes, the reviewer decides.
          </li>
          <li>
            <strong>Synced to your profile.</strong> Every plan you're reviewing is saved to
            your account, so you can continue on any machine.
          </li>
        </ul>

        {error && <div className="notice notice-error">{error}</div>}

        <button className="btn btn-google" onClick={signIn}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>
        <p className="welcome-fineprint">
          Sign in with your Biblica Google account. Your plans are private to your reviewer
          profile.
        </p>
      </div>
    </div>
  );
}
