# Licenças e componentes da candidata 0.2.1

O arquivo LICENSE contém a Apache License 2.0 para o código próprio. O aviso entregue na raiz do site reproduz os termos aplicáveis aos componentes de terceiros, o NOTICE original do Dexie, a licença e os copyrights das fontes, além dos limites de utilização da identidade visual. As referências históricas de ferramentas no lockfile descrevem o ambiente de compilação e testes.

| Componente incorporado | Evidência de versão | Licença |
| --- | --- | --- |
| React, React DOM, Scheduler | 19.3.1, 19.3.1, 0.28.0 no lockfile e módulos do grafo de produção | MIT |
| Dexie | 4.4.7 no lockfile e no grafo | Apache-2.0, incluindo NOTICE |
| Polyfill modulepreload do Vite | 6.4.6, módulo virtual emitido | MIT |
| Auxiliares CommonJS do Rollup | Módulo virtual de interoperabilidade do build Vite. Revisão do plugin incorporado indeterminada | MIT |
| tslib, safari-14-idb-fix, fragmentos do promise-light/promise-polyfill | Mapa e atribuições do Dexie conferidos na auditoria de origem. Versões 2.8.1, 3.0.0 e revisão indeterminada, respectivamente | 0BSD, Apache-2.0 e MIT |
| Fontes Inter | Quatro OpenType da versão 4.001. Cada digest corresponde ao arquivo autorizado da candidata anterior | SIL OFL 1.1 |
| Identidade R10 | SVG compacto, ícones de 192 e 512 pixels, com hashes registrados no SBOM | Autorização restrita para identificar o aplicativo e o site CAMPULSO |

O grafo de 47 módulos inclui a política de privacidade, os quatro pacotes de aplicação e os auxiliares de compilação. O arquivo de atribuições preserva os termos de origens incorporadas dentro de Dexie e Vite. O material de referência da fonte Inter Display permanece na árvore de desenvolvimento sob a sua licença. O host entrega Inter Regular, Medium, SemiBold e Bold.

Na revisão com a política 1.1, o lockfile, os módulos incorporados, as licenças, os avisos, as fontes e os três derivados R10 conservaram as mesmas origens. Os hashes de todos os arquivos servidos constam do [manifesto desta distribuição](SHA256SUMS_DISTRIBUICAO.txt). O SBOM descreve o conteúdo pós-compilação. O lockfile também identifica ferramentas usadas somente durante desenvolvimento, build e testes.

A autorização R10 cobre os três derivados presentes no build. O favicon e o manifesto utilizam o mesmo arquivo `r02/icons/icone-192.png`. O SVG conserva seu conteúdo aprovado e recebe o nome versionado do Vite. A licença do código não concede uso independente da marca. A matriz, as pranchas e os arquivos de produção pertencem ao acervo privado.

O lockfile referencia 150 pacotes, inclusive opcionais de outras plataformas. O build exclui as ferramentas de desenvolvimento. Isso inclui `stackback@0.0.2`, cuja atribuição MIT própria segue sem comprovação. O texto BSD-3-Clause de parte de seu código e a declaração de licença no manifesto foram identificados na auditoria de origem. Uma distribuição futura dessa ferramenta exigirá conferência específica.

[Licença do código](../LICENSE) · [Avisos integrais](../public/THIRD_PARTY_NOTICES.txt) · [SBOM dos 17 arquivos e 10 componentes](SBOM.cdx.json) · [Referência de formato CycloneDX](https://cyclonedx.org/docs/1.6/json/).
