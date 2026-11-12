# E-Class Prova Injector — Edge v0.2.6

Extensão local para Microsoft Edge que lê uma prova em `.tex`, extrai questões objetivas e gabarito, converte as fórmulas LaTeX usando o mesmo endpoint observado no E-Class e cria as questões / avaliação pelas APIs usadas pelo próprio portal.

> **Protótipo experimental.** Use primeiro com prova de teste. Não há rollback automático para questões já criadas.

## Pacote completo para gerar provas com figuras em qualquer LLM

Agora o Git inclui um **exemplo autocontido** com 1 arquivo LaTeX, **5 imagens PNG reais** e documentação de importação. Diferentemente dos exemplos antigos na raiz (que servem de referência textual), o pacote contém todos os arquivos binários mencionados no `.tex`.

- **[Abrir modelo pronto](templates/prova_com_figuras/README.md):** `prova_exemplo.tex` com 4 questões, gráficos no enunciado, figuras nas alternativas, fórmulas e gabarito; imagens PNG organizadas em subpastas.
- **[Prompt reutilizável para ChatGPT, Claude, Gemini e outros LLMs](docs/PROMPT_GERAR_PROVA_COMPATIVEL.md):** contrato de geração do `.tex`, pasta e figuras reais, convenção de caminhos, verificações e formato de entrega.
- **[Teste automático do pacote](tests/template-package.test.js):** verifica assinatura PNG, tamanho, resolução de todos os caminhos de imagem, parser, alternativas e gabarito.

```text
templates/prova_com_figuras/
├── prova_exemplo.tex
├── README.md
├── Q3_TAGFIGURAAQUI.png
├── figuras/grafico_frequencias.png
└── alternativas/
    ├── triangulo_retangulo.png
    ├── triangulo_acutangulo.png
    └── triangulo_obtusangulo.png
```

Para usar no Edge, **extraia qualquer ZIP primeiro** e selecione a **pasta inteira** em **Selecionar pasta da prova (.tex + imagens)**. A estrutura de diretórios deve permanecer igual à descrita no `.tex`.

> **Aceitação de figuras:** o pacote é validado para a **resolução local de imagens do Injector**. O envio do HTML resultante ao E-Class ainda exige teste real autenticado: o backend pode não aceitar URLs `data:image`. O exemplo **não** comprova que a prova ilustrada já tenha sido publicada com sucesso.

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
4. **Preferencialmente selecione a pasta da prova**, contendo o `.tex` e suas figuras. A extensão associará automaticamente as figuras referenciadas, inclusive nas alternativas. Também é possível selecionar apenas o `.tex` e depois a pasta das imagens.
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

## Limitações gerais

- somente questões objetivas;
- TikZ é detectado e omitido com aviso;
- `\\includegraphics` é importado quando a imagem é encontrada na pasta selecionada ou associada manualmente; caso contrário, o envio é bloqueado até que a figura seja vinculada;
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


## Melhorias da v0.2.0 (branch de desenvolvimento)

### 1. Figuras manuais por marcador no LaTeX

Escreva o marcador **exatamente no local onde a imagem deve aparecer** no enunciado ou em qualquer alternativa:

```tex
\item Analise o gráfico a seguir.

TAGFIGURAAQUI

Qual é a alternativa correta?
\begin{enumerate}
  \item A
  \item B
  \item C
\end{enumerate}
```

- É possível usar `TAGFIGURAAQUI` e os marcadores numerados `TAGFIGURAAQUI_2`, `TAGFIGURAAQUI_3` etc. A mesma tag repetida na mesma questão reutiliza a imagem.
- Ao analisar a prova, cada questão com marcador terá campo de upload de figura (PNG, JPG, WEBP, GIF, até 1,5 MB por arquivo), opção de URL HTTPS e botão **Remover**.
- A prévia exibe a figura no ponto do marcador, preservando o texto anterior e posterior.
- Uma figura faltante impede o envio. Imagens locais são convertidas para URLs `data:image/...;base64` e inseridas no HTML das questões; imagens armazenadas em HTTPS são inseridas pela URL.
- **Compatibilidade a validar:** a extensão não dispõe de um endpoint de upload de imagens documentado no E-Class. O backend/editor pode rejeitar, remover ou não renderizar URLs `data:`. Faça uma avaliação de teste com **DRY RUN** primeiro e, para publicação, prefira uma URL HTTPS estável se o portal não aceitar imagem embutida. O código não usa hospedagem externa automática. O tamanho total de dados embutidos é limitado a 3,5 MB em base64 por execução.

