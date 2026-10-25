import { readSheet } from 'read-excel-file/node'
import Papa from 'papaparse'
import { writeFile } from 'node:fs/promises'
const rows = await readSheet('public/data/bnu-grade4-upper.xlsx')
const csv =
  '\uFEFF' +
  Papa.unparse(
    rows.map((row) => row.map((cell) => String(cell ?? ''))),
    { escapeFormulae: true },
  )
await writeFile('public/data/bnu-grade4-upper.csv', csv)
console.log(
  `Prepared ${rows.length - 1} source rows. Duplicate handling remains explicit in the import preview.`,
)
