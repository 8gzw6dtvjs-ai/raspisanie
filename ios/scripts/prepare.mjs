import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const dest = new URL('../Resources/', import.meta.url);
await mkdir(dest, {recursive:true});
let html = await readFile(new URL('index.html', root), 'utf8');
const needle = "fetch('data.json?t=' + Date.now(), { cache: 'no-store' })";
if (!html.includes(needle)) throw new Error('Загрузка данных в index.html изменилась: обновите адаптер iOS');
html = html.replace(needle, `Promise.resolve({ok: true, json: () => Promise.resolve(window.__NATIVE_DATA__)})`);
html = html.replace("  let shown = false;", "  let shown = false;\n  window.addEventListener('native-schedule', (event) => show(event.detail));");
html = html.replace("if ('serviceWorker' in navigator)", "if (false && 'serviceWorker' in navigator)");
await writeFile(new URL('index.html', dest), html);
for (const name of ['data.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'manifest.webmanifest']) {
  await copyFile(new URL(name, root), new URL(name, dest));
}
