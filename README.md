# E-Class Prova Injector — Edge v0.1.1

Extensão local para Microsoft Edge que lê uma prova em `.tex`, extrai questões objetivas e gabarito, converte as fórmulas LaTeX usando o mesmo endpoint observado no E-Class e cria as questões / avaliação pelas APIs usadas pelo próprio portal.

> **Protótipo experimental.** Use primeiro com prova de teste. Não há rollback automático para questões já criadas.

## Instalação no Edge

1. Extraia o ZIP em uma pasta permanente, por exemplo `Documentos\\EClass-Injector`.
2. Abra `edge://extensions`.
3. Ative **Modo de desenvolvedor**.
4. Clique **Carregar sem compactação**.
5. Selecione a pasta que contém `manifest.json`.
6. Fixe **E-Class Prova Injector** na barra de extensões, se desejar.

## Uso

1. Entre normalmente no Portal Adventista e abra **E-Class Prova**.
2. Clique no ícone da extensão e escolha **Abrir painel lateral**.
3. Clique **Detectar sessão**. A extensão observa somente as requisições para os domínios do E-Class listados no `manifest.json`; o Bearer token fica apenas em memória e não é persistido.
4. Selecione um arquivo `.tex`.
5. Informe a seção (por padrão `MATEMÁTICA`) e clique **Analisar LaTeX**.
6. Confira número de questões, fórmulas e gabarito.
7. Clique **Carregar do portal** para atualizar turmas, bimestres e disciplinas.
8. Mantenha **DRY RUN** marcado e clique **Simular payload**.
9. Para um teste real, desmarque DRY RUN e clique **Criar no E-Class**.

## Segurança operacional

- O token de sessão **não é salvo** em `chrome.storage`.
- A extensão captura em memória o `Authorization: Bearer ...` e os cabeçalhos `X-Portal-*` das requisições oficiais do E-Class, apenas nos domínios declarados.
- Se a sessão não for detectada, recarregue a página E-Class. Há também um campo de token manual; ele não é persistido.
- O histórico local guarda apenas configuração, IDs/respostas das questões e diagnóstico da execução; não guarda o token.

## Fluxo implementado

1. Parser do `.tex` identifica questões e alternativas.
2. Gabarito é lido de comentários como `% 1-c, 2-d` ou de `\\CorrectChoice` / `✅`.
3. Fórmulas `$...$`, `\\(...\\)`, `\\[...\\]` e `$$...$$` são enviadas a `/develop/upload` e substituídas pelo SVG retornado.
4. Cada questão é criada em `POST /api/v1/questao`.
5. A prova é montada e enviada para `POST /api/v1/aplicacao-avaliacao`.
6. Se a etapa 5 falhar (por exemplo HTTP 500), os IDs das questões e o payload da prova são salvos em `chrome.storage.local`. O botão **Reenviar só a prova** continua disponível mesmo após fechar/reabrir o painel ou reiniciar o Edge.

## Formatos reconhecidos

- `\\begin{enumerate} ... \\item ...`
- macro `\\Questao{...}`
- alternativas em `enumerate`
- gabarito comentado (`% Gabarito Matemática: % 1-c, 2-d...`)
- `\\CorrectChoice` e `✅`
- macros simples sem parâmetros, como `\\newcommand{\\kN}{\\,\\mathrm{kN}}`

## Limitações da v0.1

- somente questões objetivas;
- TikZ é detectado e omitido com aviso;
- `\\includegraphics` é detectado e omitido com aviso;
- tabelas complexas são omitidas com aviso;
- não há exclusão automática das questões se a criação da avaliação falhar;
- a pendência de prova é persistida localmente até o reenvio funcionar ou você clicar em **Limpar pendência**;
- os IDs padrão presentes no painel foram obtidos no ambiente analisado, mas a extensão tenta substituí-los pelo contexto real capturado e pelos dados carregados do portal.

## Teste recomendado

Use `exemplo_eclass.tex` com:

- uma turma;
- duas questões;
- título `TESTE INJECTOR - APAGAR`;
- DRY RUN primeiro.

Quando o endpoint de criação da avaliação estiver estável, faça o primeiro envio real com esse arquivo antes de usar uma prova grande.

## Novidades da v0.1.1

- Persistência da prova pendente e das questões já criadas após HTTP 500.
- Restauração automática da pendência ao reabrir o painel/Edge.
- Botão **Limpar pendência** para descartar apenas o estado local sem apagar questões do E-Class.