Arquivo de demonstração: `exemplo_figura_eclass.tex`.

### 2. Selecionar alunos específicos

Marque **Enviar somente para alunos específicos das turmas selecionadas** em **2. Destino** e escolha as turmas. Se a resposta de consulta das turmas contiver uma lista de matrículas, os alunos aparecem para seleção por checkbox. Caso contrário, informe manualmente os IDs (um por linha) no formato `turma_id;aluno_id`; com somente uma turma selecionada, basta um ID por linha.

**Proteção contra envio à turma toda:** o schema de `publico_alvo` para destinatário individual **não pôde ser confirmado na API pública do E-Class**. O campo de **Modelo de público individual validado** é, portanto, obrigatório. A extensão não realiza um envio real com um campo especulativo que o backend poderia ignorar, ocasionando acesso de toda a turma.

No campo de modelo, informe um **objeto JSON correspondente a uma entrada individual validada da API**, usando as variáveis `{{turma_id}}`, `{{entidade_id}}` e **ao menos uma** de `{{alunos_ids}}` ou `{{alunos_objetos}}`. As variáveis são substituídas preservando tipos numéricos e arrays. O exemplo exibido no campo é **ilustrativo, não é um schema verificado**; não use sem conferir no portal. A extensão não salva os nomes das matrículas no histórico.

### 3. Inserir questões em provas existentes

Em **1. Arquivo da prova**, marque **Adicionar questões a uma prova já criada**. Escolha o intervalo retroativo (15 dias por padrão) e clique **Listar provas**. A extensão consulta a rota **confirmada no HAR** `GET /api/v1/avaliacao` com parâmetros de ano, entidade, editora, ordenação e paginação. A listagem pode conter várias aplicações para a mesma avaliação; cada opção usa o UUID da aplicação. Como a listagem não informa a data de criação, a extensão consulta os detalhes de cada aplicação em `GET /api/v1/aplicacao-avaliacao/{uuid}` e aplica o intervalo (15 dias por padrão) ao campo `created_at`. O histórico local continua como alternativa.

- A extensão exige que `GET /api/v1/aplicacao-avaliacao/{uuid}` retorne o objeto completo com `aplicacao`, `avaliacao` e `questoes`. Caso contrário, bloqueia a atualização.
- Bloqueia provas ativas ou quando encontra respostas existentes.
- Cria **somente as questões novas**, recupera novamente o estado da prova, adiciona seus IDs sem duplicatas e recalcula os pesos para totalizar 100%. Faz uma tentativa de `PUT /api/v1/aplicacao-avaliacao/{uuid}` preservando os demais campos retornados.
- Confere o retorno via GET e exige encontrar todos os IDs novos antes de sinalizar sucesso.
- Se a operação falhar, salva os IDs de questões e o estado pendente localmente. **Reenviar só a prova** reutiliza os IDs, evitando recriá-las. O reenvio exige o mesmo contexto de entidade, perfil e ano.

**Compatibilidade a validar:** as rotas de listagem `GET /api/v1/avaliacao` e de detalhes `GET /api/v1/aplicacao-avaliacao/{uuid}` **foram observadas no HAR, com respostas HTTP 200**, e o formato de suas respostas foi adaptado. **A rota e o formato de atualização `PUT` ainda não foram confirmados em uma sessão autenticada do portal**. Verifique primeiramente com uma prova de teste **não publicada e sem respostas**. O portal poderá exigir rota ou payload diferentes; não há fallback que sobrescreva a prova sem dados completos.

### Testes e regressões

```sh
node --test tests/*.test.js
```

Os testes cobrem reconhecimento de marcadores, validação de imagens, público individual, listagem/filtragem, mesclagem idempotente de questões, preservação de dados da avaliação, bloqueio de provas ativas e carregamento/sintaxe dos scripts da extensão.

**Importante:** estes são testes locais com objetos simulados; não certificam o contrato da API privada nem a aceitação de imagens embutidas. O modo **DRY RUN** continua sendo o fluxo recomendado antes de qualquer envio real.


### 4. Importação automática de figuras (v0.2.1)

**Modo recomendado:** clique **Selecionar pasta da prova (.tex + imagens)**, conceda acesso local pelo Edge e, se houver mais de um arquivo `.tex`, escolha a prova no seletor. O painel carrega a prova e associa as imagens encontradas. O seletor anterior de arquivo `.tex` permanece disponível para uso isolado.

