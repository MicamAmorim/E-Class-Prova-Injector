# Modelo completo: prova LaTeX com figuras

Este diretório é um **exemplo autocontido**, com arquivo `.tex`, imagens PNG verdadeiras e gabarito. Foi construído para exercitar o **parser e a importação de pasta do E-Class Prova Injector**.

> **Distinção importante:** os testes do repositório validam o reconhecimento dos arquivos, as referências e a geração de HTML pelo Injector. A aceitação final das imagens pelo backend privado do E-Class (sobretudo URLs `data:image`) **não foi certificada em um teste real autenticado**. Use DRY RUN e uma prova de teste antes de publicar.

## Estrutura que deve ser preservada

```text
prova_com_figuras/
├── prova_exemplo.tex
├── Q3_TAGFIGURAAQUI.png
├── figuras/
│   └── grafico_frequencias.png
└── alternativas/
    ├── triangulo_retangulo.png
    ├── triangulo_acutangulo.png
    └── triangulo_obtusangulo.png
```

São **4 questões objetivas**, com **5 referências de imagem** (uma no enunciado da Q1, três nas alternativas da Q2 e uma no enunciado da Q3). O gabarito correto é: **1-B, 2-A, 3-B, 4-C**. A Q4 apresenta fórmula matemática em LaTeX.

O arquivo `Q3_TAGFIGURAAQUI.png` usa a convenção de nomes dos marcadores, mas este exemplo a referencia com `\includegraphics{Q3_TAGFIGURAAQUI.png}` para também permitir a compilação com LaTeX. Para experimentar o marcador automático, **substitua apenas essa referência** por `TAGFIGURAAQUI` na Q3; o Injector localizará a imagem correspondente pelo nome e pelo número da questão. O marcador literal não é uma instrução de inclusão de figura para um compilador LaTeX tradicional.

## Como testar no Edge

1. Baixe este diretório mantendo a estrutura (ou clone o repositório). Se baixar um ZIP, **extraia primeiro**.
2. No Edge, abra a extensão e selecione **Selecionar pasta da prova (.tex + imagens)**. Escolha a pasta `prova_com_figuras`, não apenas o arquivo `.tex`.
3. Selecione `prova_exemplo.tex` caso haja um seletor e clique em **Analisar LaTeX**.
4. A prévia deve conter **4 questões**, gabarito **4/4** e **5 imagens vinculadas** sem pendências.
5. Configure uma prova nova de teste, confira disciplina, turma e datas, **mantenha DRY RUN** e clique em **Simular payload**. Isso não cria questões no portal.
6. Somente após conferir o resultado na prévia e estar autorizado, faça um teste real com avaliação não publicada e sem respostas.

> **Nunca selecione um ZIP compactado no seletor de pasta:** o navegador recebe uma árvore de arquivos já extraídos, não um pacote ZIP.

## Regras essenciais para outros modelos de linguagem

- O arquivo principal é UTF-8 com extensão `.tex`, seção `\noindent\textbf{MATEMÁTICA}` e questões em `\begin{enumerate} ... \item ...`. Cada questão objetiva contém suas alternativas em um `enumerate` interno.
- A resposta certa deve estar **explicitamente definida**, preferencialmente num comentário final: `% Gabarito Matemática:` seguido por `% 1-b, 2-a, 3-b, 4-c`, ou sinalizada com `\CorrectChoice`.
- Para **imagens reais**, use `\includegraphics[width=0.65\linewidth]{figuras/arquivo.png}` no enunciado; as alternativas também podem conter `\includegraphics{alternativas/opcao-a.png}` e assim por diante.
- Cada caminho relativo citado no `.tex` **precisa corresponder a um arquivo fornecido**. Não use figuras inexistentes, links fictícios nem apenas a descrição verbal de uma imagem.
- São aceitos pela importação local **PNG, JPEG, WEBP e GIF com assinatura de arquivo válida**; prefira PNG para gráficos e esquemas. Limites atuais: até **1,5 MB por imagem** e **3,5 MB no total de figuras codificadas em base64 por execução**.
- Não substitua imagens por comandos TikZ nem tabelas complexas esperando renderização equivalente: o Injector não oferece suporte completo a esses blocos.
- Em provas já criadas, **as disciplinas, cotas, turmas e datas são importadas da aplicação**. O `.tex` contém a ordem das questões; sua classificação nas disciplinas respeita a cota exibida no painel. Verifique semanticamente que cada faixa de questões corresponde de fato à disciplina indicada.
- O formato atual extrai **questões objetivas**, não itens discursivos para correção automática.

Para pedir a outro LLM um pacote análogo, use [o prompt reutilizável](../../docs/PROMPT_GERAR_PROVA_COMPATIVEL.md). Não reutilize tokens, sessões, HARs ou informações pessoais de alunos no material compartilhado.

## Checagem automática

Na raiz do repositório:

```sh
node --test tests/template-package.test.js
node --test tests/*.test.js
```

O primeiro comando confirma que as cinco imagens existem no Git e que o parser consegue vincular os caminhos às respectivas questões. O segundo inclui os testes de regressão do restante da extensão.
