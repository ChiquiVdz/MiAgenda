import { GoogleSignInButton } from "@/app/login/google-sign-in-button";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <a className="brand login-brand" href="/" aria-label="MiAgenda, inicio">
          <span className="brand-mark">m</span>
          <span>miagenda</span>
        </a>
        <p className="eyebrow">TU TIEMPO, CON INTENCIÓN</p>
        <h1>Tu semana empieza aquí</h1>
        <p className="login-copy">Conecta tu cuenta de Google para organizar tus calendarios desde MiAgenda.</p>
        <GoogleSignInButton />
        <p className="login-privacy">Tu contraseña de Google nunca se comparte con MiAgenda.</p>
      </section>
    </main>
  );
}
