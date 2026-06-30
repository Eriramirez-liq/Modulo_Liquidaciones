import { redirect } from "next/navigation"

// El módulo de Operadores se movió dentro de Administración (pestaña Operadores).
// Esta ruta queda como redirección para enlaces antiguos.
export default function OperadoresRedirect() {
  redirect("/administracion")
}
