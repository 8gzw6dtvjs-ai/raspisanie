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
  // Export a small parser surface for verification without a browser.
  if (typeof document === 'undefined') { globalThis.practiceParser = {csv, parse}; return; }
  let data = null, busy = false, active = false, lastAttempt = 0;
  let group = get('practice-group') || 'ОИБ11-24П';
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
    const selected = $('practiceDate').value;
    const rows = (data.groups[group] || []).filter(row => !selected || row.date === selected);
    $('practiceContent').innerHTML = rows.length ? rows.map(row => {
      const label = new Intl.DateTimeFormat('ru-RU', {timeZone:'UTC', weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'}).format(new Date(row.date + 'T00:00:00Z'));
      return `<section class="day"><h2>${esc(label)}</h2><div class="practice-entry"><div class="code">${esc(row.module || 'Учебная практика')}</div><div class="ttl">${esc(row.time || 'Время в таблице не указано')}</div><div class="who">${esc(row.teacher || 'Преподаватель не указан')}</div><div class="note">Лаборатория: ${esc(row.room || 'не указана')}</div></div></section>`;
    }).join('') : '<div class="empty">На выбранную дату практики для этой группы в таблице нет.</div>';
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
  $('practiceDate').onchange = render;
  $('practiceAll').onclick = () => { $('practiceDate').value = ''; render(); };
  $('practiceRefresh').onclick = refresh;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active && Date.now() - lastAttempt > 60000) refresh(); });
  window.addEventListener('online', () => { if (active) refresh(); });
  setInterval(() => { if (active && !document.hidden) refresh(); }, 5 * 60000);
})();
