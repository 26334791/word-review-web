import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
const production = Object.entries(lock.packages)
  .filter(([path, entry]) => path && !entry.dev)
  .sort(([left], [right]) => left.localeCompare(right, 'en'))
const fallbackLicenses = new Map([['worker-f@0.1.20', 'scripts/licenses/worker-f.txt']])
const sections = [
  '# 第三方许可声明',
  '',
  '由 node scripts/prepare-notices.mjs 从 package-lock.json 的生产依赖记录及已安装软件包生成。不要手工编辑此文件。',
  '',
  '以下第三方代码不适用本项目自有代码的 0BSD 许可证。完整保留各依赖随包提供的许可及版权声明；上游未随包提供声明的已核实例外单独注明，不推定版权人或版权年份。',
  '',
  '清单涵盖完整生产依赖树。部分依赖用于 Node 端 XLSX 处理或词库生成；列在此处不代表全部进入浏览器构建产物。开发工具不在本清单中。',
  '',
  '教材、候选词表、设计参考及其许可边界见源码仓库 docs/ATTRIBUTION.md，不能把教材资料的内容核验视作再分发授权。便携包中的 Node.js 运行环境及其内含第三方代码由 runtime/LICENSE 和 runtime/SOURCE.json 单独说明。',
]

for (const [path, entry] of production) {
  const directory = resolve(root, path)
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (metadata.version !== entry.version) {
    throw new Error(`Installed package differs from lockfile: ${path}; run npm ci`)
  }
  const id = `${metadata.name}@${metadata.version}`
  const license = entry.license ?? metadata.license
  if (typeof license !== 'string' || !license) throw new Error(`Missing license metadata: ${id}`)
  const repository =
    typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
  const licenseFiles = (await readdir(directory, { withFileTypes: true }))
    .filter((file) => file.isFile() && /^licen[cs]e(?:\.[a-z]+)?$/i.test(file.name))
    .map((file) => file.name)
    .sort()
  const fallback = fallbackLicenses.get(id)
  if (!licenseFiles.length && !fallback)
    throw new Error(`No license text or verified exception for ${id}`)
  sections.push('', '---', '', `## ${id}`, '', `声明的许可证：${license}`)
  if (repository) sections.push(`源码：${repository.replace(/^git\+/, '').replace(/\.git$/, '')}`)
  for (const file of licenseFiles) {
    const text = (await readFile(join(directory, file), 'utf8')).replace(/\r\n/g, '\n').trimEnd()
    sections.push('', `随包文件：${path}/${file}`, '', '```text', text, '```')
  }
  if (!licenseFiles.length) {
    const text = (await readFile(resolve(root, fallback), 'utf8')).replace(/\r\n/g, '\n').trimEnd()
    sections.push('', `已核实的声明缺口及标准条款参考：${fallback}`, '', '```text', text, '```')
  }
}

const notice = sections.join('\n') + '\n'
await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), notice)
await writeFile(resolve(root, 'public/THIRD_PARTY_NOTICES.txt'), notice)
console.log(`Prepared license notices for ${production.length} production packages.`)
