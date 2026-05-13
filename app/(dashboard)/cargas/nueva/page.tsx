import { redirect } from "next/navigation"
import { legacyAppUrl } from "@/lib/legacy-app"

export default function NuevaCargaPage() {
  redirect(legacyAppUrl("/cargas/nueva"))
}
