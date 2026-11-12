# Prompt reutilizável para gerar provas compatíveis com E-Class Prova Injector

Copie o texto abaixo para qualquer modelo de linguagem capaz de produzir arquivos. Substitua os campos entre colchetes pelos dados da avaliação. Este é um **contrato de saída de arquivos**, não uma solicitação para o LLM interagir com o portal E-Class.

---

## Prompt para copiar

Você é um especialista em didática, elaboração de avaliações e LaTeX. Preciso de um **pacote de prova compatível com a importação por pasta do E-Class Prova Injector**, incluindo **todas as imagens reais referenciadas**, e não apenas um texto que cite imagens inexistentes.

**Parâmetros da prova**

- Componente curricular: [DISCIPLINA — por exemplo MATEMÁTICA]
- Série/ano: [SÉRIE]
- Unidade(s) e habilidades: [CONTEÚDOS E OBJETIVOS]
- Número de questões **objetivas**: [N]
- Número de alternativas por questão: [4 OU 5, sempre entre 2 e 5]
- Nível de dificuldade: [FÁCIL / INTERMEDIÁRIO / DIFÍCIL / MISTO]
- Contexto didático, se houver: [DESCRIÇÃO]
- Incluir pelo menos [K] questões com figuras, gráficos ou esquemas e ao menos [M] questão(ões) com figuras nas alternativas: [SIM/NÃO]
- Caso a prova existente tenha cotas por disciplina: [EX.: 15 DE MATEMÁTICA E 5 DE INVESTIGAÇÃO MATEMÁTICA], **organize as questões nessa mesma ordem** e inclua uma tabela resumida de distribuição no README. Se a ordem não for fornecida, **não a invente**.

**Contrato obrigatório de saída**

1. Crie uma pasta `MinhaProva/` com `prova.tex`, `README.md` e todas as imagens referenciadas, em subpastas `figuras/` e `alternativas/`. Quando possível, entregue um **ZIP com a pasta completa**; o usuário vai extraí-lo antes de selecionar a pasta no Edge.
2. O `prova.tex` deve ser UTF-8, com cabeçalho `\noindent\textbf{[DISCIPLINA]}` seguido por um `\begin{enumerate}` principal. Cada `\item` principal é uma questão; dentro dela, outro `\begin{enumerate}` contém as alternativas, cada uma começando por `\item`.
3. Use `\includegraphics[width=0.65\linewidth]{figuras/arquivo.png}` para figuras no enunciado. Figuras de alternativas usam caminhos como `\includegraphics[width=0.3\linewidth]{alternativas/opcao-a.png}`. Imagens precisam existir no pacote e seus caminhos relativos precisam ser exatos, considerando maiúsculas/minúsculas.
4. Gere **figuras de verdade**, preferencialmente PNG, com dados cientificamente corretos. Uma descrição do gráfico, um placeholder em texto, um arquivo vazio, uma URL fictícia ou uma imagem SVG com extensão `.png` **não atendem** ao pedido. Não dependa de TikZ ou de comandos que o Injector não renderiza.
5. Para cada questão, defina apenas uma alternativa correta. No final do `prova.tex`, escreva:
   `% Gabarito [DISCIPLINA]:`
   `% 1-b, 2-d, 3-a, ...`
   com números sequenciais e letras minúsculas `a` a `e`. As respostas devem corresponder às questões, gráficos e cálculos. Não deixe o gabarito como texto comum dentro de uma questão.
6. Todos os arquivos de figura devem ser PNG, JPEG, WEBP ou GIF verdadeiros, de até **1,5 MB cada**, e o total das figuras convertidas para base64 deve permanecer abaixo de **3,5 MB**. Evite nomes repetidos em subpastas e caminhos absolutos.
7. Inclua no `README.md` a árvore de diretórios, a contagem de questões/figuras, os assuntos, as respostas, uma tabela com as referências de figuras e instruções para selecionar **a pasta inteira** no Injector.
8. Valide localmente: todas as imagens referenciadas devem existir; todas as alternativas precisam ser extraíveis; não deve haver referências duplicadas ambíguas; o gabarito deve estar completo e coerente. Se conseguir, compile também o LaTeX e revise as ilustrações.
9. Se você não puder gerar ou anexar arquivos binários, **declare essa limitação** e forneça um script Python que produza as imagens PNG e organize a pasta/ZIP, com instruções verificáveis para executá-lo. **Não declare o pacote pronto** sem ter produzido os arquivos.
10. Não tente acessar o E-Class, não solicite ou inclua credenciais, tokens, HARs ou informações pessoais. O usuário fará a importação e a revisão no Edge. O backend pode rejeitar imagens em base64; portanto, não afirme que a publicação foi validada sem teste real.

**Critérios de aceitação**

- A pasta contém o `.tex` e **cada arquivo de imagem** citado.
- O Injector consegue analisar `N` questões, detectar `N` respostas e vincular automaticamente todas as referências.
- Todas as questões possuem exatamente uma alternativa correta e a resposta é justificada matematicamente no relatório de revisão (não nas questões).
- A ordem das questões atende às cotas por disciplina, caso fornecidas.
- O pacote permanece independente de caminhos locais, serviços externos e configurações privadas.
- Entregue também uma **lista de validação** no README, indicando o que foi realmente testado e o que não foi.

---

## Exemplo mínimo do formato

```tex
\documentclass{article}
\usepackage{graphicx}
\begin{document}
\noindent\textbf{MATEMÁTICA}

\begin{enumerate}
\item Observe o gráfico:
\includegraphics[width=0.6\linewidth]{figuras/grafico.png}

Qual classe apresenta a maior frequência?
\begin{enumerate}
  \item Classe A
  \item Classe B
  \item Classe C
  \item Classe D
\end{enumerate}
\end{enumerate}

% Gabarito Matemática:
% 1-b
\end{document}
```

O exemplo acima é **somente ilustrativo**: para usá-lo, o pacote deve conter também o arquivo verdadeiro `figuras/grafico.png`.

Veja um pacote funcional de referência em [`templates/prova_com_figuras/`](../templates/prova_com_figuras/README.md), com cinco PNGs versionados e `prova_exemplo.tex`. Para variações de marcadores `TAGFIGURAAQUI`, veja os exemplos na raiz do repositório.
