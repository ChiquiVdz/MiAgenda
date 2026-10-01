"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton() {
  return (
    <button className="login-button" onClick={() => signIn("google", { callbackUrl: "/" })}>
      <span className="google-g" aria-hidden="true">G</span>
      Continuar con Google
    </button>
  );
}
