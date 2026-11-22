// Interface do painel Central de Sites (roda 100% no navegador).
import { GitHub, Dados, verificarUrl, REPO_PAINEL } from './github.js';

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
const versaoPrevia = Math.floor(Date.now() / 600000); // renova o cache a cada 10 min
function previa(s) {
  const inicial = esc((s.cliente || s.repo).trim().charAt(0).toUpperCase());
  const img = `https://raw.githubusercontent.com/${encodeURIComponent(dados.owner)}/${REPO_PAINEL}/previas/${encodeURIComponent(`${s.owner}__${s.repo}`)}.jpg?v=${versaoPrevia}`;
  const conteudo = `<span class="previa-inicial" aria-hidden="true">${inicial}</span><img src="${img}" alt="" loading="lazy" decoding="async">`;
  return s.url
    ? `<a class="previa" href="${esc(s.url)}" target="_blank" rel="noopener" title="Abrir ${esc(s.cliente)}" aria-label="Abrir ${esc(s.cliente)}">${conteudo}</a>`
    : `<div class="previa">${conteudo}</div>`;
}
// Sem print ainda (site novo ou repositório privado): fica a letra inicial.
$('#lista').addEventListener('error', (ev) => {
  if (ev.target.matches?.('.previa img')) ev.target.remove();
}, true);

// ---------- Cidades (seções) ----------
const SEM_CIDADE = 'Sem cidade';
const CHAVE_CIDADE = 'central-de-sites:cidade';
let cidadeAtiva = (() => { try { return localStorage.getItem(CHAVE_CIDADE) || ''; } catch { return ''; } })();
const cidadeDe = (s) => (s.cidade || '').trim() || SEM_CIDADE;
const ordenarCidades = (a, b) => (a === SEM_CIDADE) - (b === SEM_CIDADE) || a.localeCompare(b, 'pt-BR');
const listaCidades = () => [...new Set(sites.map(cidadeDe))].sort(ordenarCidades);

function desenharChips() {
  const cidades = listaCidades();
  if (cidadeAtiva && !cidades.includes(cidadeAtiva)) cidadeAtiva = '';
  // Só vale a pena mostrar os filtros quando há mais de uma cidade.
  $('#cidades').hidden = cidades.length < 2;
  const chip = (valor, rotulo, n) => `<button class="chip ${cidadeAtiva === valor ? 'ativo' : ''}" data-cidade="${esc(valor)}">${esc(rotulo)} <span>${n}</span></button>`;
  $('#cidades').innerHTML = chip('', 'Todas', sites.length)
    + cidades.map((c) => chip(c, c, sites.filter((s) => cidadeDe(s) === c).length)).join('');
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
    const daCidade = !cidadeAtiva || grupo.dataset.cidade === cidadeAtiva;
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
        <button class="btn pequeno" data-acao="editar">Editar</button>
        <button class="btn pequeno" data-acao="testar">Testar</button>
        <a class="btn pequeno" href="https://github.com/${esc(s.id)}/settings/pages" target="_blank" rel="noopener">GitHub ↗</a>
        <button class="btn pequeno" data-acao="remover" style="margin-left:auto">Remover</button>
      </div>
    </article>`;
}

function desenhar() {
  $('#n-total').textContent = sites.length;
  $('#n-ligados').textContent = sites.filter((s) => s.estado === 'ligado').length;
  $('#n-desligados').textContent = sites.filter((s) => s.estado === 'desligado').length;
  desenharChips();

  if (!sites.length) {
    $('#lista').innerHTML = '<div class="vazio">Nenhum site no painel ainda.<br><br>Toque em <strong>+ Adicionar site</strong>.</div>';
    return;
  }

  $('#lista').innerHTML = '<div class="vazio" id="sem-resultado" hidden></div>' + listaCidades().map((cidade) => {
    const daqui = sites.filter((s) => cidadeDe(s) === cidade).sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
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

  if (acao === 'editar') {
    const f = await modal({
      titulo: 'Editar site',
      ok: 'Salvar',
      corpo: `
        <label>Nome do cliente / site<input name="cliente" value="${esc(site.cliente)}" required></label>
        <label>Cidade<input name="cidade" value="${esc(site.cidade || '')}" list="lista-cidades" placeholder="ex.: Barra Velha" autocomplete="off"></label>
        <datalist id="lista-cidades">${listaCidades().filter((c) => c !== SEM_CIDADE).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <label>Anotações (ex.: vencimento, contato, valor)<textarea name="notas" rows="4">${esc(site.notas)}</textarea></label>`,
    });
    if (!f) return;
    const cliente = f.get('cliente').trim() || site.cliente;
    const notas = f.get('notas');
    // Reaproveita a grafia de uma cidade já existente (ex.: "barra velha" → "Barra Velha").
    const digitada = f.get('cidade').trim().replace(/\s+/g, ' ');
    const cidade = listaCidades().find((c) => c.localeCompare(digitada, 'pt-BR', { sensitivity: 'base' }) === 0 && c !== SEM_CIDADE) || digitada;
    try {
      await dados.alterar(`Edita ${site.id}`, (d) => {
        const s = d.sites.find((x) => x.id === site.id);
        if (s) Object.assign(s, { cliente, notas, cidade });
      });
      Object.assign(site, { cliente, notas, cidade });
      desenhar();
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
      novos.push({ id: `${r.owner}/${r.repo}`, owner: r.owner, repo: r.repo, cliente: r.repo, notas: '', url: pages.html_url, original: null, adicionadoEm: new Date().toISOString() });
    } catch (e) { toast(`${r.owner}/${r.repo}: ${e.message}`, true); }
  }
  if (!novos.length) return;
  try {
    await dados.alterar(`Adiciona ${novos.length} site(s)`, (d) => {
      for (const n of novos) {
        if (d.sites.some((s) => s.id === n.id)) continue;
        d.sites.push(n);
        Dados.registrar(d, n.id, 'adicionado', true, 'Site adicionado ao painel');
      }
    });
    toast(`${novos.length} site(s) adicionado(s).`);
    carregarSites();
  } catch (e) { toast(e.message, true); }
});

// ---------- Histórico ----------
const NOME_ACAO = { ligar: '🟢 Ligar', desligar: '🔴 Desligar', adicionado: '➕ Adicionado', removido: '➖ Removido' };
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
    await gh.gerarPrevias(dados.owner);
    toast('Tirando novos prints dos sites. Leva uns 2 minutos; depois toque em ↻ Atualizar.');
  } catch (e) { toast(e.message, true); }
  finally { setTimeout(() => { btn.disabled = false; }, 60000); }
});

const tokenSalvo = lerToken();
if (tokenSalvo) entrar(tokenSalvo);
else mostrarEntrada();