**Limitação do navegador:** por segurança, selecionar um único `.tex` não fornece à extensão o caminho completo nem autorização para ler a pasta onde ele está. É necessário selecionar a pasta explicitamente para importar as imagens automaticamente; ela pode conter só figuras quando o `.tex` já tiver sido selecionado.

**Resolução de imagens:**

- `\includegraphics[width=.5\linewidth]{figuras/grafico.png}`: procura o caminho relativo ao `.tex`, incluindo subpastas. Também aceita referência sem extensão e `\graphicspath{{figuras/}{imagens/}}`.
- Se não houver caminho exato, procura o nome do arquivo apenas quando existe uma única correspondência na pasta autorizada.
- Para marcadores `TAGFIGURAAQUI`, `TAGFIGURAAQUI_2` e similares, reconhece imagens com nomes como `Q2_TAGFIGURAAQUI.png`, `questao_2_TAGFIGURAAQUI_2.jpg` ou `TAGFIGURAAQUI.png`.
- Se várias imagens puderem corresponder, nenhuma será escolhida automaticamente. Se um marcador não tiver arquivo identificável, a imagem fica pendente até a associação manual.

**Imagens nas alternativas:** coloque `\includegraphics{alternativas/opcao-a.png}` e outras referências dentro de cada `\item` da lista de opções. Cada alternativa poderá usar uma figura diferente, e o painel permitirá trocá-la por upload manual ou URL HTTPS. Se usar marcadores em vez de `\includegraphics`, dê nomes de tags distintos a cada figura.

Exemplo prático disponível em `exemplo_figuras_alternativas.tex`. Estrutura sugerida:

```text
MinhaProva/
├── exemplo_figuras_alternativas.tex
├── Q3_TAGFIGURAAQUI.png
├── figuras/
│   └── grafico-funcao.png
└── alternativas/
    ├── figura-a.jpg
    ├── figura-b.jpg
    ├── figura-c.jpg
    └── figura-d.jpg
```

**Segurança e limites:** PNG, JPEG, WEBP e GIF; o arquivo precisa ter assinatura válida. Máximo de 1,5 MB por figura, e 3,5 MB de imagens base64 no total de cada execução. Só as imagens efetivamente referenciadas são lidas. Durante a análise, elas permanecem em memória e não são publicadas externamente. Para envio da prova, as imagens são inseridas no HTML como `data:image/...;base64` ou URL HTTPS.

**Integração pendente:** não há confirmação, com sessão autenticada, de que o backend do E-Class aceite imagens `data:` em questões. Realize um envio de teste e confira a renderização antes de publicar provas reais.

### 5. Correção da listagem do E-Class (v0.2.2)

O HAR confirmou **HTTP 200** para `GET /api/v1/avaliacao` e a resposta paginada `data.data`, com campos `current_page`, `last_page` e `total`. A listagem inicialmente analisada possuía **61 avaliações em três páginas**. A consulta agora usa os mesmos parâmetros observados: `editora_id`, `entidade` (JSON), `ano`, `page`, `page_size`, `tipo_gerenciada_except` e `orderBy`.

Cada avaliação possui um array `aplicacoes`. O seletor representa **cada aplicação** por seu próprio UUID, pois a rota de detalhe é `GET /api/v1/aplicacao-avaliacao/{uuid}`. Os detalhes contêm a data real de criação em `created_at` e a avaliação aninhada em `avaliacao`. O filtro retroativo (15 dias por padrão) considera **criação**, não `data_inicio` agendada. A extensão consulta os detalhes em grupos de quatro requisições e exibe alertas se alguma consulta falhar. Aplicações ativas, encerradas ou com tentativas são identificadas como não editáveis.

A criação de questões e a tentativa de atualização via PUT permanecem em fase experimental: o HAR comprova apenas as rotas GET de listagem e detalhe, **não o contrato de escrita**. Novos testes sintéticos verificam paginação, UUID de aplicação, data de criação e bloqueio de avaliações ativas. Nenhum dado do HAR foi incorporado ao repositório.

### 6. Listagem resiliente e diagnóstico (v0.2.3)

