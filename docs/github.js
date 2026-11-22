// Comunicação com a API do GitHub, direto do navegador.
//
// Como funciona o "desligar":
//   1. Guarda a configuração atual do Pages (branch/pasta ou GitHub Actions, domínio).
//   2. Cria (ou atualiza) um branch separado chamado "site-manutencao" contendo
//      apenas a página de manutenção. O código do site NÃO é tocado.
//   3. Aponta o GitHub Pages para esse branch.
// "Ligar" faz o caminho inverso: volta a configuração original e apaga o branch.
//
// A configuração original fica salva no repositório de dados e também na
// mensagem do commit de manutenção (segurança extra).

const API = 'https://api.github.com';
export const BRANCH_MANUTENCAO = 'site-manutencao';
export const REPO_PAINEL = 'central-de-sites';
export const REPO_DADOS = 'central-de-sites-dados';
const ARQUIVO_DADOS = 'dados.json';
const MARCA_CONFIG = 'CONFIG-ORIGINAL:';

export class GitHub {
  constructor(token) {
    this.token = token;
  }

  async req(method, path, body) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) {
      const err = new Error(traduzirErro(res.status, data?.message));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  usuario() {
    return this.req('GET', '/user');
  }

  // Lista os repositórios acessíveis pelo token que têm GitHub Pages ativo.
  async reposComPages() {
    const todos = [];
    for (let page = 1; page <= 20; page++) {
      const lote = await this.req('GET', `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`);
      todos.push(...lote);
      if (lote.length < 100) break;
    }
    return todos
      .filter((r) => r.has_pages && r.name !== REPO_PAINEL)
      .map((r) => ({ owner: r.owner.login, repo: r.name, privado: r.private, atualizado: r.pushed_at }));
  }

  async pages(owner, repo) {
    try {
      return await this.req('GET', `/repos/${owner}/${repo}/pages`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  static estaEmManutencao(pages) {
    return !!pages && pages.build_type === 'legacy' && pages.source?.branch === BRANCH_MANUTENCAO;
  }

  async desligar(owner, repo, htmlManutencao) {
    if (repo === REPO_PAINEL) throw new Error('Este é o próprio painel. Ele não pode ser desligado por aqui.');
    const pages = await this.pages(owner, repo);
    if (!pages) throw new Error('Este repositório não tem GitHub Pages ativo.');
    if (GitHub.estaEmManutencao(pages)) return { jaEstava: true, original: null };

    const original = {
      build_type: pages.build_type,
      source: pages.source || null,
      cname: pages.cname || null,
      https_enforced: !!pages.https_enforced,
    };

    const arquivos = [
      { path: 'index.html', content: htmlManutencao },
      { path: '404.html', content: htmlManutencao },
      { path: '.nojekyll', content: '\n' },
    ];
    if (original.cname) arquivos.push({ path: 'CNAME', content: original.cname + '\n' });

    const tree = await this.req('POST', `/repos/${owner}/${repo}/git/trees`, {
      tree: arquivos.map((a) => ({ path: a.path, mode: '100644', type: 'blob', content: a.content })),
    });
    const commit = await this.req('POST', `/repos/${owner}/${repo}/git/commits`, {
      message: `Site em manutenção (Central de Sites)\n\n${MARCA_CONFIG}${JSON.stringify(original)}`,
      tree: tree.sha,
      parents: [],
    });
    try {
      await this.req('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${BRANCH_MANUTENCAO}`, { sha: commit.sha, force: true });
    } catch (e) {
      if (e.status !== 404 && e.status !== 422) throw e;
      await this.req('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${BRANCH_MANUTENCAO}`, sha: commit.sha });
    }

    const body = { build_type: 'legacy', source: { branch: BRANCH_MANUTENCAO, path: '/' } };
    if (original.cname) body.cname = original.cname;
    await this.req('PUT', `/repos/${owner}/${repo}/pages`, body);

    return { jaEstava: false, original };
  }

  async ligar(owner, repo, originalSalvo) {
    const pages = await this.pages(owner, repo);
    if (!pages) throw new Error('Este repositório não tem GitHub Pages ativo.');
    if (!GitHub.estaEmManutencao(pages)) return { jaEstava: true, avisos: [] };

    const original = originalSalvo || (await this.lerConfigDoCommit(owner, repo));
    if (!original) {
      throw new Error('Não encontrei a configuração original do site. Reative manualmente em Settings > Pages no GitHub.');
    }

    const avisos = [];
    const body = original.build_type === 'workflow'
      ? { build_type: 'workflow' }
      : { build_type: 'legacy', source: original.source };
    if (original.cname) body.cname = original.cname;
    await this.req('PUT', `/repos/${owner}/${repo}/pages`, body);

    if (original.https_enforced) {
      try { await this.req('PUT', `/repos/${owner}/${repo}/pages`, { https_enforced: true }); }
      catch { avisos.push('Não consegui reativar o "Enforce HTTPS" agora; o GitHub pode estar gerando o certificado. Confira em alguns minutos.'); }
    }

    if (original.build_type === 'workflow') {
      const ok = await this.republicarWorkflow(owner, repo).catch(() => false);
      if (!ok) avisos.push('O site usa GitHub Actions: rode o workflow de deploy manualmente (aba Actions) para ele voltar a publicar.');
    }

    try { await this.req('DELETE', `/repos/${owner}/${repo}/git/refs/heads/${BRANCH_MANUTENCAO}`); } catch { /* não é grave */ }

    return { jaEstava: false, avisos };
  }

  // Pede ao GitHub para tirar novos prints dos sites (workflow previas.yml do painel).
  // repos vazio = print de todos os sites; senão, só desses (bem mais rápido).
  gerarPrevias(owner, repos = []) {
    return this.req('POST', `/repos/${owner}/${REPO_PAINEL}/actions/workflows/previas.yml/dispatches`, { ref: 'main', inputs: { sites: repos.join(',') } });
  }

  async lerConfigDoCommit(owner, repo) {
    try {
      const c = await this.req('GET', `/repos/${owner}/${repo}/commits/${BRANCH_MANUTENCAO}`);
      const msg = c.commit?.message || '';
      const i = msg.indexOf(MARCA_CONFIG);
      if (i === -1) return null;
      return JSON.parse(msg.slice(i + MARCA_CONFIG.length).trim());
    } catch {
      return null;
    }
  }

  // Para sites publicados via GitHub Actions: roda de novo o último deploy que deu certo.
  async republicarWorkflow(owner, repo) {
    const deps = await this.req('GET', `/repos/${owner}/${repo}/deployments?environment=github-pages&per_page=5`);
    for (const dep of deps) {
      const runs = await this.req('GET', `/repos/${owner}/${repo}/actions/runs?head_sha=${dep.sha}&per_page=20`);
      const candidatos = (runs.workflow_runs || []).filter((r) => r.conclusion === 'success');
      const run = candidatos.find((r) => /pages|deploy|site|publish/i.test(`${r.name} ${r.path}`)) || candidatos[0];
      if (run) {
        await this.req('POST', `/repos/${owner}/${repo}/actions/runs/${run.id}/rerun`);
        return true;
      }
    }
    return false;
  }
}

// Dados do painel (sites, anotações, histórico) guardados num repositório PRIVADO
// da sua conta, para aparecerem iguais no celular e no computador.
export class Dados {
  constructor(gh, owner) {
    this.gh = gh;
    this.owner = owner;
    this.sha = null;
    this.dados = { sites: [], historico: [] };
  }

  get caminho() { return `/repos/${this.owner}/${REPO_DADOS}/contents/${ARQUIVO_DADOS}`; }

  async carregar() {
    try {
      const f = await this.gh.req('GET', this.caminho);
      this.sha = f.sha;
      this.dados = JSON.parse(deBase64(f.content));
      this.dados.sites ??= [];
      this.dados.historico ??= [];
    } catch (e) {
      if (e.status !== 404) throw e;
      await this.criarRepo();
    }
    return this.dados;
  }

  async criarRepo() {
    try {
      await this.gh.req('POST', '/user/repos', {
        name: REPO_DADOS,
        private: true,
        description: 'Dados do painel Central de Sites (não apague)',
        auto_init: true,
      });
    } catch (e) {
      if (e.status !== 422) throw e; // 422 = já existe
    }
    this.sha = null;
    this.dados = { sites: [], historico: [] };
    await this.gravar('Cria dados do painel');
  }

  async gravar(mensagem) {
    const body = { message: mensagem, content: paraBase64(JSON.stringify(this.dados, null, 2)) };
    if (this.sha) body.sha = this.sha;
    const r = await this.gh.req('PUT', this.caminho, body);
    this.sha = r.content.sha;
  }

  // Aplica uma alteração e salva. Se outro aparelho salvou antes, recarrega e tenta de novo.
  async alterar(mensagem, alteracao) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      alteracao(this.dados);
      try {
        await this.gravar(mensagem);
        return this.dados;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await this.carregar();
      }
    }
    throw new Error('Não consegui salvar (outro aparelho estava salvando ao mesmo tempo). Tente de novo.');
  }

  static registrar(dados, site, acao, ok, mensagem) {
    dados.historico.unshift({ quando: new Date().toISOString(), site, acao, ok, mensagem });
    dados.historico.length = Math.min(dados.historico.length, 500);
  }
}

// Verifica se o site responde e quanto tempo demora.
export async function verificarUrl(url) {
  const inicio = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const texto = await res.text();
    return {
      ok: res.ok,
      codigo: res.status,
      ms: Date.now() - inicio,
      mostrandoManutencao: texto.includes('central-de-sites:manutencao'),
    };
  } catch (e) {
    return { ok: false, codigo: null, ms: Date.now() - inicio, erro: e.name === 'TimeoutError' ? 'Tempo esgotado' : 'Não respondeu' };
  }
}

function paraBase64(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function deBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function traduzirErro(status, msg = '') {
  if (status === 401) return 'Token do GitHub inválido ou expirado. Confira se copiou o código inteiro, ou crie um token novo.';
  if (status === 403 && /rate limit/i.test(msg)) return 'Limite de requisições do GitHub atingido. Aguarde alguns minutos.';
  if (status === 403 || /Resource not accessible/i.test(msg)) return 'O token não tem permissão para isso. Ele precisa dos escopos "repo" e "workflow".';
  if (status === 404) return 'Repositório não encontrado (ou o token não tem acesso a ele).';
  if (status === 409) return 'Conflito ao salvar.';
  return `GitHub respondeu erro ${status}: ${msg}`;
}
