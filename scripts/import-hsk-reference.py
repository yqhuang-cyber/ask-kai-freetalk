"""Rebuild factual HSK indexes from the official PDF supplied as argv[1].
Requires pdfplumber; no network access, learner data, or source PDF output.
"""
from pathlib import Path
import sys, re, json, hashlib, collections
import pdfplumber

SOURCE = 'https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf'
EXPECTED_GRAMMAR = {'1': 70, '2': 78, '3': 96, '4': 95, '5': 70, '6': 49, '7-9': 134}
EXPECTED_VOCABULARY = {'1': 300, '2': 200, '3': 500, '4': 1000, '5': 1600, '6': 1800, '7-9': 5600}
source_pdf = Path(sys.argv[1])
output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('apps/hskai-mock/data')
items, vocabulary = [], []
with pdfplumber.open(source_pdf) as pdf:
    if len(pdf.pages) != 406:
        raise ValueError('Wrong HSK syllabus version: expected 406 pages')
    # Filter large rotated watermark glyphs before extracting actual table text.
    for pn in range(79, 355):
        page = pdf.pages[pn].filter(lambda o: o['object_type'] != 'char' or o['size'] < 30)
        for line in page.extract_text().splitlines():
            match = re.match(r'^(\d+)\s+(7-9|[1-6])(?:（[^）]+）)*\s+([^\s]+)', line)
            if match:
                vocabulary.append({'index': int(match[1]), 'level': match[2], 'word': match[3]})
    for level, start, end in [(1,385,388),(2,388,391),(3,391,394),(4,394,397),(5,397,400),(6,400,402),(7,402,406)]:
        category, detail, number = '', '', 0
        for pn in range(start, end):
            page = pdf.pages[pn].filter(lambda o: o['object_type'] != 'char' or o['size'] < 30)
            tables = page.extract_tables()
            if len(tables) != 1:
                raise ValueError(f'Unrecognized grammar table at PDF page {pn+1}')
            for row in tables[0][1:]:
                cells = [re.sub(r'\s+', '', cell or '') for cell in row]
                if cells[0]:
                    category = cells[0]
                    detail = ''
                if cells[1]:
                    detail = cells[1]
                if cells[2]:
                    detail = cells[2]
                body = cells[3] or detail
                if not body:
                    continue
                number += 1
                # Compact index label, never reproduce the full document/layout.
                label = re.sub(r'^（\d+）', '', body)[:90]
                items.append({'kp_id':f'hsk2025-g{level}-{number:03d}','introduced_level':'7-9' if level == 7 else str(level),'category':category,'label':label,'source_page':pn-2,'source_row':number})
if len(vocabulary) != 11000 or {v['index'] for v in vocabulary} != set(range(1,11001)):
    raise ValueError('Incomplete vocabulary extraction')
if dict(collections.Counter(v['level'] for v in vocabulary)) != EXPECTED_VOCABULARY:
    raise ValueError('Vocabulary level counts changed')
if dict(collections.Counter(v['introduced_level'] for v in items)) != EXPECTED_GRAMMAR:
    raise ValueError('Grammar table detail counts changed')
metadata = {'version':'hsk-2025-syllabus-v1','source_url':SOURCE,'source_sha256':hashlib.sha256(source_pdf.read_bytes()).hexdigest()}
output.mkdir(parents=True, exist_ok=True)
(output/'hsk-2025-grammar.json').write_text(json.dumps({**metadata,'unit':'syllabus_table_detail','counts_by_level':EXPECTED_GRAMMAR,'entries':items}, ensure_ascii=False, indent=2)+'\n')
(output/'hsk-2025-vocabulary.json').write_text(json.dumps({**metadata,'unit':'syllabus_vocabulary_entry','counts_by_level':EXPECTED_VOCABULARY,'entries':vocabulary}, ensure_ascii=False, separators=(',',':'))+'\n')
print('Verified 11000 vocabulary entries and 592 grammar table details; source PDF not copied.')
