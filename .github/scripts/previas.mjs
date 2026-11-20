// Gera um print (640x400) de cada site público com GitHub Pages da conta.
// Arquivo de saída: <dono>__<repo>.jpg  +  index.json com a data de cada print.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pasta = process.argv[2] || 'saida';
const dono = process.env.DONO;
const painel = process.env.REPO_PAINEL || 'central-de-sites';
const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };

await mkdir(pasta, { recursive: true });

const repos = [];
for (let page = 1; page <= 10; page++) {
  const lote = await fetch(`https://api.github.com/users/${dono}/repos?per_page=100&page=${page}`, { headers }).then((r) => r.json());
  repos.push(...lote);
  if (lote.length < 100) break;
}
const alvos = repos
  .filter((r) => r.has_pages && r.name !== painel)
  .map((r) => ({
    nome: `${r.owner.login}__${r.name}`,
    // O endereço padrão redireciona sozinho para o domínio próprio, se houver.
    url: r.name.toLowerCase() === `${r.owner.login.toLowerCase()}.github.io`
      ? `https://${r.owner.login.toLowerCase()}.github.io/`
      : `https://${r.owner.login.toLowerCase()}.github.io/${r.name}/`,
  }));

console.log(`Sites encontrados: ${alvos.length}`);
const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.5 });
const indice = {};

for (const alvo of alvos) {
  const pagina = await contexto.newPage();
  try {
    await pagina.goto(`${alvo.url}?previa=${Date.now()}`, { waitUntil: 'load', timeout: 30000 });
    await pagina.waitForTimeout(2500); // animações de entrada
    await pagina.screenshot({ path: join(pasta, `${alvo.nome}.jpg`), type: 'jpeg', quality: 70 });
    indice[alvo.nome] = new Date().toISOString();
    console.log(`ok   ${alvo.url}`);
  } catch (e) {
    console.log(`erro ${alvo.url}: ${e.message.split('\n')[0]}`);
  } finally {
    await pagina.close();
  }
}

await navegador.close();
await writeFile(join(pasta, 'index.json'), JSON.stringify(indice, null, 2));
