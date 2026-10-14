# E-Class Prova Injector — Word branch v0.2.0

Esta branch preserva todo o fluxo do Injector para Edge e acrescenta entrada por **Microsoft Word (`.docx`)**, mantendo o suporte a **LaTeX (`.tex`)**.

A branch `main` permanece como a versão LaTeX-only v0.1.1 já validada no E-Class. A branch `word` é a linha experimental de evolução.

> **Protótipo experimental.** Use sempre DRY RUN e uma prova pequena antes de criar questões reais. Não há rollback automático das questões já criadas.

## Instalação no Edge

1. Baixe/clone esta branch `word`.
2. Abra `edge://extensions`.
3. Ative **Modo de desenvolvedor**.
4. Clique **Carregar sem compactação**.
5. Selecione a pasta que contém `manifest.json`.
6. Entre normalmente no Portal Adventista e abra o E-Class Prova.

## Formatos aceitos

### LaTeX (`.tex`)

Continua funcionando como na branch `main`:

- `\\begin{enumerate} ... \\item ...`;
- macro `\\Questao{...}`;
- alternativas em `enumerate`;
- gabarito comentado (`% 1-c, 2-d...`);
- `\\CorrectChoice` e `✅`;
- fórmulas `$...$`, `\\(...\\)`, `\\[...\\]` e `$$...$$`.

### Word (`.docx`)

O DOCX é aberto **inteiramente no navegador**, sem enviar o arquivo para um serviço externo. A extensão lê internamente os XMLs do pacote Office e normaliza a prova para a mesma estrutura usada pelo parser LaTeX.

Formato recomendado:

```text
MATEMÁTICA

1. O valor de 2 + 2 é:
A) 2
B) 3
C) 4
D) 5
E) 6

2. Resolva a equação x + 3 = 7.
A) x = 1
B) x = 2
C) x = 3
D) x = 4
E) x = 5

GABARITO
1-C
2-D
```

Também são reconhecidas **listas numeradas automáticas do Word** para questões e alternativas.

## Equações do Word

Equações criadas com o **Editor de Equações do Word** são armazenadas em OMML. A branch `word` converte uma parte útil do OMML para LaTeX e reaproveita o fluxo já validado do E-Class:

```text
Equação Word (OMML)
        ↓
Conversão OMML → LaTeX
        ↓
POST /develop/upload
        ↓
SVG do E-Class
        ↓
HTML da questão
```

O conversor cobre, entre outros:

- frações;
- expoentes e índices;
- raízes;
- somatórios, produtórios e integrais;
- delimitadores;
- funções usuais (`sin`, `cos`, `tan`, `log`, `ln` etc.);
- letras gregas e símbolos matemáticos comuns;
- acentos matemáticos, barras e limites;
- matrizes/equation arrays em forma básica.

## Imagens e tabelas do Word

A extensão já consegue **detectar e extrair** imagens contidas no `.docx`, além de identificar seus tipos MIME. Entretanto, o endpoint do E-Class para upload de imagens comuns ainda não foi mapeado. Por isso, nesta versão:

- imagens geram um aviso e um marcador textual;
- o arquivo de imagem é extraído em memória, mas **não é enviado ao E-Class**;
- tabelas simples são convertidas para texto com colunas separadas por `|`;
- tabelas complexas ainda não preservam toda a formatação.

Isso é intencional: a extensão não inventa um mecanismo de upload que ainda não observamos no fluxo oficial.

## Fluxo comum para `.tex` e `.docx`

1. Selecione o arquivo.
2. Clique **Analisar prova**.
3. Confira questões, fórmulas e gabarito.
4. Clique **Carregar do portal** para buscar turmas, bimestres e disciplinas.
5. Mantenha **DRY RUN** marcado e use **Simular payload**.
6. No teste real, desmarque DRY RUN e clique **Criar no E-Class**.
7. Fórmulas são convertidas para SVG pelo endpoint já observado do E-Class.
8. Cada questão é criada em `POST /api/v1/questao`.
9. A avaliação é enviada em `POST /api/v1/aplicacao-avaliacao`.
10. Se a etapa final falhar, a extensão preserva localmente os IDs das questões e oferece **Reenviar só a prova**.

## Segurança operacional

- O Bearer token não é gravado em `chrome.storage`.
- A sessão é detectada a partir do contexto da aba oficial do Portal ou das requisições oficiais.
- O DOCX é processado localmente pelo navegador.
- O histórico local guarda apenas configuração, IDs/respostas das questões e diagnóstico da execução.

## Estado das branches

- **`main`** — v0.1.1, fluxo LaTeX preservado.
- **`word`** — v0.2.0, LaTeX + DOCX/OMML.

## Teste recomendado para Word

Crie um `.docx` com apenas duas questões objetivas, cinco alternativas e um bloco `GABARITO` no final. Inclua uma equação criada pelo Editor de Equações do Word. Primeiro use **DRY RUN** e confira a prévia. Só depois faça um teste real no E-Class.
