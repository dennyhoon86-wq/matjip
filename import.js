const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'matjip.db');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

function cellText(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.result !== undefined) return cellText(v.result);
    if (v.error) return null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || t === '-') return null;
    return t;
  }
  return v;
}

function toNum(v) {
  const t = cellText(v);
  if (t == null) return null;
  const n = typeof t === 'number' ? t : parseFloat(String(t).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const BADGE_RE = /^(미슐랭|블루리본|더들리|수요미식회|맛있는\s*녀석들|최신|신규)(★*)$/;

function parseSource(raw) {
  if (!raw) return { sources: [], badges: [] };
  const tokens = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  const sources = [];
  const badges = [];
  for (const tok of tokens) {
    const m = tok.match(BADGE_RE);
    if (m) badges.push({ name: m[1], stars: m[2].length });
    else sources.push(tok);
  }
  return { sources, badges };
}

function regionOf(addr1) {
  if (!addr1) return '기타';
  if (addr1.startsWith('서울')) return '서울';
  if (addr1.startsWith('제주')) return '제주';
  return '지방';
}

async function main() {
  const wb = new ExcelJS.Workbook();
  console.log('엑셀 로딩 중...');
  await wb.xlsx.readFile('../맛집 정리(ver.6).xlsx');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      address TEXT,
      gu TEXT,
      dong TEXT,
      subway TEXT,
      price_range TEXT,
      source_raw TEXT,
      sources TEXT,
      badges TEXT,
      naver REAL,
      google REAL,
      daum REAL,
      avg REAL,
      note TEXT,
      grade TEXT,
      region TEXT,
      status TEXT,
      origin_sheet TEXT
    );
    CREATE INDEX idx_r_category ON restaurants(category);
    CREATE INDEX idx_r_gu ON restaurants(gu);
    CREATE INDEX idx_r_dong ON restaurants(dong);
    CREATE INDEX idx_r_subway ON restaurants(subway);
    CREATE INDEX idx_r_grade ON restaurants(grade);
    CREATE INDEX idx_r_status ON restaurants(status);
    CREATE INDEX idx_r_region ON restaurants(region);
    CREATE INDEX idx_r_avg ON restaurants(avg);
    CREATE INDEX idx_r_name ON restaurants(name);
  `);

  const insert = db.prepare(`
    INSERT INTO restaurants
    (name, category, address, gu, dong, subway, price_range, source_raw, sources, badges,
     naver, google, daum, avg, note, grade, region, status, origin_sheet)
    VALUES (@name, @category, @address, @gu, @dong, @subway, @price_range, @source_raw, @sources, @badges,
     @naver, @google, @daum, @avg, @note, @grade, @region, @status, @origin_sheet)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });

  let totalInserted = 0;
  const skipSheets = new Set(['정리', 'Sheet3']);

  wb.eachSheet((sheet) => {
    if (skipSheets.has(sheet.name)) { console.log('스킵:', sheet.name); return; }

    const headerRow = sheet.getRow(1);
    const colMap = {};
    for (let c = 1; c <= sheet.columnCount; c++) {
      const label = cellText(headerRow.getCell(c).value);
      if (label) colMap[label] = c;
    }
    // 등급(A/B/C/D/E)은 관례상 "마지막 라벨 컬럼"에 들어있는데, 뒤에 추가한 "최신여부" 같은
    // 메타 컬럼은 등급 컬럼이 아니므로 lastCol 계산에서 제외한다.
    const NON_GRADE_TRAILING_COLS = new Set(['최신여부']);
    const labeledCols = Object.entries(colMap)
      .filter(([label]) => !NON_GRADE_TRAILING_COLS.has(label))
      .map(([, c]) => c);
    const lastCol = labeledCols.length ? Math.max(...labeledCols) : sheet.columnCount;
    const status = sheet.name.startsWith('페점') ? '폐업' : '영업';

    const get = (row, label) => colMap[label] ? cellText(row.getCell(colMap[label]).value) : null;

    const rows = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = get(row, '상호명');
      if (!name) continue;

      const addr1 = get(row, '주소1');
      const sourceRaw = get(row, '출처');
      const { sources, badges } = parseSource(sourceRaw);
      const newFlag = get(row, '최신여부');
      const isDiningCodeOnly = sources.length === 1 && sources[0].replace(/\s+/g, '') === '다이닝코드';
      if ((newFlag || isDiningCodeOnly) && !badges.some(b => b.name === '신규')) {
        badges.push({ name: '신규', stars: 0 });
      }
      const gradeRaw = cellText(row.getCell(lastCol).value);
      const grade = (gradeRaw && /^(A\+{0,2}|B|C|D|E|F)$/.test(gradeRaw)) ? gradeRaw : null;
      const priceRaw = get(row, '2인기준 디너 가격 (원)');

      rows.push({
        name,
        category: get(row, '분류'),
        address: addr1,
        gu: get(row, '주소2'),
        dong: get(row, '주소3'),
        subway: get(row, '지하철'),
        price_range: priceRaw != null ? String(priceRaw) : null,
        source_raw: sourceRaw,
        sources: JSON.stringify(sources),
        badges: JSON.stringify(badges),
        naver: colMap['네이버'] ? toNum(row.getCell(colMap['네이버']).value) : null,
        google: colMap['구글'] ? toNum(row.getCell(colMap['구글']).value) : null,
        daum: colMap['다음'] ? toNum(row.getCell(colMap['다음']).value) : null,
        avg: colMap['평균'] ? toNum(row.getCell(colMap['평균']).value) : null,
        note: get(row, '비고'),
        grade,
        region: regionOf(addr1),
        status,
        origin_sheet: sheet.name,
      });
    }
    insertMany(rows);
    totalInserted += rows.length;
    console.log(sheet.name, '->', rows.length, '건 삽입');
  });

  console.log('총 삽입:', totalInserted);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
