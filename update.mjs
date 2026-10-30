// Забирает расписание КТ МТУСИ из таблицы на Google Диске и пишет data.json.
// Запускается GitHub Actions раз в час (см. .github/workflows/update.yml).
// Локально: npm i jsdom && node update.mjs
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const FILE_ID = process.env.SHEET_ID || '1RRrdDgLjqfFRYhjbxTdcJY_iNvP3ZEuu';
const GROUP = process.env.GROUP || 'ОИБ11-24П';
const OUT = process.env.OUT || 'data.json';
const BASE = `https://docs.google.com/spreadsheets/d/${FILE_ID}/htmlview`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WD = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === 2) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
  }
}

const unesc = (s) => s
  .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\(.)/g, '$1');

// ---------- разбор одного листа (та же логика, что проверена в браузере) ----------
function toRgb(v) {
  v = (v || '').trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) v = '#' + [...m[1]].map((c) => c + c).join('');
  m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/);
  if (m) return `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})`;
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `rgb(${m[1]},${m[2]},${m[3]})`;
  if (v === 'red') return 'rgb(255,0,0)';
  return v.replace(/\s/g, '');
}

function cssMap(doc) {
  const m = {};
  for (const ss of doc.styleSheets) {
    let rules;
    try { rules = ss.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (!r.selectorText || !r.style) continue;
      const sels = r.selectorText.match(/\.s\d+\b/g);
      if (!sels) continue;
      const st = r.style;
      const css = st.cssText || '';
      const val = (p) => st.getPropertyValue(p) || ((css.match(new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)', 'i')) || [])[1] || '');
      for (const s of sels) {
        m[s.slice(1)] = {
          bg: toRgb(val('background-color')),
          color: toRgb(val('color')),
          strike: /line-through/.test(val('text-decoration') + ' ' + val('text-decoration-line') + ' ' + css),
        };
      }
    }
  }
  return m;
}

function cellText(c) {
  let s = '';
  const walk = (n) => {
    n.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) s += ch.nodeValue;
      else if (ch.nodeName === 'BR') s += '\n';
      else { walk(ch); if (/^(DIV|P)$/.test(ch.nodeName)) s += '\n'; }
    });
  };
  walk(c);
  return s.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function extractWeek(doc) {
  const css = cssMap(doc);
  const table = doc.querySelector('table.waffle') || doc.querySelector('table');
  if (!table) return { groups: {} };
  const rows = [...table.rows];
  const G = [];
  rows.forEach((r, ri) => {
    G[ri] = G[ri] || [];
    let ci = 0;
    [...r.cells].forEach((c) => {
      while (G[ri][ci] !== undefined) ci++;
      const v = { c, r0: ri, c0: ci, rs: c.rowSpan || 1, cs: c.colSpan || 1 };
      for (let a = 0; a < v.rs; a++)
        for (let b = 0; b < v.cs; b++) (G[ri + a] = G[ri + a] || [])[ci + b] = v;
      ci += v.cs;
    });
  });
  const T = new Map();
  const tx = (v) => { if (!v) return ''; if (!T.has(v.c)) T.set(v.c, cellText(v.c)); return T.get(v.c); };
  const flags = (v) => {
    if (!v) return '';
    let f = '';
    for (const k of (v.c.className || '').split(/\s+/)) {
      const s = css[k]; if (!s) continue;
      if (s.color === 'rgb(255,0,0)' || s.bg === 'rgb(180,167,214)') f += 'c';
      if (s.strike) f += 'x';
    }
    return [...new Set(f)].join('');
  };
  const GRP = /^[А-ЯЁ]{2,5}\d{1,2}-\d{2,3}[А-ЯЁа-яё]*$/;
  let hr = -1, best = 0;
  G.forEach((row, ri) => {
    if (!row) return;
    let n = 0;
    row.forEach((v, ci) => { if (v && v.r0 === ri && v.c0 === ci && GRP.test(tx(v))) n++; });
    if (n > best) { best = n; hr = ri; }
  });
  const lab = { day: new Set(), num: new Set(), time: new Set() };
  for (const ri of [hr - 1, hr]) {
    (G[ri] || []).forEach((v, ci) => {
      if (!v || v.c0 !== ci) return;
      const t = tx(v).toLowerCase();
      if (t.startsWith('дни')) lab.day.add(ci);
      else if (t.startsWith('№')) lab.num.add(ci);
      else if (t.startsWith('время')) lab.time.add(ci);
    });
  }
  const nearest = (set, ci) => [...set].filter((x) => x < ci).sort((a, b) => b - a)[0];
  const groups = {};
  (G[hr] || []).forEach((v, ci) => {
    if (!v || v.r0 !== hr || v.c0 !== ci) return;
    const name = tx(v);
    if (!GRP.test(name)) return;
    const gc = ci, rc = ci + v.cs;
    const dc = nearest(lab.day, gc), nc = nearest(lab.num, gc), tc = nearest(lab.time, gc);
    if (dc === undefined || nc === undefined) return;
    const half = (row) => {
      const sv = G[row] && G[row][gc];
      const s = tx(sv);
      if (!s) return null;
      const rv = G[row] && G[row][rc];
      const r = rv && rv !== sv ? tx(rv) : '';
      return [s, r, flags(sv)];
    };
    const days = [];
    let cur = null;
    for (let ri = hr + 1; ri < G.length; ri++) {
      const nv = G[ri] && G[ri][nc];
      if (!nv || nv.r0 !== ri || !/^\d+$/.test(tx(nv))) continue;
      const dl = tx(G[ri][dc]).replace(/\n/g, ' ');
      if (!dl) continue;
      if (!cur || cur.label !== dl) { cur = { label: dl, pairs: [] }; days.push(cur); }
      const top = ri, bot = nv.rs >= 2 ? ri + 1 : ri;
      const a = half(top), b = half(bot);
      let cell = null;
      if (a || b) cell = JSON.stringify(a) === JSON.stringify(b) ? a : { a, b };
      cur.pairs.push({ n: +tx(nv), t: tc !== undefined ? tx(G[ri][tc]) : '', cell });
    }
    groups[name] = days;
  });
  return { groups };
}

