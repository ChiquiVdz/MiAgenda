"use client";

import { signIn } from "next-auth/react";
import { clearLocalCopy } from "../core/local-data";

export function GoogleSignInButton() {
  return (
    <button className="login-button" onClick={async () => { await clearLocalCopy(); localStorage.setItem("miagenda:logout", String(Date.now())); await signIn("google", { callbackUrl: "/" }); }}>
      <span className="google-g" aria-hidden="true">G</span>
      Continuar con Google
    </button>
  );
}
