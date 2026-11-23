# Build e conferência da candidata 0.2.1

A compilação de referência usou Windows x64, Node.js 24.18.0 e npm 11.16.0. Conserve os bytes do checkout, inclusive os finais de linha. O gerador do Service Worker inclui seu próprio conteúdo no identificador do cache. O lockfile fixa as versões e os digests dos pacotes npm.

Na raiz desta árvore, execute em um checkout limpo:

```sh
npm ci --no-fund --no-audit
node scripts/verificar-integridade.mjs
npm test
npm run build
node scripts/conferir-distribuicao.mjs
node tests/public-references.mjs
```

O comando de build chama TypeScript, Vite 6.4.6 e o gerador do shell offline. O verificador compara o conjunto completo de caminhos, o tipo de entrada e todos os SHA-256 com o manifesto de referência desta candidata. Um build divergente exige diagnóstico. Para conferir outra cópia, passe seu diretório como único argumento ao verificador. As referências do HTML, CSS, JS, manifesto e Service Worker também são testadas contra o build, com recompilação Vite em memória. A pasta `proof/` recebe a evidência local.

A candidata contém 17 arquivos. O Vite produz um único bundle de JavaScript para a aplicação. As fontes, a marca, as licenças e os demais recursos servidos pertencem à mesma origem. O perfil de produção inclui `_headers` e uma página de erro 404. A hospedagem deve aceitar a raiz da origem como URL canônica. O Worker instalado usa onze recursos estáticos com integridade conferida. O índice HTML, os workers e o manifesto exigem revalidação. Os arquivos de nome versionado em `assets/` admitem cache público imutável.

Para um ensaio local de navegação, execute `npm run preview`. Para verificar o comportamento do Pages, use o emulador Wrangler 4.166.0 como ferramenta externa, somente em loopback. No terminal da raiz, sirva `dist/` com `wrangler pages dev dist --ip 127.0.0.1 --port 19473`. Em outro terminal da mesma pasta, execute `node tests/pages-release.mjs dist 19473 http-local.json`. A suíte lê apenas a origem local e grava o relatório no caminho fornecido.

No Windows, com Microsoft Edge instalado, defina a variável de ambiente `CAMPULSO_BROWSER=msedge`. Execute `npm run test:functional`, `npm run test:offline` e `node tests/install-public.mjs` sequencialmente. O ensaio de atualização altera temporariamente o worker de `dist/` e restaura seu conteúdo ao sair. Execute-o em cópia descartável e confira novamente o manifesto. Para testar troca de versões e rollback, indique em `CAMPULSO_PREVIOUS_DIST` um diretório de build com a mesma origem e esquema de dados compatível e execute `node tests/migrate-public.mjs`. Para a suíte de acessibilidade, defina `CAMPULSO_AXE_PATH` com o caminho do `axe.min.js` disponível separadamente e execute `node tests/accessibility-browser.mjs`.

O diretório de envio é exclusivamente `dist/`. Conserve as ferramentas npm, os testes, o SBOM e os relatórios de verificação junto da documentação da versão. A instalação da PWA requer contexto seguro, permissões e suporte do navegador.

[Manifesto do build](docs/SHA256SUMS_DISTRIBUICAO.txt) · [SBOM CycloneDX 1.6](docs/SBOM.cdx.json) · [Direitos e avisos](docs/LICENCAS_DISTRIBUICAO.md).

Para conferir a política incorporada, defina `CAMPULSO_AXE_PATH` com o caminho de `axe.min.js` (4.11.1) e execute `node tests/privacy-browser.mjs`. A prova compara o texto com `PRIVACY.md`, confere os destinos dos links, verifica foco, árvore acessível e larguras de 320, 390 e 1440 px. Ao final ela desliga o servidor local e recarrega a política com o navegador offline.

Nesta candidata, a versão da política é 1.1. Para comparar builds, conserve a primeira pasta `dist/` em um diretório separado. Compile novamente e execute `node scripts/conferir-distribuicao.mjs` para cada diretório. O manifesto pós-build fixa também o conteúdo do Service Worker e a entrada que carrega o JavaScript. Compare a política exibida na recarga offline antes de aceitar uma atualização.

## Distribuição com páginas públicas e SEO

Para gerar a edição de descoberta, comece com os 17 arquivos do build acima. O script verifica essa base, inclui as páginas Sobre e Privacidade, os metadados da PWA, a folha de estilo, o sitemap e as regras dos indexadores. Depois regenera os workers. O diretório de saída deve ser novo. Na raiz da árvore, execute:

```sh
node scripts/preparar-seo.mjs . dist dist-descoberta
```

O código aponta para a origem oficial do CAMPULSO. A opção de verificação do Google é específica da propriedade do responsável. Para reproduzir a edição oficial com a metatag pública de verificação, em PowerShell 7 use os comandos abaixo **antes** de gerar a saída. Leia a página correspondente à revisão que deseja reproduzir. Sem o valor da metatag, o script gera a edição sem verificação do Google e o HTML e os dois workers têm hashes próprios.

```powershell
$htmlOficial = (Invoke-WebRequest 'https://campulso.pages.dev/').Content
$meta = [regex]::Match($htmlOficial, '<meta name="google-site-verification" content="([\w-]+)">')
if (!$meta.Success) { throw 'Metatag ausente nessa versão da origem.' }
$env:CAMPULSO_GOOGLE_VERIFICATION = $meta.Groups[1].Value
try {
    node scripts/preparar-seo.mjs . dist dist-descoberta
    if ($LASTEXITCODE -ne 0) { throw 'Falha na preparação da edição.' }
    node scripts/conferir-distribuicao.mjs dist-descoberta descoberta
    if ($LASTEXITCODE -ne 0) { throw 'A distribuição diverge da referência.' }
} finally {
    Remove-Item Env:CAMPULSO_GOOGLE_VERIFICATION -ErrorAction SilentlyContinue
}
```

O verificador compara todos os caminhos e bytes dos 22 arquivos com o [manifesto da edição de descoberta](docs/SHA256SUMS_DESCOBERTA.txt). O [SBOM dessa edição](docs/SBOM_DESCOBERTA.cdx.json) identifica seus arquivos e componentes. Os testes de referência de Vite e do bundle são específicos de `dist/` e continuam usando o manifesto da base.
