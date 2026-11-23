// Interface do painel Central de Sites (roda 100% no navegador).
import { GitHub, Dados, verificarUrl, REPO_PAINEL } from './github.js?v=202611232017';

const $ = (s) => document.querySelector(s);
const CHAVE_TOKEN = 'central-de-sites:token';
// Nome do token muda por aparelho e data, porque o GitHub não aceita nomes repetidos.
const APARELHO = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Computador';
const LINK_TOKEN = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description='
  + encodeURIComponent(`Central de Sites - ${APARELHO} ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);

let gh = null;
let dados = null;     // instância de Dados
let sites = [];       // sites com estado ao vivo
const verificacoes = {};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lerToken = () => { try { return localStorage.getItem(CHAVE_TOKEN) || ''; } catch { return ''; } };
const gravarToken = (t) => { try { t ? localStorage.setItem(CHAVE_TOKEN, t) : localStorage.removeItem(CHAVE_TOKEN); } catch { /* modo privado */ } };

function toast(msg, falha = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (falha ? ' falha' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), falha ? 9000 : 6000);
}

function modal({ titulo, corpo, ok = 'Confirmar', perigo = false, aoAbrir }) {
  const dlg = $('#modal');
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = corpo;
  const btn = $('#modal-ok');
  btn.textContent = ok;
  btn.className = 'btn ' + (perigo ? 'perigo' : 'primario');
  aoAbrir?.(dlg);
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok' ? new FormData($('#modal-form')) : null);
    }, { once: true });
  });
}

// ---------- Entrada / saída ----------
function mostrarEntrada(erro) {
  $('#tela-entrada').hidden = false;
  $('#aba-sites').hidden = true;
  $('#aba-historico').hidden = true;
  $('#abas').hidden = true;
  $('#conta').innerHTML = '';
  $('#link-token').href = LINK_TOKEN;
  $('#erro-entrada').hidden = !erro;
  $('#erro-entrada').textContent = erro || '';
}

$('#form-entrada').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = $('#campo-token').value.trim();
  $('#campo-token').value = '';
  if (token) await entrar(token);
});

async function entrar(token) {
  gh = new GitHub(token);
  try {
    const u = await gh.usuario();
    gravarToken(token);
    $('#tela-entrada').hidden = true;
    $('#abas').hidden = false;
    $('#aba-sites').hidden = false;
    $('#conta').innerHTML = `<img src="${esc(u.avatar_url)}" alt=""> <span>${esc(u.login)}</span> <button class="btn pequeno" id="btn-sair">Sair</button>`;
    $('#btn-sair').onclick = sair;
    dados = new Dados(gh, u.login);
    $('#lista').innerHTML = '<div class="vazio">Carregando seus sites…</div>';
    await dados.carregar();
    await carregarSites();
  } catch (e) {
    gh = null;
    if (e.status === 401) gravarToken('');
    mostrarEntrada(e.message);
  }
}

async function sair() {
  const ok = await modal({
    titulo: 'Sair deste aparelho?',
    corpo: '<p>O token é apagado deste aparelho. Para entrar de novo, você vai precisar de um token (pode criar outro).</p>',
    ok: 'Sair', perigo: true,
  });
  if (!ok) return;
  gravarToken('');
  gh = null; dados = null; sites = [];
  mostrarEntrada();
}

// ---------- Sites ----------
async function estadoDoSite(site) {
  try {
    const pages = await gh.pages(site.owner, site.repo);
    if (!pages) return { ...site, estado: 'sem-pages' };
    return {
      ...site,
      url: pages.html_url || site.url,
      estado: GitHub.estaEmManutencao(pages) ? 'desligado' : 'ligado',
      tipoPublicacao: pages.build_type === 'workflow' ? 'GitHub Actions' : `Branch ${pages.source?.branch ?? ''}`,
    };
  } catch (e) {
    return { ...site, estado: 'erro', erro: e.message };
  }
}

async function carregarSites() {
  $('#btn-atualizar').disabled = true;
  try {
    await dados.carregar();
    sites = await Promise.all(dados.dados.sites.map(estadoDoSite));
    desenhar();
    sites.forEach(verificar);
    completarCidades();
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('#btn-atualizar').disabled = false;
  }
}

async function verificar(site) {
  if (!site.url) return;
  verificacoes[site.id] = await verificarUrl(site.url);
  const el = document.querySelector(`[data-resposta="${CSS.escape(site.id)}"]`);
  if (el) el.innerHTML = textoResposta(verificacoes[site.id]);
}

function textoResposta(v) {
  if (!v) return 'Testando…';
  if (v.erro) return `⚠ ${esc(v.erro)}`;
  const tipo = v.mostrandoManutencao ? 'mostrando manutenção' : v.ok ? 'respondendo' : `erro ${v.codigo}`;
  return `${v.ok ? '●' : '⚠'} ${tipo} · ${v.ms} ms`;
}

const ROTULO = { ligado: 'No ar', desligado: 'Desligado', erro: 'Erro', 'sem-pages': 'Pages desativado' };

// Miniatura: print do site gerado pelo robô do GitHub (workflow "Miniaturas dos sites"),
// guardado no branch "previas" do repositório do painel. Imagem leve, sem rodar o site.
let versaoPrevia = Math.floor(Date.now() / 600000); // renova o cache a cada 10 min
const urlPrevias = (arquivo) => `https://raw.githubusercontent.com/${encodeURIComponent(dados.owner)}/${REPO_PAINEL}/previas/${encodeURIComponent(arquivo)}`;
function previa(s) {
  const inicial = esc((s.cliente || s.repo).trim().charAt(0).toUpperCase());
  const img = `${urlPrevias(`${s.owner}__${s.repo}.jpg`)}?v=${versaoPrevia}`;
  const conteudo = `<span class="previa-inicial" aria-hidden="true">${inicial}</span><img src="${img}" alt="" loading="lazy" decoding="async">`;
  return s.url
    ? `<a class="previa" href="${esc(s.url)}" target="_blank" rel="noopener" title="Abrir ${esc(s.cliente)}" aria-label="Abrir ${esc(s.cliente)}">${conteudo}</a>`
    : `<div class="previa">${conteudo}</div>`;
}
// Sem print ainda (site novo ou repositório privado): fica a letra inicial.
$('#lista').addEventListener('error', (ev) => {
  if (ev.target.matches?.('.previa img')) ev.target.remove();
}, true);

// Pede ao robô prints novos (só dos sites indicados, ou de todos) e, quando ficarem
// prontos, troca as miniaturas sozinho — sem precisar tocar em Atualizar.
async function tirarPrints(lista = []) {
  const inicio = Date.now();
  await gh.gerarPrevias(dados.owner, lista.map((s) => s.repo));
  const nomes = lista.map((s) => `${s.owner}__${s.repo}`);
  for (let i = 0; i < 40; i++) { // até ~5 minutos
    await new Promise((r) => setTimeout(r, 8000));
    try {
      const indice = await fetch(`${urlPrevias('index.json')}?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
      const pronto = (n) => indice[n] && Date.parse(indice[n]) > inicio - 60000;
      if (nomes.length ? nomes.every(pronto) : Object.keys(indice).some(pronto)) {
        versaoPrevia = Date.now();
        desenhar();
        return true;
      }
    } catch { /* robô ainda trabalhando */ }
  }
  return false;
}

// ---------- Cidade automática ----------
// Lê o próprio site e procura o endereço: "Barra Velha - SC", "Joinville/SC",
// ou o campo addressLocality (dados estruturados do Google).
const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function descobrirCidade(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return '';
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const texto = [doc.title, doc.querySelector('meta[name="description"]')?.content || '', doc.body?.textContent || ''].join('\n');
    const votos = {};
    const votar = (c, peso = 1) => { c = c.replace(/\s+/g, ' ').trim(); if (c.length > 2) votos[c] = (votos[c] || 0) + peso; };
    for (const m of html.matchAll(/"addressLocality"\s*:\s*"([^"]{2,40})"/g)) votar(m[1], 5);
    const P = '[A-ZÀ-Ý][a-zà-ÿ]+';
    const re = new RegExp(`(${P}(?:\\s+(?:d[aeo]s?\\s+)?${P}){0,3})\\s*(?:-|–|—|/|,)\\s*(?:${UFS})\\b`, 'gu');
    for (const m of texto.matchAll(re)) votar(m[1]);
    // Cidades já usadas no painel também contam, se aparecerem no texto.
    const t = semAcento(texto);
    for (const c of listaCidades(sites)) {
      if (c === SEM_CIDADE) continue;
      const n = t.split(semAcento(c)).length - 1;
      if (n) votar(c, n);
    }
    // "Centro Barra Velha" / "Itajuba Barra Velha": o bairro grudou na frente; conta para "Barra Velha".
    for (const a of Object.keys(votos)) {
      const b = Object.keys(votos).find((x) => x !== a && a.endsWith(` ${x}`));
      if (b) { votos[b] += votos[a]; delete votos[a]; }
    }
    let melhor = Object.entries(votos).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    // Usa a grafia que já existe no painel (com acento certinho).
    const igual = listaCidades(sites).find((c) => semAcento(c) === semAcento(melhor));
    if (igual) melhor = igual;
    return melhor;
  } catch { return ''; }
}

// Sites sem cidade: tenta descobrir sozinho (uma vez por abertura do painel).
const jaTentado = new Set();
async function completarCidades() {
  for (const site of sites.filter((x) => !(x.cidade || '').trim() && x.url && situacaoDe(x) !== 'meu' && !jaTentado.has(x.id))) {
    jaTentado.add(site.id);
    const cidade = await descobrirCidade(site.url);
    if (!cidade) continue;
    try {
      await dados.alterar(`Descobre a cidade de ${site.id}`, (d) => {
        const x = d.sites.find((y) => y.id === site.id);
        if (x && !(x.cidade || '').trim()) x.cidade = cidade;
      });
      site.cidade = cidade;
      desenhar();
      toast(`📍 ${site.cliente}: cidade ${cidade}.`);
    } catch { /* tenta de novo na próxima vez */ }
  }
}

// ---------- Pendentes x Clientes ----------
// "pendente" = cliente ainda não confirmou; "cliente" = site já comprado.
const CHAVE_CATEGORIA = 'central-de-sites:categoria';
let categoria = (() => { try { return localStorage.getItem(CHAVE_CATEGORIA) || ''; } catch { return ''; } })();
// "meu" = o seu próprio site: fica numa seção só dele, fora de Pendentes e Clientes.
const situacaoDe = (s) => (s.situacao === 'cliente' || s.situacao === 'meu' ? s.situacao : 'pendente');
const NOME_SITUACAO = { pendente: 'Pendentes', cliente: 'Clientes', meu: 'Meu site' };
const contar = (c) => sites.filter((s) => situacaoDe(s) === c).length;
const sitesDaCategoria = () => sites.filter((s) => situacaoDe(s) === categoria);

function desenharCategorias() {
  if (categoria !== 'cliente' && categoria !== 'pendente') categoria = contar('cliente') ? 'cliente' : 'pendente';
  document.querySelectorAll('#categorias .categoria').forEach((b) => {
    const ativa = b.dataset.categoria === categoria;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-selected', String(ativa));
    b.querySelector('.categoria-n').textContent = contar(b.dataset.categoria);
  });
}

$('#categorias').addEventListener('click', (ev) => {
  const b = ev.target.closest('.categoria');
  if (!b || b.dataset.categoria === categoria) return;
  categoria = b.dataset.categoria;
  try { localStorage.setItem(CHAVE_CATEGORIA, categoria); } catch { /* ok */ }
  desenhar();
});

// ---------- Cidades (seções) ----------
const SEM_CIDADE = 'Sem cidade';
const CHAVE_CIDADE = 'central-de-sites:cidade';
let cidadeAtiva = (() => { try { return localStorage.getItem(CHAVE_CIDADE) || ''; } catch { return ''; } })();
const cidadeDe = (s) => (s.cidade || '').trim() || SEM_CIDADE;
const ordenarCidades = (a, b) => (a === SEM_CIDADE) - (b === SEM_CIDADE) || a.localeCompare(b, 'pt-BR');
const listaCidades = (lista = sitesDaCategoria()) => [...new Set(lista.map(cidadeDe))].sort(ordenarCidades);

function desenharChips() {
  const cidades = listaCidades();
  if (cidadeAtiva && !cidades.includes(cidadeAtiva)) cidadeAtiva = '';
  // Só vale a pena mostrar os filtros quando há mais de uma cidade.
  $('#cidades').hidden = cidades.length < 2;
  const chip = (valor, rotulo, n) => `<button class="chip ${cidadeAtiva === valor ? 'ativo' : ''}" data-cidade="${esc(valor)}">${esc(rotulo)} <span>${n}</span></button>`;
  const lista = sitesDaCategoria();
  $('#cidades').innerHTML = chip('', 'Todas', lista.length)
    + cidades.map((c) => chip(c, c, lista.filter((s) => cidadeDe(s) === c).length)).join('');
}

$('#cidades').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chip');
  if (!b) return;
  cidadeAtiva = b.dataset.cidade;
  try { localStorage.setItem(CHAVE_CIDADE, cidadeAtiva); } catch { /* ok */ }
  desenharChips();
  filtrar();
});

// Busca e filtro de cidade só escondem/mostram cards, sem recarregar as miniaturas.
function filtrar() {
  const termo = $('#busca').value.trim().toLowerCase();
  let algum = false;
  document.querySelectorAll('#lista .grupo').forEach((grupo) => {
    const daCidade = !cidadeAtiva || grupo.dataset.cidade === cidadeAtiva || grupo.classList.contains('grupo-meu');
    let visiveis = 0;
    grupo.querySelectorAll('.site').forEach((el) => {
      const s = sites.find((x) => x.id === el.dataset.id);
      const ok = daCidade && (!termo || `${s.cliente} ${s.id} ${s.url} ${s.notas} ${s.cidade || ''}`.toLowerCase().includes(termo));
      el.hidden = !ok;
      if (ok) visiveis++;
    });
    grupo.hidden = !visiveis;
    algum ||= visiveis > 0;
  });
  const aviso = $('#sem-resultado');
  if (aviso) { aviso.hidden = algum; aviso.textContent = termo ? `Nada encontrado para “${termo}”.` : 'Nenhum site nesta cidade.'; }
}

function cartao(s) {
  const podeAlternar = s.estado === 'ligado' || s.estado === 'desligado';
  return `
    <article class="site ${s.estado}" data-id="${esc(s.id)}">
      <div class="site-topo">
        ${previa(s)}
        <div class="site-nome">
          <h3>${esc(s.cliente)}</h3>
          <div class="repo">${esc(s.id)}</div>
          <span class="pilula ${s.estado}">${ROTULO[s.estado] || s.estado}</span>
        </div>
        <label class="chave" title="${s.estado === 'ligado' ? 'Desligar site' : 'Ligar site'}">
          <input type="checkbox" data-acao="alternar" ${s.estado === 'ligado' ? 'checked' : ''} ${podeAlternar ? '' : 'disabled'}>
          <span></span>
        </label>
      </div>
      ${s.url ? `<a class="site-url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))} ↗</a>` : ''}
      <div class="site-info">
        <span data-resposta="${esc(s.id)}">${textoResposta(verificacoes[s.id])}</span>
        ${s.tipoPublicacao ? `<span>Publicação: ${esc(s.tipoPublicacao)}</span>` : ''}
      </div>
      ${s.erro ? `<div class="site-notas" style="color:var(--off)">${esc(s.erro)}</div>` : ''}
      ${s.notas ? `<div class="site-notas">${esc(s.notas)}</div>` : ''}
      <div class="site-rodape">
        ${{ pendente: '<button class="btn pequeno confirmar" data-acao="confirmar">✓ Virou cliente</button>',
    cliente: '<button class="btn pequeno" data-acao="desconfirmar">↩ Voltar p/ pendentes</button>' }[situacaoDe(s)] || ''}
        <button class="btn pequeno" data-acao="editar">Editar</button>
        <button class="btn pequeno" data-acao="testar">Testar</button>
        <a class="btn pequeno" href="https://github.com/${esc(s.id)}/settings/pages" target="_blank" rel="noopener">GitHub ↗</a>
        <button class="btn pequeno" data-acao="remover" style="margin-left:auto">Remover</button>
      </div>
    </article>`;
}

function desenhar() {
  desenharCategorias();
  const lista = sitesDaCategoria();
  $('#n-total').textContent = lista.length;
  $('#n-ligados').textContent = lista.filter((s) => s.estado === 'ligado').length;
  $('#n-desligados').textContent = lista.filter((s) => s.estado === 'desligado').length;
  desenharChips();

  if (!sites.length) {
    $('#lista').innerHTML = '<div class="vazio">Nenhum site no painel ainda.<br><br>Toque em <strong>+ Adicionar site</strong>.</div>';
    return;
  }
  // Seu próprio site aparece sempre no topo, numa seção só dele.
  const meus = sites.filter((s) => situacaoDe(s) === 'meu');
  const secaoMeu = meus.length ? `
    <section class="grupo grupo-meu" data-cidade="">
      <h2 class="grupo-titulo">⭐ Meu site</h2>
      <div class="grupo-sites">${meus.map(cartao).join('')}</div>
    </section>` : '';

  if (!lista.length) {
    $('#lista').innerHTML = secaoMeu + (categoria === 'cliente'
      ? '<div class="vazio">Nenhum cliente confirmado ainda.<br><br>Em <strong>Pendentes</strong>, toque em <strong>✓ Virou cliente</strong> quando o cliente comprar o site.</div>'
      : '<div class="vazio">Nenhum site pendente. 🎉<br><br>Sites novos que você adicionar aparecem aqui até o cliente confirmar.</div>');
    return;
  }

  $('#lista').innerHTML = secaoMeu + '<div class="vazio" id="sem-resultado" hidden></div>' + listaCidades().map((cidade) => {
    const daqui = lista.filter((s) => cidadeDe(s) === cidade).sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
    const fora = daqui.filter((s) => s.estado === 'desligado').length;
    return `
    <section class="grupo" data-cidade="${esc(cidade)}">
      <h2 class="grupo-titulo">${esc(cidade)}
        <small>${daqui.length} site${daqui.length > 1 ? 's' : ''}${fora ? ` · <span class="txt-off">${fora} desligado${fora > 1 ? 's' : ''}</span>` : ''}</small>
      </h2>
      <div class="grupo-sites">${daqui.map(cartao).join('')}</div>
    </section>`;
  }).join('');
  filtrar();
}

async function mudarSituacao(site, situacao) {
  await dados.alterar(`${situacao === 'cliente' ? 'Confirma' : 'Pendente'} ${site.id}`, (d) => {
    const s = d.sites.find((x) => x.id === site.id);
    if (s) s.situacao = situacao;
    Dados.registrar(d, site.id, situacao === 'cliente' ? 'confirmado' : 'pendente', true, situacao === 'cliente' ? 'Virou cliente' : 'Voltou para pendentes');
  });
  site.situacao = situacao;
  desenhar();
}

const acharSite = (el) => sites.find((s) => s.id === el.closest('.site').dataset.id);
const salvo = (id) => dados.dados.sites.find((s) => s.id === id);

$('#lista').addEventListener('click', async (ev) => {
  const alvo = ev.target.closest('[data-acao]');
  if (!alvo || alvo.dataset.acao === 'alternar') return;
  const site = acharSite(alvo);
  const acao = alvo.dataset.acao;

  if (acao === 'testar') {
    verificacoes[site.id] = null;
    document.querySelector(`[data-resposta="${CSS.escape(site.id)}"]`).textContent = 'Testando…';
    verificar(site);
  }

  if (acao === 'confirmar') {
    alvo.disabled = true;
    try {
      await mudarSituacao(site, 'cliente');
      toast(`⭐ ${site.cliente} agora está em Clientes.`);
    } catch (e) { toast(e.message, true); alvo.disabled = false; }
  }

  if (acao === 'desconfirmar') {
    alvo.disabled = true;
    try {
      await mudarSituacao(site, 'pendente');
      toast(`↩ ${site.cliente} voltou para Pendentes.`);
    } catch (e) { toast(e.message, true); alvo.disabled = false; }
  }

  if (acao === 'editar') {
    const f = await modal({
      titulo: 'Editar site',
      ok: 'Salvar',
      corpo: `
        <label>Nome do cliente / site<input name="cliente" value="${esc(site.cliente)}" required></label>
        <label>Cidade<input name="cidade" value="${esc(site.cidade || '')}" list="lista-cidades" placeholder="ex.: Barra Velha" autocomplete="off"></label>
        <label>Situação<select name="situacao">
          <option value="pendente" ${situacaoDe(site) === 'pendente' ? 'selected' : ''}>Pendente (cliente ainda não confirmou)</option>
          <option value="cliente" ${situacaoDe(site) === 'cliente' ? 'selected' : ''}>Cliente (site já comprado)</option>
          <option value="meu" ${situacaoDe(site) === 'meu' ? 'selected' : ''}>Meu site (fica separado, no topo)</option>
        </select></label>
        <datalist id="lista-cidades">${listaCidades(sites).filter((c) => c !== SEM_CIDADE).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <label>Anotações (ex.: vencimento, contato, valor)<textarea name="notas" rows="4">${esc(site.notas)}</textarea></label>`,
    });
    if (!f) return;
    const cliente = f.get('cliente').trim() || site.cliente;
    const notas = f.get('notas');
    // Reaproveita a grafia de uma cidade já existente (ex.: "barra velha" → "Barra Velha").
    const digitada = f.get('cidade').trim().replace(/\s+/g, ' ');
    const cidade = listaCidades(sites).find((c) => c.localeCompare(digitada, 'pt-BR', { sensitivity: 'base' }) === 0 && c !== SEM_CIDADE) || digitada;
    const situacao = ['cliente', 'meu'].includes(f.get('situacao')) ? f.get('situacao') : 'pendente';
    const mudou = situacao !== situacaoDe(site);
    const acaoHist = { cliente: 'confirmado', pendente: 'pendente', meu: 'meu' }[situacao];
    const textoHist = { cliente: 'Virou cliente', pendente: 'Voltou para pendentes', meu: 'Marcado como meu site' }[situacao];
    try {
      await dados.alterar(`Edita ${site.id}`, (d) => {
        const s = d.sites.find((x) => x.id === site.id);
        if (s) Object.assign(s, { cliente, notas, cidade, situacao });
        if (mudou) Dados.registrar(d, site.id, acaoHist, true, textoHist);
      });
      Object.assign(site, { cliente, notas, cidade, situacao });
      desenhar();
      if (mudou) toast(`${site.cliente} foi para ${NOME_SITUACAO[situacao]}.`);
    } catch (e) { toast(e.message, true); }
  }

  if (acao === 'remover') {
    const ok = await modal({
      titulo: `Remover ${site.cliente} do painel?`,
      corpo: '<p>O site só sai desta lista. Nada é alterado no site e ele continua no estado em que está.</p>',
      ok: 'Remover', perigo: true,
    });
    if (!ok) return;
    try {
      await dados.alterar(`Remove ${site.id}`, (d) => {
        const velho = d.sites.find((x) => x.id === site.id);
        // guarda nome, cidade e notas para o caso de o site ser adicionado de novo
        if (velho) d.removidos = { ...(d.removidos || {}), [site.id]: { cliente: velho.cliente, notas: velho.notas, cidade: velho.cidade } };
        d.sites = d.sites.filter((x) => x.id !== site.id);
        Dados.registrar(d, site.id, 'removido', true, 'Removido do painel (o site não foi alterado)');
      });
      sites = sites.filter((s) => s !== site);
      desenhar();
    } catch (e) { toast(e.message, true); }
  }
});

$('#lista').addEventListener('change', async (ev) => {
  const chk = ev.target.closest('[data-acao="alternar"]');
  if (!chk) return;
  const site = acharSite(chk);
  const desligar = !chk.checked;
  chk.checked = !chk.checked; // só muda de verdade se confirmar

  const ok = await modal({
    titulo: desligar ? `Desligar ${site.cliente}?` : `Ligar ${site.cliente}?`,
    corpo: desligar
      ? `<p>Os visitantes de <strong>${esc(site.url || site.id)}</strong> vão ver a página de manutenção.</p><p style="color:var(--suave);font-size:14px">O código do site não é apagado. Você pode religar quando quiser.</p>`
      : `<p>O site <strong>${esc(site.url || site.id)}</strong> volta a funcionar normalmente.</p>`,
    ok: desligar ? 'Desligar site' : 'Ligar site',
    perigo: desligar,
  });
  if (!ok) return;

  chk.disabled = true;
  try {
    let mensagem, avisos = [];
    if (desligar) {
      const html = await fetch('manutencao.html', { cache: 'no-store' }).then((r) => r.text());
      const r = await gh.desligar(site.owner, site.repo, html);
      mensagem = r.jaEstava ? 'Já estava desligado' : 'Página de manutenção publicada';
      await dados.alterar(`Desliga ${site.id}`, (d) => {
        const s = d.sites.find((x) => x.id === site.id);
        if (s && r.original) s.original = r.original;
        Dados.registrar(d, site.id, 'desligar', true, mensagem);
      });
    } else {
      const r = await gh.ligar(site.owner, site.repo, salvo(site.id)?.original);
      avisos = r.avisos;
      mensagem = r.jaEstava ? 'Já estava ligado' : 'Site restaurado';
      await dados.alterar(`Liga ${site.id}`, (d) => {
        const s = d.sites.find((x) => x.id === site.id);
        if (s && !r.jaEstava) s.original = null;
        Dados.registrar(d, site.id, 'ligar', true, [mensagem, ...avisos].join(' '));
      });
    }
    toast(mensagem + '. O GitHub pode levar de 1 a 10 minutos para atualizar.');
    avisos.forEach((a) => toast(a, true));
    site.estado = desligar ? 'desligado' : 'ligado';
    desenhar();
  } catch (e) {
    toast(e.message, true);
    dados.alterar(`Falha ${site.id}`, (d) => Dados.registrar(d, site.id, desligar ? 'desligar' : 'ligar', false, e.message)).catch(() => {});
    chk.disabled = false;
  }
});

// ---------- Adicionar site ----------
$('#btn-adicionar').addEventListener('click', async () => {
  let descobertos = [];
  const f = await modal({
    titulo: 'Adicionar sites',
    ok: 'Adicionar selecionados',
    corpo: `
      <p style="margin:0;color:var(--suave);font-size:14px">Repositórios da sua conta com site publicado:</p>
      <input type="search" id="filtro-desc" placeholder="Filtrar…">
      <div class="descobertos" id="descobertos"><div style="padding:14px;color:var(--suave)">Procurando no GitHub…</div></div>
      <details>
        <summary style="cursor:pointer;color:var(--suave);font-size:14px">Não achou? Adicionar manualmente</summary>
        <label style="margin-top:10px">Repositório (dono/nome)<input name="manual" placeholder="ex.: minhaempresa/site-cliente" autocapitalize="off"></label>
      </details>`,
    aoAbrir: () => {
      const jaTem = new Set(dados.dados.sites.map((s) => s.id));
      gh.reposComPages().then((lista) => {
        descobertos = lista.filter((r) => !jaTem.has(`${r.owner}/${r.repo}`));
        $('#descobertos').innerHTML = descobertos.length
          ? descobertos.map((r, i) => `<label class="descoberto" data-nome="${esc(`${r.owner}/${r.repo}`.toLowerCase())}"><input type="checkbox" name="sel" value="${i}"> <span>${esc(r.owner)}/<strong>${esc(r.repo)}</strong>${r.privado ? ' 🔒' : ''}</span><small>${new Date(r.atualizado).toLocaleDateString('pt-BR')}</small></label>`).join('')
          : '<div style="padding:14px;color:var(--suave)">Nenhum site novo encontrado. Todos já estão no painel.</div>';
      }).catch((e) => { $('#descobertos').innerHTML = `<div style="padding:14px;color:var(--off)">${esc(e.message)}</div>`; });
      $('#filtro-desc').oninput = (e) => {
        const t = e.target.value.toLowerCase();
        document.querySelectorAll('.descoberto').forEach((el) => { el.hidden = !el.dataset.nome.includes(t); });
      };
    },
  });
  if (!f) return;

  const alvos = f.getAll('sel').map((i) => descobertos[i]);
  const manual = (f.get('manual') || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  if (manual) {
    const [owner, repo] = manual.split('/');
    if (owner && repo) alvos.push({ owner, repo });
    else toast('Formato manual inválido. Use dono/nome.', true);
  }
  const novos = [];
  for (const r of alvos) {
    try {
      const pages = await gh.pages(r.owner, r.repo);
      if (!pages) { toast(`${r.owner}/${r.repo}: não tem GitHub Pages ativo.`, true); continue; }
      novos.push({ id: `${r.owner}/${r.repo}`, owner: r.owner, repo: r.repo, cliente: r.repo, notas: '', situacao: 'pendente', url: pages.html_url, original: null, adicionadoEm: new Date().toISOString() });
    } catch (e) { toast(`${r.owner}/${r.repo}: ${e.message}`, true); }
  }
  if (!novos.length) return;
  toast('Procurando a cidade no site…');
  await Promise.all(novos.map(async (n) => { n.cidade = await descobrirCidade(n.url); }));
  try {
    await dados.alterar(`Adiciona ${novos.length} site(s)`, (d) => {
      for (const n of novos) {
        if (d.sites.some((s) => s.id === n.id)) continue;
        const antigo = d.removidos && d.removidos[n.id];
        if (antigo) {
          if (antigo.cliente) n.cliente = antigo.cliente;
          if (antigo.notas) n.notas = antigo.notas;
          if (antigo.cidade && !n.cidade) n.cidade = antigo.cidade;
          delete d.removidos[n.id];
        }
        d.sites.push(n);
        Dados.registrar(d, n.id, 'adicionado', true, 'Site adicionado ao painel');
      }
    });
    const cidades = novos.map((n) => n.cidade).filter(Boolean);
    toast(`${novos.length} site(s) adicionado(s) em Pendentes.${cidades.length ? ` 📍 ${[...new Set(cidades)].join(', ')}` : ' Cidade não encontrada: toque em Editar para escolher.'}`);
    await carregarSites();
    toast('🖼 Tirando o print… aparece sozinho em 1 minuto, mais ou menos.');
    tirarPrints(novos).then((ok) => ok && toast('🖼 Print pronto!')).catch(() => {});
  } catch (e) { toast(e.message, true); }
});

// ---------- Histórico ----------
const NOME_ACAO = { ligar: '🟢 Ligar', desligar: '🔴 Desligar', adicionado: '➕ Adicionado', removido: '➖ Removido', confirmado: '⭐ Virou cliente', pendente: '↩ Voltou p/ pendentes', meu: '⭐ Meu site' };
async function carregarHistorico() {
  try { await dados.carregar(); } catch (e) { toast(e.message, true); }
  const h = dados.dados.historico.slice(0, 200);
  $('#historico').innerHTML = h.length
    ? h.map((x) => `<tr><td>${new Date(x.quando).toLocaleString('pt-BR')}</td><td>${esc(x.site)}</td><td>${NOME_ACAO[x.acao] || esc(x.acao)}</td><td class="${x.ok ? '' : 'falha'}">${x.ok ? '' : '✖ '}${esc(x.mensagem)}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--suave);padding:30px">Nenhuma ação registrada ainda.</td></tr>';
}

// ---------- Abas e início ----------
document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.aba').forEach((x) => x.classList.toggle('ativa', x === b));
  $('#aba-sites').hidden = b.dataset.aba !== 'sites';
  $('#aba-historico').hidden = b.dataset.aba !== 'historico';
  if (b.dataset.aba === 'historico') carregarHistorico();
}));
$('#busca').addEventListener('input', filtrar);
$('#btn-atualizar').addEventListener('click', carregarSites);
$('#btn-prints').addEventListener('click', async () => {
  const btn = $('#btn-prints');
  btn.disabled = true;
  try {
    const espera = tirarPrints();
    toast('Tirando novos prints dos sites. As miniaturas trocam sozinhas em 1 ou 2 minutos.');
    if (await espera) toast('🖼 Prints atualizados!');
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
});

const tokenSalvo = lerToken();
if (tokenSalvo) entrar(tokenSalvo);
else mostrarEntrada();
