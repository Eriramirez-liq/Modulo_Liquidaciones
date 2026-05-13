import { redirect } from "next/navigation"
import { legacyAppUrl } from "@/lib/legacy-app"

export default function ConciliacionesPage() {
  redirect(legacyAppUrl("/conciliaciones"))
}
