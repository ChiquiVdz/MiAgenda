import { GoogleSignInButton } from "@/app/login/google-sign-in-button";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = (await searchParams).error;
  return (
    <main className="login-shell">
      <section className="login-card">
        <a className="brand login-brand" href="/" aria-label="MiAgenda, inicio">
          <span className="brand-mark">m</span>
          <span>miagenda</span>
        </a>
        <p className="eyebrow">TU TIEMPO, CON INTENCIÓN</p>
        <h1>Tu semana empieza aquí</h1>
        <p className="login-copy">Entra con Google para organizar tus pendientes en MiAgenda. Tus actividades se guardan aquí.</p>
        <GoogleSignInButton />
        {error && <p className="form-error" role="alert">No pudimos terminar el acceso. Intenta entrar de nuevo con la misma cuenta de Google.</p>}
        <p className="login-privacy">Tu contraseña de Google nunca se comparte con MiAgenda.</p>
      </section>
    </main>
  );
}
