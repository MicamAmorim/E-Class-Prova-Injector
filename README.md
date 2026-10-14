# E-Class Prova Injector — Word branch v0.3.0

Esta branch preserva todo o fluxo do Injector para Edge e acrescenta entrada por **Microsoft Word (`.docx`)**, mantendo o suporte a **LaTeX (`.tex`)**. A branch `main` continua preservada como a versão LaTeX-only v0.1.1 já validada.

> **Protótipo experimental.** Use DRY RUN e uma prova pequena antes de criar questões reais. Não há rollback automático das questões já criadas.

## Novidades da v0.3.0

- questões **objetivas e abertas** na mesma prova;
- questão aberta com **número de linhas** e formato **com linhas / espaço em branco**;
- upload de **imagens extraídas do DOCX** pelo mesmo endpoint do CKEditor observado no Portal;
- `Carregar do portal` busca **turmas, bimestres, disciplinas e alunos** disponíveis na sessão autenticada;
- exportação para o app de correção por arquivo `*.eclass-omr.json`;
- exportação inclui as turmas selecionadas e respectivos alunos quando o Portal disponibiliza esses dados;
- se não houver lista de alunos, a exportação continua válida como **gabarito geral**.

## Instalação no Edge

1. Baixe/clone esta branch `word`.
2. Abra `edge://extensions`.
3. Ative **Modo de desenvolvedor**.
4. Clique **Carregar sem compactação**.
5. Selecione a pasta que contém `manifest.json`.
6. Entre normalmente no Portal Adventista e abra o E-Class Prova.

## Questões objetivas e abertas

O parser considera uma questão com alternativas como **objetiva**. Uma questão sem alternativas é tratada como **aberta**. Na prévia do Injector cada aberta mostra controles para escolher o formato da resposta impressa e a quantidade de linhas/altura.

No LaTeX, é possível opcionalmente declarar a configuração no próprio enunciado:

```text
[[ECLASS:ABERTA; linhas=12; formato=linhas]]
```

ou:

```text
[[ECLASS:ABERTA; linhas=8; formato=branco]]
```

No DOCX não é necessário usar essa diretiva: uma questão numerada sem bloco A/B/C/... será tratada como aberta e receberá os valores padrão do painel, que podem ser ajustados por questão na prévia.

### Campos observados no E-Class

O HAR capturado em 14/10/2026 mostrou uma questão aberta sendo criada em `POST /api/v1/questao` com:

```json
{
  "tipo": 1,
  "formato_resposta_impressao": 1,
  "formato_resposta_impressao_linhas": "30"
}
```

A questão aberta usa `alternativas: []`. A extensão replica essa estrutura. O único ponto ainda a validar empiricamente é a semântica do enum de `formato_resposta_impressao`: o protótipo usa `1 = com linhas` e `0 = espaço em branco`. O HAR contém apenas o estado final enviado, não os dois estados do seletor. Se o primeiro teste revelar a convenção inversa, basta inverter esse mapeamento.

## Formatos aceitos

### LaTeX (`.tex`)

- `\\begin{enumerate} ... \\item ...`;
- macro `\\Questao{...}`;
- alternativas em `enumerate`;
- gabarito comentado (`% 1-c, 2-d...`);
- `\\CorrectChoice` e `✅`;
- fórmulas `$...$`, `\\(...\\)`, `\\[...\\]` e `$$...$$`;
- questões abertas sem bloco de alternativas.

### Word (`.docx`)

O DOCX é aberto **inteiramente no navegador**. A extensão lê os XMLs do pacote Office e normaliza a prova para a mesma estrutura usada pelo parser LaTeX. São reconhecidos números digitados (`1.`, `2.`), alternativas `A)`, `B)` etc. e também listas numeradas automáticas do Word.

Exemplo:

```text
MATEMÁTICA

1. O valor de 2 + 2 é:
A) 2
B) 3
C) 4
D) 5
E) 6

2. Explique por que a soma dos ângulos internos de um triângulo é 180°.

GABARITO
1-C
```

A Q1 será objetiva e a Q2 aberta.

## Equações do Word

Equações criadas com o **Editor de Equações do Word** são armazenadas em OMML. A extensão converte uma parte útil do OMML para LaTeX e reaproveita o fluxo já validado do E-Class:

```text
Equação Word (OMML)
        ↓
OMML → LaTeX
        ↓
POST /develop/upload
        ↓
SVG do E-Class
        ↓
HTML da questão
```

O conversor cobre frações, expoentes/índices, raízes, somatórios, produtórios, integrais, delimitadores, funções usuais, letras gregas, acentos, limites e matrizes/equation arrays em forma básica.

## Imagens do Word

O HAR mostrou o editor oficial enviando uma imagem colada com `Ctrl+V` para:

```text
POST /api/v1/upload/ckeditor-image?path=avaliacoes
```

como `multipart/form-data`, campo `upload`. A resposta traz a URL final da imagem e o enunciado da questão salva essa URL em uma tag `<img>`.

A v0.3.0 usa esse mesmo fluxo para imagens embutidas no `.docx`: extrai os bytes localmente, envia pelo endpoint do CKEditor e substitui o marcador interno pela URL retornada antes de criar a questão.

Tabelas simples continuam sendo convertidas para texto; tabelas complexas ainda não preservam toda a diagramação.

## Carregar do portal

A extensão consulta os endpoints autenticados com `strict_user=true` para obter os dados visíveis ao professor no contexto atual:

- turmas;
- disciplinas;
- bimestres/períodos;
- alunos da entidade/turmas.

A associação aluno → turma usa os IDs de turma retornados pelo próprio Portal. Token e cookies não são exportados nem persistidos pela extensão.

## Exportar para o Corretor de Gabaritos

O botão **Exportar para Corretor** gera um arquivo `*.eclass-omr.json` com schema `eclass-omr-exam/1`.

O arquivo contém:

- título e disciplina;
- sequência das questões;
- quais questões são objetivas ou abertas;
- gabarito A-E somente das objetivas;
- numeração original das objetivas;
- turmas selecionadas;
- lista de alunos por turma, se `Carregar do portal` tiver retornado o roster.

Questões abertas ficam registradas no pacote para contexto, mas não entram no gabarito OMR automático.

Se os alunos não estiverem disponíveis, o pacote é exportado em modo geral e ainda pode ser importado normalmente pelo Corretor.

## Fluxo comum

1. Selecione `.tex` ou `.docx`.
2. Clique **Analisar prova**.
3. Confira objetivas, abertas, fórmulas, imagens e gabarito.
4. Ajuste linhas/espaço em branco das abertas, se necessário.
5. Clique **Carregar do portal**.
6. Mantenha **DRY RUN** e use **Simular payload**.
7. Opcionalmente use **Exportar para Corretor**.
8. No teste real, desmarque DRY RUN e clique **Criar no E-Class**.
9. Se `/aplicacao-avaliacao` falhar, os IDs das questões e o payload da prova continuam preservados para **Reenviar só a prova**.

## Segurança operacional

- Bearer token não é gravado em `chrome.storage`;
- o DOCX é processado localmente;
- a exportação OMR não contém token/cookies;
- o histórico local guarda somente configuração, IDs/respostas e diagnóstico;
- use uma prova de teste antes de uma prova grande.

## Estado das branches

- **`main`** — v0.1.1, LaTeX-only preservado;
- **`word`** — v0.3.0, LaTeX + DOCX/OMML + abertas + imagens + roster + exportação OMR.
