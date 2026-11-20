# Central de Sites

Painel para **ligar e desligar** os sites (seus e dos clientes) publicados pelo **GitHub Pages**.
Funciona no celular e no computador, de qualquer lugar.

**Endereço:** https://atosmilla.github.io/central-de-sites/

## Primeiro acesso em cada aparelho

1. Abra o endereço acima.
2. Toque em **"Toque aqui para criar o token no GitHub"**. Os campos já vêm preenchidos (escopos `repo` e `workflow`).
3. Escolha a validade, toque em **Generate token** e copie o código `ghp_…`.
4. Volte ao painel, cole o código e toque em **Entrar**.

O token fica guardado **só naquele aparelho** e não vai para o site publicado. Para tirar o acesso de um aparelho, toque em **Sair**. Se perder o celular, apague o token em https://github.com/settings/tokens.

**Dica no iPhone:** no Safari, toque em Compartilhar e depois em **Adicionar à Tela de Início**. O painel fica com ícone, como um app.

## Onde ficam os dados

A lista de sites, as anotações e o histórico ficam no repositório **privado** `central-de-sites-dados`, na sua conta do GitHub. Por isso aparecem iguais em todos os aparelhos. **Não apague esse repositório.**

## O que acontece quando desliga um site

- O painel cria um branch separado chamado `site-manutencao` com a página de manutenção e aponta o GitHub Pages para ele.
- **O código do site não é tocado.** Domínio próprio (CNAME) é mantido.
- Ao religar, o Pages volta para a configuração original e o branch `site-manutencao` é apagado.
- Sites publicados via **GitHub Actions** são republicados automaticamente ao religar.
- O GitHub pode levar **de 1 a 10 minutos** para mostrar a mudança (cache).

## Personalizar a página de manutenção

Edite `docs/manutencao.html` e publique. Mantenha a linha `<!-- central-de-sites:manutencao -->`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `docs/index.html` | Tela do painel |
| `docs/app.js` | Funcionamento da tela |
| `docs/github.js` | Comunicação com o GitHub (ligar/desligar, dados) |
| `docs/manutencao.html` | Página que o visitante vê com o site desligado |
| `abrir-painel.bat` | Abre o painel no navegador do PC |