// ---------- сборка data.json ----------
function build(sheets) {
  const S = [''], SI = new Map([['', 0]]);
  const e = (s) => { s = s || ''; if (!SI.has(s)) { SI.set(s, S.length); S.push(s); } return SI.get(s); };
  const H = (h) => (h ? (h[2] ? [e(h[0]), e(h[1]), h[2]] : [e(h[0]), e(h[1])]) : 0);
  const weeks = sheets.map((w) => {
    const dated = {};
    Object.values(w.groups).forEach((ds) => ds.forEach((d) => {
      const m = d.label.toLowerCase().match(/^(\S+)\s+(\d{1,2}\.\d{2})/);
      if (m && WD.indexOf(m[1]) >= 0) dated[WD.indexOf(m[1])] = m[2].padStart(5, '0');
    }));
    const groups = {};
    for (const [name, ds] of Object.entries(w.groups)) {
      groups[name] = ds.map((d) => {
        const wi = WD.indexOf(d.label.toLowerCase().split(/\s/)[0]);
        const ps = d.pairs.filter((p) => p.cell).map((p) => {
          let c = p.cell;
          if (c.a !== undefined) {
            const a = c.a, b = c.b;
            if (a && b && a[0] === b[0] && a[2] === b[2] && (!a[1] || !b[1])) c = [a[0], a[1] || b[1], a[2]];
          }
          return [p.n, e(p.t), Array.isArray(c) ? H(c) : { a: H(c.a), b: H(c.b) }];
        });
        return [wi, ps];
      });
    }
    const m = w.name.match(/(\d{1,2}\.\d{2})\s*-\s*(\d{1,2}\.\d{2})/);
    return {
      gid: w.gid,
      name: w.name.trim(),
      ready: !/не\s*готово/i.test(w.name),
      parity: /знаменат/i.test(w.name) ? 'з' : (/числит/i.test(w.name) ? 'ч' : ''),
      from: m ? m[1] : '', to: m ? m[2] : '',
      dates: WD.slice(0, 6).map((_, i) => dated[i] || ''),
      total: Object.keys(w.groups).length,
      groups,
    };
  });
  return { S, weeks };
}

async function main() {
  const top = await get(BASE);
  const sheets = [];
  const re = /items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "(?:[^"\\]|\\.)*", gid: "(\d+)"/g;
  let m;
  while ((m = re.exec(top))) sheets.push({ name: unesc(m[1]), gid: m[2] });
  if (!sheets.length) throw new Error('Не нашёл листы в таблице (поменялась разметка Google?)');

  const parsed = [];
  for (const s of sheets) {
    const html = await get(`${BASE}/sheet?headers=true&gid=${s.gid}`);
    const dom = new JSDOM(html);
    const { groups } = extractWeek(dom.window.document);
    dom.window.close();
    console.log(`лист «${s.name}»: групп ${Object.keys(groups).length}, ${GROUP}: ${groups[GROUP] ? 'есть' : 'нет'}`);
    parsed.push({ ...s, groups });
  }
  if (!parsed.some((p) => Object.keys(p.groups).length)) throw new Error('Ни одной группы не разобрано — data.json не трогаю');

  const body = build(parsed);
  const now = new Date().toISOString();
  let prev = null;
  if (existsSync(OUT)) { try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (e) {} }
  const same = prev && JSON.stringify({ S: prev.S, weeks: prev.weeks }) === JSON.stringify(body);
  const data = { v: 3, group: GROUP, updated: now, changed: same ? (prev.changed || prev.updated) : now, src: BASE, ...body };
  writeFileSync(OUT, JSON.stringify(data));
  console.log(same ? 'Изменений в расписании нет' : 'Расписание изменилось');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? 'false' : 'true'}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Расписание ${GROUP}\n\n| Лист | Групп | ${GROUP} |\n|---|---|---|\n` +
      data.weeks.map((w) => `| ${w.name} | ${w.total} | ${w.groups[GROUP] ? w.groups[GROUP].reduce((n, d) => n + d[1].length, 0) + ' пар' : '—'} |`).join('\n') +
      `\n\n${same ? 'Без изменений' : 'Есть изменения'} · ${now}\n`);
  }
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
