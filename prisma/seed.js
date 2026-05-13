const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const OPERADORES = [
  "AFINIA", "AIRE", "EEP_CARTAGO", "CEDENAR", "CELSIA_TOLIMA",
  "CELSIA_VALLE", "CENS", "CEO", "CETSA", "CHEC", "EBSA", "EDEQ",
  "EEP_PEREIRA", "ELECTROHUILA", "EMCALI", "EMSA", "ENEL", "ENERCA",
  "EPM", "ESSA", "RUITOQUE",
]

async function main() {
  for (const codigo of OPERADORES) {
    await prisma.configuracionOR.upsert({
      where: { codigo },
      update: { activo: true },
      create: { codigo, nombre: codigo, activo: true },
    })
  }
  console.log(`Seed OK — ${OPERADORES.length} operadores de red`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