Correção para listagem vazia mesmo com a versão 0.2.2 instalada. A versão anterior ocultava todas as aplicações quando `GET /api/v1/aplicacao-avaliacao/{uuid}` falhava, pois exigia `created_at` para incluir a prova no seletor. Agora, **os resultados da listagem paginada são exibidos primeiro**. A consulta individual complementa a data de criação, marca aplicações ativas/encerradas e elimina apenas datas verificadas que estejam fora do período. Se a consulta individual falhar, o item permanece com o aviso **criação não verificada**; sua edição continua sujeita à verificação do GET antes de qualquer escrita.

A consulta de leitura não exige localmente um token Bearer, pois ele pode não estar disponível para a extensão. O servidor do E-Class continua responsável por autorizar o GET. **Toda escrita permanece com token e confirmação.** Falhas na listagem são mostradas na própria interface com código HTTP e sugestão de verificar sessão, entidade e ano. Falhas 401/403/429 nas consultas de detalhes interrompem novas solicitações após o lote em andamento, sem apagar provas já listadas.

Validação: testes simulados cobrem paginação, filtros, perda de acesso aos detalhes, ausência de token em consultas de leitura e preservação da proteção das requisições de escrita. A integração real com o portal deve ser confirmada no Edge do usuário. **A operação PUT de atualização de uma prova ainda não foi verificada pelo HAR.**

### 7. Retorno da exportação ao Corretor de Gabaritos (v0.2.4)

A exportação já existia na branch `word`, mas não tinha sido incluída na branch das melhorias de imagens/listagem. O botão **Exportar para Corretor** voltou para uma seção separada do envio ao E-Class. Ele usa as questões LaTeX **já analisadas**, não recria questões nem altera avaliações.

O arquivo gerado segue o schema existente `eclass-omr-exam/1` (`*.eclass-omr.json`), com os campos originais `schema`, `version`, `source`, `exportedAt`, `externalId`, `exam.title`, `exam.subject`, `exam.mode`, `exam.questions`, `exam.omr` e `exam.classes`. O gabarito é A-E das objetivas, mantendo seus números originais. Se a lista de alunos das turmas estiver disponível, inclui os nomes/IDs no pacote; se não estiver, permite exportação geral. Se houver seleção de alunos específicos, não exporta estudantes não selecionados. Gabarito ausente, questões repetidas e alternativas incompatíveis são bloqueados.

O campo **Título do gabarito** permite personalizar o nome. Com o campo vazio, usa o título da avaliação existente selecionada, o título informado no formulário ou o nome do arquivo LaTeX. A exportação usa ID externo determinístico por prova/ano/entidade para facilitar reimportações sem gerar duplicações acidentais. A exportação não envia dados ao portal, embora o arquivo JSON baixado possa conter nomes dos alunos; mantenha-o protegido.

**Atenção à recuperação de operações:** se o E-Class retornar HTTP 500 ao tentar atualizar uma prova existente, as questões que já foram criadas poderão continuar no banco mesmo sem associação à avaliação. Não repita **Criar no E-Class** nem desinstale a extensão: o estado pendente fica em `chrome.storage.local`. Antes de clicar em **Reenviar só a prova**, confira se as questões já foram associadas à avaliação; o contrato do PUT continua não confirmado. O botão do Corretor funciona independentemente dessa pendência.

### 8. Turmas oficiais e permissões de provas existentes (v0.2.5)

**Problema observado no envio real:** 20 questões foram criadas, mas a tentativa de `PUT /api/v1/aplicacao-avaliacao/{uuid}` retornou HTTP 500. O HAR fornecido mostra que a aplicação consultada já possui **duas turmas em `publico_alvo`**, com propriedades específicas por turma e `is_owner: false`. Isso não prova que a restrição de turmas causou o erro; também não foi confirmada a estrutura aceita pelo servidor no PUT.

**Ao escolher uma prova existente:**

1. O Injector consulta `GET /api/v1/aplicacao-avaliacao/{uuid}` e extrai as turmas de `publico_alvo`, apresentando seus nomes, IDs e totais de destinatários quando informados.
2. A seção **Destino → Turmas** passa a exibir somente as turmas oficiais associadas, com os checkboxes **bloqueados**. Quando uma turma não consta das opções carregadas na conta, ela continua visível na lista oficial.
3. A seleção manual feita para uma prova **nova** é preservada e restaurada ao sair do modo de atualização.
4. O código de mesclagem de questões preserva o objeto completo `aplicacao.publico_alvo` sem substituí-lo; nenhum checkbox do formulário altera o público da prova existente.
5. Antes de criar qualquer questão nova para uma aplicação existente, o Injector verifica atividade/tentativas, presença de `publico_alvo` e sinais de autorização da sessão. Se `is_owner` for `false` (ou desconhecido) e **não houver permissão explícita de editar questões**, bloqueia a ação **antes de criar questões**.
6. Se o servidor expuser futuramente uma permissão **positiva e explícita** para editar público-alvo, ela poderá ser detectada. Porém, a alteração de turmas continua **desabilitada mesmo nessa situação**, até capturarmos e validarmos o contrato oficial de escrita e as regras de coordenação. A propriedade `is_owner: true` **sozinha não autoriza alterar turmas**.

