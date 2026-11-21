import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';

const api = 'https://www.vitipendium.de/api.php';
const output = new URL('./public/', import.meta.url);

async function query(parameters) {
    const url = new URL(api);
    url.search = new URLSearchParams({action: 'query', format: 'json', ...parameters});
    const response = await fetch(url, {
        headers: {'User-Agent': 'VitipendiumSitemap/1.0 (public sitemap generator)'},
        redirect: 'error',
        signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error('Wiki API: HTTP ' + response.status);
    const result = await response.json();
    if (result.error || !result.query) throw new Error('Wiki API: ' + (result.error?.code ?? 'query missing'));
    return result;
}

const site = await query({meta: 'siteinfo', siprop: 'namespaces'});
const portal = Object.values(site.query.namespaces).find(namespace => namespace.canonical === 'Portal');
if (!portal) throw new Error('Portal namespace not found');

const urls = new Set();
for (const namespace of [0, portal.id]) {
    let continuation = {};
    let count = 0;
    do {
        const result = await query({
            generator: 'allpages', gapnamespace: namespace, gaplimit: '250', gapfilterredir: 'nonredirects',
            prop: 'info|pageprops', inprop: 'url', ppprop: 'noindex', ...continuation
        });
        for (const page of Object.values(result.query.pages ?? {})) {
            if (Object.hasOwn(page.pageprops ?? {}, 'noindex')) continue;
            const url = new URL(page.canonicalurl);
            if (url.origin !== 'https://www.vitipendium.de' || url.search || url.hash ||
                /^\/index\.php(?:\/|$)/.test(url.pathname)) {
                throw new Error('Unexpected canonical URL for ' + page.title);
            }
            urls.add(url.href);
            count++;
        }
        continuation = result.continue;
    } while (continuation);
    if (!count) throw new Error('No URLs in namespace ' + namespace);
}
if (urls.size > 50000) throw new Error('Sitemap exceeds 50,000 URLs');

const entries = [...urls].sort().map(url => '  <url><loc>' +
    url.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
       .replaceAll('"', '&quot;').replaceAll("'", '&apos;') + '</loc></url>');
await mkdir(output, {recursive: true});
await writeFile(new URL('sitemap.xml', output), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries, '</urlset>', ''
].join('\n'));
await writeFile(new URL('index.html', output),
    '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Vitipendium-Sitemap</title><p><a href="sitemap.xml">XML-Sitemap für Vitipendium</a></p></html>\n');
const verification = new URL('./verification/', import.meta.url);
const files = await readdir(verification).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
});
for (const name of files) {
    if (!/^google[a-f0-9]+\.html$/.test(name)) continue;
    await copyFile(new URL(name, verification), new URL(name, output));
}
console.log('Generated sitemap: ' + urls.size + ' canonical URLs.');
