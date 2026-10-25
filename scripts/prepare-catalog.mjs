// Local source snapshots only; this script never downloads or replaces raw workbooks.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readSheet } from 'read-excel-file/node'
import Papa from 'papaparse'

const units = [
  [
    'Signs',
    75,
    `sign|标志，指示牌|2
left|左；向左|2
right|右；向右|2
litter|乱丢垃圾|2
sorry|对不起|2
very|很，非常|2
smoking|吸烟，抽烟|2
touch|触摸|3
food|食物|3
parking|停车|3
camera|照相机|3
worry|担心|4
afraid|害怕的|4
cry|哭|4
try|尝试|4`,
  ],
  [
    'Shopping',
    75,
    `shopping|购物|14
how much|多少钱|14
train|火车|14
plane|飞机|14
money|钱|14
doll|玩具娃娃|15
eleven|十一|15
twelve|十二|15
thirteen|十三|15
fourteen|十四|15
fifteen|十五|15
sixteen|十六|15
seventeen|十七|15
eighteen|十八|15
nineteen|十九|15
twenty|二十|15
look at|看|16
thirty|三十|17
forty|四十|17
fifty|五十|17
sixty|六十|17
seventy|七十|17
eighty|八十|17
ninety|九十|17
hundred|百|17`,
  ],
  [
    "Uncle Booky's Study",
    76,
    `study|书房|26
whose|谁的|26
CD|激光唱片；光盘|26
new|新的|26
umbrella|伞|26
chair|椅子|27
watch|手表|27
TV|电视，电视机|27
table|桌子|27
radio|收音机|27
glasses|眼镜|28
tidy|整洁的，整齐的|28
clean|干净的|28`,
  ],
  [
    "Bobby's House",
    76,
    `living room|客厅|38
room|房间|38
door|门|38
welcome|欢迎|38
nice|好的|38
bedroom|卧室|38
sleep|睡觉|38|sleeping
bathroom|浴室；卫生间|38
wash|洗|38|washing
river|河|38
kitchen|厨房|39
cook|烹调，做饭|40|cooking
fish|钓鱼|40|fishing
Mrs|夫人，太太|40
make|做|40|making
dinner|正餐，晚餐|40
drink|喝|41|drinking
study|学习|41|studying
eat|吃|41|eating
paint|绘画|41|painting`,
  ],
  [
    'At School',
    77,
    `school|学校|50
subject|科目|50
have|有|50
math|数学|50
English|英语|50
Chinese|语文；中文|50
P.E.|体育|50
class|课|50
their|他们的|50
teacher|教师，老师|50
music|音乐|51
art|美术；艺术|51
science|科学|51
classroom|教室|52
blackboard|黑板|52
office|办公室|52
playground|操场|52
library|图书馆|53`,
  ],
  [
    'Review',
    77,
    `Christmas|圣诞节|62
party|聚会|62
beautiful|美丽的|62
gift|礼物|62
parents|父母|62
some|一些，若干|63`,
  ],
]
const starred = new Set(
  'sign litter smoking touch camera money doll CD radio glasses tidy bathroom paint classroom office Christmas gift'.split(
    ' ',
  ),
)
const imageBase = 'https://images.szxuexiao.com/uploadimages/keben2022/bsdb4njyy_s2013/'
const reviewed = []
for (const [index, [title, vocabularyPage, text]] of units.entries()) {
  for (const line of text.split('\n')) {
    const [en, zh, page, inflection] = line.split('|')
    reviewed.push({
      id: `bnu-2013-g4-upper-u${index + 1}-${en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      en,
      zh,
      unit: `Unit ${index + 1} ${title}`,
      page: Number(page),
      vocabularyPage: en === 'hundred' ? 76 : vocabularyPage,
      starred: starred.has(en),
      ...(inflection ? { inflection } : {}),
    })
  }
}
await writeFile(
  'public/data/bnu-grade4-upper-review.json',
  JSON.stringify(
    {
      checkedOn: '2026-10-25',
      scope: '2013审定版封面、目录与词汇页；不等于版权页版次年月或新版',
      sources: [0, 1, 75, 76, 77, 78, 79, 80].map((page) => imageBase + page + '.jpg'),
      normalization:
        '动词括号中的进行式记在 inflection；学习英文使用原形；星号记录为 starred，不作为英文。音标沿用候选词典，未核验教材录音。',
      entries: reviewed,
    },
    null,
    2,
  ) + '\n',
)

const sources = JSON.parse(await readFile('public/data/raw-sources.json', 'utf8'))
const catalog = []
for (const [grade, term] of [
  [4, 'upper'],
  [4, 'lower'],
  [5, 'upper'],
  [5, 'lower'],
  [6, 'upper'],
  [6, 'lower'],
  [7, 'upper'],
  [7, 'lower'],
  [8, 'upper'],
  [8, 'lower'],
  [9, 'full'],
]) {
  const id = `bnu-grade${grade}-${term}`,
    semester = { upper: '上册', lower: '下册', full: '全一册' }[term]
  const raw = await readFile(`public/data/${id}.xlsx`)
  const grid = (await readSheet(raw)).map((row) => row.map((cell) => String(cell ?? '')))
  const source = sources.find(
    (s) =>
      s.sha ===
      createHash('sha1')
        .update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`), raw]))
        .digest('hex'),
  )
  if (!source) throw new Error(`Workbook source mismatch: ${id}`)
  const isReviewed = id === 'bnu-grade4-upper'
  const file = `/data/${id}${isReviewed ? '-reviewed' : ''}.csv`
  const seen = new Set()
  const rows = isReviewed
    ? reviewed.map((entry) => ({
        标识: entry.id,
        英文: entry.en,
        释义: entry.zh,
        单元: entry.unit,
        音标:
          grid.slice(1).find((row) => row[0].toLowerCase() === entry.en.toLowerCase())?.[1] ?? '',
      }))
    : grid
        .slice(1)
        .map((row, index) => ({
          标识: `${id}-source-${index + 2}`,
          英文: row[0],
          释义: row[3],
          音标: row[1],
        }))
        .filter((row) => {
          const key = JSON.stringify([row.英文, row.释义])
          if (!row.英文 || seen.has(key)) return false
          seen.add(key)
          return true
        })
  const csv = '\uFEFF' + Papa.unparse(rows)
  await writeFile('public' + file, csv)
  catalog.push({
    id,
    title: `北师大版英语 · ${grade}年级${semester}`,
    publisher: '北师大版',
    grade,
    semester,
    startGrade: grade <= 6 ? 3 : 7,
    edition: isReviewed ? '2013审定版（版次年月待核）' : '版次待核对（候选）',
    source: isReviewed
      ? 'https://keben.szxuexiao.com/html/9494.html'
      : 'https://github.com/lilinji/English',
    file,
    rows: rows.length,
    rawRows: grid.length - 1,
    sha256: createHash('sha256').update(csv).digest('hex'),
    sourceFile: source.path,
    gitBlob: source.sha,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    verification: {
      edition: 'pending',
      units: isReviewed ? 'checked' : 'pending',
      meanings: isReviewed ? 'checked' : 'pending',
    },
    contentNote: isReviewed
      ? '2013审定版：6个单元与课内释义已逐条对照扫描词汇页。版权页版次年月、ISBN、教材录音仍待核验；不适用于以 Back to school 开头的修订版。'
      : '候选资料：版次、单元和课内释义均未核验；当前保留来源词典释义，按整册学习。请先与正在使用的课本核对。',
  })
}
const newId = 'bnu-grade8-upper-2024'
const newSource = JSON.parse(await readFile(`public/data/${newId}-source.json`, 'utf8'))
const newEntries = JSON.parse(await readFile(`public/data/${newId}-entries.json`, 'utf8'))
const newUnits = [
  'Sports',
  'Safety',
  'Feelings and Emotions',
  'Role Models',
  'Travel',
  'Celebrations',
]
// Keep within-unit page order; listening words stay in their verified unit.
newEntries.sort(
  (a, b) => a.unitNumber - b.unitNumber || a.page - b.page || a.en.localeCompare(b.en, 'en'),
)
const newCsv =
  '\uFEFF' +
  Papa.unparse(
    newEntries.map((entry) => ({
      标识: `${newId}-u${entry.unitNumber}-${entry.en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      英文: entry.en,
      释义: entry.zh,
      音标: entry.phonetic,
      单元: `Unit ${entry.unitNumber} ${newUnits[entry.unitNumber - 1]}`,
      教材页码: entry.page,
      超课标星号: entry.starred ? '*' : '',
    })),
  )
await writeFile(`public/data/${newId}.csv`, newCsv)
catalog.unshift({
  id: newId,
  title: '北师大版英语 · 8年级上册（2024新版）',
  publisher: '北师大版',
  grade: 8,
  semester: '上册',
  startGrade: 7,
  edition: '2024审核新版（版权页待核）',
  source:
    'https://www.100875.com.cn/show/resourceDetail_eBookAndTeacher.html?resId=bcaea735884649bdad5d81eb2b6f652b&type=SYN&contributeId=dabd044b4c5146b79e544fe2d3e31ce9&tp=Ebook',
  file: `/data/${newId}.csv`,
  rows: newEntries.length,
  sha256: createHash('sha256').update(newCsv).digest('hex'),
  sourceFile: `${newId}-source.docx`,
  rawSha256: newSource.sha256,
  isbn: '978-7-303-30739-5',
  isbnEvidence: '出版社2025秋书目；尚未核对版权页原图',
  verification: {
    edition: 'pending',
    cover: 'checked',
    copyright: 'pending',
    units: 'checked',
    meanings: 'checked',
  },
  contentNote:
    '封面确认国家教材委员会专家委员会审核通过2024；6单元460条主词表已对照出版社课本词汇页及A-Z词表。版权页原图尚缺，版次年月待核；ISBN由出版社书目交叉确认。未含附录专名、国地名、人名。旧版独立保留，复习进度不自动迁移。',
})
const primarySourceFile = 'bnu-primary-2024-reviewed.json'
const primaryBytes = await readFile(`public/data/${primarySourceFile}`)
const primaryBooks = JSON.parse(primaryBytes).books
const primaryEvidence = JSON.parse(
  await readFile('docs/evidence/primary-2024/manifest.json', 'utf8'),
)
const primaryCatalog = []
for (const book of primaryBooks) {
  const csv =
    '\uFEFF' +
    Papa.unparse(
      book.entries.map((entry) => ({
        标识: `${book.id}-u${entry.unitNumber}-${entry.en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        英文: entry.en,
        释义: entry.zh,
        单元: book.units[entry.unitNumber - 1],
        课时: entry.lessonNumber ? `Lesson ${entry.lessonNumber}` : '',
        词汇表页码: entry.vocabularyPage,
        超课标星号: entry.starred ? '*' : '',
      })),
    )
  await writeFile(`public/data/${book.id}.csv`, csv)
  const evidenceFiles = primaryEvidence.books.find((entry) => entry.id === book.id).evidenceFiles
  primaryCatalog.push({
    id: book.id,
    title: `北师大版英语 · ${book.grade}年级${book.semester}（2024新版）`,
    publisher: '北师大版',
    grade: book.grade,
    semester: book.semester,
    startGrade: 3,
    edition: '2024审核新版（版权页待核）',
    source: book.source,
    file: `/data/${book.id}.csv`,
    rows: book.entries.length,
    sha256: createHash('sha256').update(csv).digest('hex'),
    sourceFile: primarySourceFile,
    rawSha256: createHash('sha256').update(primaryBytes).digest('hex'),
    evidenceFiles,
    evidenceAvailability: 'local-only',
    verification: {
      edition: 'pending',
      cover: 'checked',
      copyright: 'pending',
      units: 'checked',
      meanings: 'checked',
    },
    contentNote: `三年级起点；封面确认国家教材委员会专家委员会审核通过2024。${book.entries.length}条单词、短语及交际用语已逐条对照出版社Word bank 75–77页，按教材单元整理，保留课内释义。${book.entries.some((e) => e.unitNumber === 6) ? '含Review新增词条。' : 'Review未列新增词条，不另造词条。'}版权页、ISBN、音标及教材录音待核；当前使用系统英语朗读。旧版独立保留。`,
  })
}
catalog.unshift(...primaryCatalog)
await writeFile('public/data/catalog.json', JSON.stringify(catalog, null, 2) + '\n')
console.log(catalog.map((b) => `${b.id}: ${b.rows} rows`).join('\n'))
