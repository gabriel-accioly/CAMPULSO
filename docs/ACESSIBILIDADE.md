# Testes e acessibilidade

A auditoria da base 0.2.1 no Edge para Windows cobriu os onze destinos em telas de 320 e 1280 pixels CSS, formulários e estados complementares. Foram 29 varreduras com axe-core 4.11.1, zero violações automáticas, 16 verificações de interação e 22 combinações de tela e zoom a 200% e 400%. Nos seis alvos sinalizados para revisão em Disciplinas, Ajustes e no editor de exceção, a conferência de pixels no Edge registrou contraste mínimo de 5,646:1. O ensaio técnico cobriu navegação por Tab, visibilidade do foco, recuperação de erros e confirmação de restauração.

No staging, um Edge real instalou a PWA, abriu a janela independente e preservou as onze coleções durante recarga, atualização e restauração de backup. O staging tinha autenticação própria. O pacote público é estático.

## Reproduzir

A política abre pelo aviso de Meu dia, pela tela Dados ou pelo rodapé dos onze destinos. Na candidata com política 1.1, o Edge reconheceu o artigo, o título principal, nove títulos de seção, onze itens da lista de coleções e seis links. Nas varreduras específicas da política a 320, 390 e 1440 px, o axe-core 4.11.1 registrou zero violações e zero resultados inconclusivos.

Rode TypeScript, Vitest e build conforme o README. Execute `npm run test:compat` para o contrato dos backups. Consulte os scripts no `package.json` para testes funcionais e de IndexedDB. Use apenas um perfil descartável e dados fictícios em ensaios que simulam perda de conexão, atualização ou restauração.

## Leitores de tela e uso real

Gabriel usou o NVDA, relatou que o leitor reconheceu os elementos observados e aceitou aquele escopo. O relato não identifica as onze telas individualmente. O teste da política 1.1 descrito acima foi automatizado. A validação complementar com VoiceOver em dispositivo Apple ocorrerá durante o uso real por estudantes, com registro e correção dos problemas relatados.

No acompanhamento, percorrer as onze telas e a política usando teclado e leitor de tela. Conferir nomes e rótulos dos formulários, ordem e retorno do foco, anúncios de erro, recarga offline, backup e restauração. Anotar aparelho, navegador, leitor, versões e passos com dados fictícios. O aceite registrado cobre o uso observado e os ensaios disponíveis têm escopo limitado.
