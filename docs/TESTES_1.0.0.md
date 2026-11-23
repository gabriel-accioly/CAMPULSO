# Validação técnica do CAMPULSO 1.0.0

Em 23 de novembro de 2026, a revisão baseada na árvore pública 0.2.1 foi compilada em Windows x64 com Node.js 24.18.0, npm 11.16.0 e Vite 6.4.6. Duas compilações reproduziram todos os arquivos, com a metatag pública da propriedade Google preservada. Cada edição tem um manifesto completo e um SBOM CycloneDX 1.6.

| Ensaio | Resultado |
| --- | --- |
| TypeScript e Vitest | Compilação aprovada. Oito arquivos e 89 testes passaram. |
| Referências do pacote | Recompilação Vite em memória idêntica, 47 módulos e referências locais válidas. |
| Uso funcional | Edge 158.0.4370.33 aprovou 14 percursos funcionais. Nenhum erro de página ou pedido a terceiros observado. |
| Dados e rollback | A 0.2.1 abriu espaço sintético com registros nas onze coleções. O Edge aplicou 1.0.0, retornou a 0.2.1 e reaplicou 1.0.0 na mesma origem. Os dados permaneceram integralmente idênticos após cada transição e recarga offline. A página offline teve o SHA-256 esperado de cada geração. |
| Backup | Arquivos realmente exportados foram restaurados em perfis vazios nas duas versões, respeitando o fluxo de prévia, cópia de segurança e confirmação. IDs, vínculos, conteúdo e formato foram preservados. O contador local de revisão pode ser incrementado pela restauração. Transferência por arquivo aprovada em Edge → Firefox → Chrome → Edge. |
| IndexedDB | Banco `campulso-poc002-r02`, Dexie v2 e backup formato 1. O teste de esquema antigo migrou v1 para v2. O teste de erro durante uma transação preservou o estado anterior. |
| PWA | Instalação real pelo Edge, janela independente, remoção da instalação de ensaio, recarga e navegação com o servidor indisponível. A atualização do worker esperou consentimento e preservou o formulário de outra aba. |
| Privacidade | Política 1.1 integral em `/#privacy` e `/privacidade/`. Sem pedidos externos no percurso testado. |
| Acessibilidade | 29 varreduras axe-core 4.11.1, 16 verificações de interação, 22 verificações de ordem de foco e 22 de zoom. Nenhuma falha registrada pelo roteiro. A política também passou a 320, 390 e 1440 px com zero violações e zero resultados inconclusivos. A experiência com VoiceOver continua dependente de teste humano em equipamento Apple. |
| Hospedagem | Wrangler 4.166.0 em loopback aprovou 28 respostas de rotas e cabeçalhos. Em ensaio complementar, o Edge conferiu a navegação das três páginas canônicas, a raiz, os documentos offline, os 14 recursos do cache e a equivalência da política. Foram conferidos por HTTP os bytes dos 22 recursos servíveis do pacote de 23 arquivos, inclusive o 404 personalizado. `_headers` é configuração do host. |
| Licenças | Apache-2.0 e NOTICE presentes nos pacotes. Avisos e bibliotecas de terceiros preservados. Os dois SBOMs passaram pelo esquema CycloneDX 1.6. |

O manifesto do build base tem SHA-256 `ac31acb8401f400f673f203bbee3c121654e6e0597c38046d7b3db497e183a36`. O manifesto da edição com páginas públicas tem SHA-256 `77a260ffd856126d03379dce96a079079b6b17ae08f7c9303434d03b9a4ba481`. O conjunto de dados sintético conservou o SHA-256 `2e10baad347537bd55e39ff68d6dec30f83757a5012ca4fee85153042d01047c` nas três transições.

Os blocos duplicados de rotas no arquivo de cabeçalhos da edição anterior sobrepunham a regra de cache. O gerador agora combina os cabeçalhos de cada rota num único bloco, preservando revalidação e controle de indexação. A conferência do Pages foi repetida sobre a edição corrigida. [Instruções para reproduzir](../BUILD.md)
