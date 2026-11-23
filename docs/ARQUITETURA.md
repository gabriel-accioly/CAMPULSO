# Arquitetura e instalação

A entrada web carrega a interface R02 em React. O Vite compila os recursos estáticos, incluindo JavaScript, CSS, fontes e ícones locais. O manifesto web informa o endereço de instalação e o Service Worker mantém o shell disponível após a primeira carga. A origem HTTPS e o escopo do worker devem ser estáveis. Uma mudança de domínio cria um novo armazenamento do navegador.

Na raiz e na entrada com `?scenario=local`, `r02/entry.tsx` abre `campulso-poc002-r02` usando Dexie. A camada de aplicação grava em transação. O domínio verifica datas, vínculos e regras de planejamento. O esquema contém preferências, disciplinas, compromissos, prazos, tarefas, regras e exceções de disponibilidade, execuções, blocos, decisões do plano e metadados. Os cenários de demonstração usam memória.

A rota `/#privacy` renderiza o texto de `PRIVACY.md` incorporado pelo Vite. O Service Worker inclui o JavaScript no cache da interface. O endereço de contato usa `mailto:`, que abre o cliente de e-mail por iniciativa do usuário.

Em **Dados**, a exportação gera um arquivo JSON. Na restauração, a aplicação valida estrutura, digest e referências, exibe um resumo, oferece uma cópia do estado atual e solicita confirmação antes da substituição. A distribuição web não depende de conta CAMPULSO, API paga ou servidor de banco de dados para os planos dos estudantes.

Para instalar como aplicativo, abra o site em navegador compatível e use a ação de instalação do navegador. Para executar os fontes, siga o [README](../README.md). Em desenvolvimento, `npm run dev` inicia o Vite e `npm run preview` serve o build. O comportamento dos cabeçalhos da hospedagem e os redirecionamentos do Pages precisam de verificação própria além do Vite.
