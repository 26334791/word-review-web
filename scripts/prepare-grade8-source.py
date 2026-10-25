"""Rebuild the reviewed new-edition main word list from the publisher's saved DOCX.
Unit ranges and listening-script exceptions were checked against textbook pp.166-179.
No network requests or third-party Python dependencies.
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

source = Path('public/data/bnu-grade8-upper-2024-source.docx')
if not source.exists():
    raise SystemExit('原始出版社DOCX不随公开源码分发。重建CSV无需该文件；如需重新审校，请按source.json的来源和权限自行取得原件并放到此路径。')
with zipfile.ZipFile(source) as archive:
    root = ET.fromstring(archive.read('word/document.xml'))
namespace = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
entries = []
pending = ''
for paragraph in root.findall('.//w:p', namespace):
    part = ''.join(paragraph.itertext()).strip()
    if not part or re.fullmatch(r'[A-Z][a-z]', part):
        continue
    text = (pending + ' ' + part).strip()
    page = re.search(r'(\d+)\s*$', text)
    if not page:
        pending = text
        continue
    pending = ''
    text = text[:page.start()].strip()
    starred = text.startswith('*')
    text = text.lstrip('*')
    phonetic = ''
    if ' /' in text:
        en, rest = text.split(' /', 1)
        phonetic, separator, zh = rest.partition('/')
        if not separator:
            raise ValueError(text)
        phonetic = '/' + phonetic + '/'
    else:
        meaning = re.search(r'[\u4e00-\u9fff（(]', text)
        if not meaning:
            raise ValueError(text)
        en, zh = text[:meaning.start()], text[meaning.start():]
    page = int(page[1])
    # Textbook Tapescripts pp.135-140 correspond to Units 1-6, not new units.
    if 135 <= page <= 140:
        unit = page - 134
    elif 1 <= page <= 132:
        unit = next(i for i, end in enumerate([22, 44, 66, 88, 110, 132], 1) if page <= end)
    else:
        raise ValueError(f'Unverified page: {page}')
    entries.append(dict(en=en.strip(), zh=zh.strip(), phonetic=phonetic, page=page,
                        starred=starred, unitNumber=unit))

assert not pending, 'Incomplete final word'
assert len(entries) == len({entry['en'] for entry in entries}) == 460
assert [sum(e['unitNumber'] == n for e in entries) for n in range(1, 7)] == [86, 99, 91, 74, 46, 64]
Path('public/data/bnu-grade8-upper-2024-entries.json').write_text(
    json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('460 publisher entries / 6 verified unit groups')
