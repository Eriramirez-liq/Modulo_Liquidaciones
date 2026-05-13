import { redirect } from "next/navigation"
import { legacyAppUrl } from "@/lib/legacy-app"

export default function FronterasPage() {
  redirect(legacyAppUrl("/fronteras"))
}
