import { WizardCarga } from "@/components/cargas/WizardCarga"

export default function NuevaCargaPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Nueva carga</h1>
      <WizardCarga />
    </div>
  )
}
