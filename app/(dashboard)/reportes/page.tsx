import { redirect } from "next/navigation"
import { legacyAppUrl } from "@/lib/legacy-app"

export default function ReportesPage() {
  redirect(legacyAppUrl("/reportes"))
}
