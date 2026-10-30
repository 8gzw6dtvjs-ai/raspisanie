/* Public Google Sheet CSV keeps group headings that GViz's typed date column drops. */
(() => {
  'use strict';
  const sheet = 'https://docs.google.com/spreadsheets/d/1EobL1gXGQIg8ZKDorjweeWAKNwYYtac16jUbMAJY_O4/';
  const source = sheet + 'htmlview#gid=692423880';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const put = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  function csv(text) {
    const rows = []; let row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
        row.push(field); field = '';
        if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else field += c;
    }
    if (quoted) throw new Error('Incomplete CSV');
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function parse(text) {
    const groups = {}; let group = null;
    for (const row of csv(text)) {
      const cells = row.map(s => s.trim());
      const heading = cells.find(s => /^[А-ЯЁA-Z]+\s*\d{1,2}\s*-\s*\d{2}[А-ЯЁA-Z]*$/i.test(s));
      if (heading) { group = heading.replace(/\s+/g, ''); groups[group] ||= []; continue; }
      if (!group) continue;
      const m = (cells[1] || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
      if (!m) continue;
      const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const date = new Date(Date.UTC(year, +m[2] - 1, +m[1]));
      if (date.getUTCDate() !== +m[1] || date.getUTCMonth() !== +m[2] - 1) continue;
      groups[group].push({date: date.toISOString().slice(0,10), time: cells[2] || '', module: cells[3] || '', teacher: cells[4] || '', room: cells[5] || ''});
    }
    if (!Object.values(groups).some(rows => rows.length)) throw new Error('No practice rows');
    Object.values(groups).forEach(rows => rows.sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)));
    return groups;
  }
  const WD = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const WDS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const isoDate = date => date.toISOString().slice(0, 10);
  const addDays = (iso, count) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + count); return isoDate(d); };
  const ddmm = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7);
  function today() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('ru-RU', {timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date()).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function weeksFor(rows) {
    const weeks = new Map();
    for (const row of rows) {
      const offset = (new Date(row.date + 'T00:00:00Z').getUTCDay() + 6) % 7;
      const start = addDays(row.date, -offset);
      if (!weeks.has(start)) weeks.set(start, {start, length:6});
      if (offset === 6) weeks.get(start).length = 7;
    }
    return [...weeks.values()].sort((a,b) => a.start.localeCompare(b.start));
  }
  // Expose the data functions for verification without a browser.
  if (typeof document === 'undefined') { globalThis.practiceParser = {csv, parse, weeksFor, addDays}; return; }
  let data = null, busy = false, active = false, lastAttempt = 0;
  let group = get('practice-group') || 'ОИБ11-24П';
  const selected = {week:null, day:0};
  let message = '';
  $('practiceSource').href = source;
  function render() {
    $('practiceStatus').textContent = message;
    if (!data) { $('practiceContent').innerHTML = '<div class="empty">Расписание практики пока не загружено. Проверь интернет или открой исходную таблицу ниже.</div>'; return; }
    const names = Object.keys(data.groups);
    if (!names.includes(group)) group = names[0];
    if (Array.from($('practiceGroup').options).map(option => option.value).join('|') !== names.join('|')) {
      $('practiceGroup').innerHTML = names.map(name => `<option>${esc(name)}</option>`).join('');
    }
    $('practiceGroup').value = group;
    $('practiceGroup').disabled = false;
    $('practiceGroupName').textContent = group;
    const rows = data.groups[group] || [];
    const weeks = weeksFor(rows);
    const now = today();
    if (!weeks.length) {
      $('practiceWeeks').innerHTML = ''; $('practiceDays').innerHTML = '';
      $('practiceContent').innerHTML = '<div class="day"><div class="empty">Для этой группы в таблице пока нет дат практики.</div></div>'; return;
    }
    if (!weeks.some(w => w.start === selected.week)) {
      const upcoming = rows.find(row => row.date >= now) || rows[rows.length - 1];
      const current = weeks.find(w => w.start <= now && addDays(w.start, w.length - 1) >= now);
      const target = current || weeks.find(w => w.start <= upcoming.date && addDays(w.start, w.length - 1) >= upcoming.date);
      selected.week = target.start;
      if (selected.day !== 'all') selected.day = Math.round((new Date((current ? now : upcoming.date) + 'T00:00:00Z') - new Date(target.start + 'T00:00:00Z')) / 86400000);
    }
    const week = weeks.find(w => w.start === selected.week);
    if (selected.day !== 'all' && selected.day >= week.length) selected.day = 0;
    $('practiceWeeks').innerHTML = weeks.map(w => `<button class="chip" type="button" aria-pressed="${w.start === selected.week}" data-pw="${w.start}">${ddmm(w.start)}–${ddmm(addDays(w.start, w.length - 1))}</button>`).join('');
    const dates = Array.from({length:week.length}, (_, day) => addDays(week.start, day));
    $('practiceDays').innerHTML = dates.map((date, day) => `<button class="chip day${date === now ? ' today' : ''}" type="button" aria-pressed="${selected.day === day}" data-pd="${day}"><b>${WDS[day]}</b><span>${date.slice(8,10)}</span></button>`).join('') + `<button class="chip day" type="button" aria-pressed="${selected.day === 'all'}" data-pd="all"><b>Вся</b><span>неделя</span></button>`;
    function dayHTML(date) {
      const day = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
      const entries = rows.filter(row => row.date === date);
      const content = entries.length ? `<ol class="pairs">${entries.map(row => {
        const times = row.time.match(/\d{1,2}[:.]\d{2}/g) || [];
        const time = times.length === 2 ? times.map(t => esc(t.replace('.', ':'))).join('<br>') : esc(row.time);
        return `<li class="pair practice-pair"><div class="pn"><span class="num">УП</span><span class="tm">${time}</span></div><div class="body"><div class="lesson">${row.module ? `<span class="code">${esc(row.module)}</span>` : ''}<div class="ttl">Учебная практика</div><div class="who">${esc(row.teacher || 'Преподаватель не указан')}</div>${row.time ? '' : '<div class="note">Время в таблице не указано</div>'}${row.room ? '' : '<div class="note">Лаборатория не указана</div>'}</div></div><span class="room">${esc(row.room)}</span></li>`;
      }).join('')}</ol>` : '<div class="empty">На этот день практики в таблице нет.</div>';
      return `<section class="day${date === now ? ' is-today' : ''}"><h2><span>${WD[day]}</span><span class="d">${ddmm(date)}${date === now ? ' · сегодня' : ''}</span></h2>${content}</section>`;
    }
    $('practiceContent').innerHTML = (selected.day === 'all' ? dates : [dates[selected.day]]).map(dayHTML).join('');
  }
  async function refresh() {
    if (busy) return;
    busy = true; lastAttempt = Date.now(); $('practiceRefresh').disabled = true;
    message = 'Проверяю обновления…'; render();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(sheet + 'export?format=csv&gid=692423880&t=' + Date.now(), {cache:'no-store', credentials:'omit', signal:controller.signal});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const groups = parse(await response.text());
      data = {groups, updated: new Date().toISOString()};
      put('practice-cache-v1', JSON.stringify(data));
      message = 'Проверено ' + new Intl.DateTimeFormat('ru-RU', {timeZone:'Europe/Moscow', day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(data.updated)) + ' (МСК).';
    } catch {
      message = data ? 'Нет связи с таблицей. Показана сохранённая копия от ' + new Date(data.updated).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'}) + ' (МСК). Сверься с источником.' : 'Не удалось прочитать таблицу. Проверь интернет и доступ по ссылке, затем нажми «Обновить».';
    } finally { clearTimeout(timer); busy = false; $('practiceRefresh').disabled = false; render(); }
  }
  try { const cached = JSON.parse(get('practice-cache-v1')); if (cached?.groups && cached?.updated && Object.values(cached.groups).every(Array.isArray)) { data = cached; message = 'Сохранённая копия от ' + new Date(cached.updated).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'}) + ' (МСК).'; } } catch {}
  function selectTab(practice) {
    active = practice;
    ['scheduleHeader','main','scheduleFooter'].forEach(id => $(id).hidden = practice);
    $('practicePanel').hidden = !practice;
    $('scheduleTab').setAttribute('aria-selected', String(!practice));
    $('practiceTab').setAttribute('aria-selected', String(practice));
    if (practice) { render(); if (Date.now() - lastAttempt > 60000) refresh(); }
  }
  $('scheduleTab').onclick = () => selectTab(false);
  $('practiceTab').onclick = () => selectTab(true);
  $('practiceGroup').onchange = event => { group = event.target.value; put('practice-group', group); render(); };
  $('practiceWeeks').addEventListener('click', event => {
    const button = event.target.closest('[data-pw]'); if (!button) return;
    selected.week = button.dataset.pw; render();
  });
  $('practiceDays').addEventListener('click', event => {
    const button = event.target.closest('[data-pd]'); if (!button) return;
    selected.day = button.dataset.pd === 'all' ? 'all' : +button.dataset.pd; render();
  });
  $('practiceRefresh').onclick = refresh;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active && Date.now() - lastAttempt > 60000) refresh(); });
  window.addEventListener('online', () => { if (active) refresh(); });
  setInterval(() => { if (active && !document.hidden) refresh(); }, 5 * 60000);
})();
