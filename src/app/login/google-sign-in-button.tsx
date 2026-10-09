"use client";

import { signIn } from "next-auth/react";
import { prepareLocalSignIn } from "../core/local-data";
import { useState } from "react";

export function GoogleSignInButton() {
  const [error, setError] = useState("");
  return (
    <><button className="login-button" onClick={async () => { try { const cleared = await prepareLocalSignIn(); if (cleared) localStorage.setItem("miagenda:logout", String(Date.now())); await signIn("google", { callbackUrl: "/" }); } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos preparar el acceso."); } }}>
      <span className="google-g" aria-hidden="true">G</span>
      Continuar con Google
    </button><p className="core-muted">Si tienes cambios sin enviar, elige la misma cuenta para conservarlos y sincronizarlos.</p>{error && <p role="alert">{error}</p>}</>
  );
}
