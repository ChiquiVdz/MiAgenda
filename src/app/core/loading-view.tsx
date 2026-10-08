import { AppNavigation } from "./app-navigation";

export function LoadingView({ title }: { title: string }) {
  return <main className="app-shell"><AppNavigation /><section className="workspace" aria-busy="true"><div className="page-content">
    <h1>{title}</h1><p className="core-muted" role="status">Cargando…</p>
  </div></section></main>;
}