**Segurança da pendência anterior:** a atualização do código não descarta o estado salvo em `chrome.storage.local`, nem recria as 20 questões. Não desinstale a extensão; recarregue-a na mesma pasta. Não use **Criar no E-Class** novamente e não pressione **Reenviar só a prova** até verificar se a atualização já foi aplicada e obter confirmação da rota de edição. A conta pode estar como coautora sem ser proprietária; `is_owner: false` não comprova, isoladamente, ausência de toda e qualquer permissão de coautoria.

**Limitação:** a inferência de autorização de edição de questões é conservadora e baseada apenas nas informações atualmente observadas. Provas de terceiros podem exigir fluxo de autorização diferente, mesmo para coautores. A operação PUT permanece experimental: isso não substitui um HAR capturado ao editar com sucesso uma prova existente no portal oficial.

### 9. Prova existente: disciplinas por cota e calendário oficial (v0.2.6)

Ao selecionar uma aplicação existente, a extensão consulta o GET oficial, identifica as atribuições de coautoria para a conta autenticada e monta **uma distribuição sequencial** das questões importadas pelas cotas de cada disciplina. A ordem de disciplinas segue `avaliacao.avaliacao_disciplinas` quando disponível; caso contrário, usa a ordem das atribuições retornadas. Por exemplo, com Matemática (15 vagas) e Investigação Matemática (5 vagas), uma importação de 20 objetivas associa Q1–Q15 a Matemática e Q16–Q20 a Investigação Matemática. Cada POST de questão usa **seu próprio `padrao_disciplina_id`**. O painel mostra a distribuição e cada questão recebe uma identificação de disciplina na prévia.

A distribuição é administrativa: **não examina o significado dos enunciados**. Antes de publicar, o professor deve conferir que as últimas cinco questões realmente pertencem à disciplina de Investigação Matemática e, se não pertencerem, reorganizar o LaTeX ou revisar o material. Se os limites por disciplina não forem informados, já estiverem ocupados, houver disciplinas desconhecidas ou o total de questões exceder as vagas restantes, a extensão **bloqueia a criação antes do primeiro POST**.

O **Destino** de uma prova já criada exibe as várias disciplinas e respectivas cotas, **oculta o seletor único** de disciplina e preenche automaticamente os campos de bimestre, data de início e data de resultado a partir da aplicação. Os três campos ficam **bloqueados para edição**. Se um deles não for informado pelo portal, isso é explicitado sem inventar valor. As turmas originais permanecem bloqueadas e não são substituídas pelos checkboxes locais.

**Regressão para provas novas:** ao desmarcar o modo existente, a extensão restaura as turmas, a disciplina única, o bimestre e as datas originais que o usuário havia escolhido. A montagem tradicional de `assessmentPayload` para `POST /aplicacao-avaliacao` e o `questionPayload` de novas provas mantêm o comportamento anterior. Há testes específicos para ambos os payloads, alternância de modo, cotas 15+5, cotas já utilizadas, ordem de disciplinas, calendário e casos inválidos.

**Pendências anteriores:** se existirem questões já criadas em uma tentativa com erro 500, **não remova a extensão, não recrie as questões e não limpe a pendência**. O botão **Verificar vínculo pendente (sem gravar)** consulta o GET para conferir a vinculação. O reenvio por PUT é bloqueado quando o total das questões já criadas ultrapassa a cota da disciplina ou quando não é possível confirmar os IDs de disciplina das questões pendentes. A nova distribuição das questões **não reclassifica retroativamente** itens já criados; estes precisam ser conferidos no portal antes de qualquer operação adicional.

**Validação:** os testes Node existentes continuam no workflow GitHub Actions, agora também com verificação de sintaxe dos scripts. Testes simulados não substituem a prova de integração real com o E-Class; o PUT segue experimental. Faça primeiro um DRY RUN com uma prova de teste e confira a distribuição antes de enviar.
