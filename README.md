# CAMPULSO

**No ritmo da sua vida universitária.**

Organize disciplinas, tarefas, compromissos e prazos. Informe os horários disponíveis, reveja a proposta de planejamento e aplique os blocos que fizerem sentido para sua semana. O Modo leve reduz a carga planejada de forma reversível.

## Começar

No cenário **Ensaio local**, o CAMPULSO guarda as alterações neste navegador. A instalação da PWA é opcional. Abra o aplicativo online pelo menos uma vez e aguarde o preparo para uso offline. Em **Dados**, exporte uma cópia JSON para levar seus registros a outro dispositivo. Preserve o arquivo em local privado. Trocar de navegador ou de domínio cria outro espaço de dados.

A versão preparada é a 0.2.1. Esta árvore reúne o código para revisão antes da primeira publicação. O repositório histórico de desenvolvimento permanece privado para proteger os arquivos de produção da marca.

## Executar a partir dos fontes

Use Node.js e npm nas versões verificadas para o projeto. Em um diretório de trabalho isolado execute:

```sh
npm ci --no-fund --no-audit
npm run typecheck
npm test
npm run build
npm run preview
```

Abra a raiz do endereço de loopback informado pelo Vite. A raiz e `/?scenario=local` usam o mesmo espaço persistente nesta origem. Os cenários de demonstração podem conter exemplos voláteis. O diretório `dist/` contém o site compilado. A publicação deve usar a raiz de uma origem HTTPS dedicada. As instruções de produção acompanham a preparação de release.

## Documentação

- [Build reproduzível e versões das ferramentas](BUILD.md)
- [Arquitetura e instalação](docs/ARQUITETURA.md)
- [Inventário de licenças e SBOM](docs/LICENCAS_DISTRIBUICAO.md)
- [Testes e acessibilidade](docs/ACESSIBILIDADE.md)
- [Política de Privacidade 1.1 e contato para exercer direitos](PRIVACY.md). No aplicativo, abra “Política de Privacidade” pelo rodapé ou pelo aviso de Dados. O endereço direto na mesma origem é `/#privacy`.
- [Como contribuir](CONTRIBUTING.md), [governança](GOVERNANCE.md), [roadmap](ROADMAP.md), [convivência](CODE_OF_CONDUCT.md) e [segurança](SECURITY.md)

## Licenças

O código próprio é distribuído sob a [Apache License 2.0](LICENSE). Os componentes de terceiros conservam seus avisos e licenças, inclusive as fontes Inter sob SIL OFL 1.1. O [NOTICE dos fontes](NOTICE) identifica as atribuições e os [avisos integrais](public/THIRD_PARTY_NOTICES.txt) acompanham o aplicativo.

A autorização de marca permite redistribuir o SVG compacto sem slogan e os ícones de 192 e 512 pixels para identificar o próprio CAMPULSO no aplicativo e no site. A autorização exclui uso independente, endosso, edição da marca e sublicenciamento geral. Nome, slogan, vinheta e demais ativos de identidade conservam seus direitos próprios.
