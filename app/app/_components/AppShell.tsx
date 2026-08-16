"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  /**
   * Gaveta do celular. Só existe abaixo de `md`; de `md` para cima a barra é
   * fixa e este estado não muda nada na tela.
   *
   * O DEFEITO que isto conserta (issue upstream #203): a barra era `w-60` fixa
   * com `ml-60` no conteúdo, sem NENHUM breakpoint. Num aparelho de 390px ela
   * comia 240px — 62% da tela — e sobravam 150px de conteúdo; o cabeçalho não
   * cabia e vazava 72px para fora. Não era "layout apertado": era um CRM que
   * não dava para usar no celular, que é justamente onde quem atende WhatsApp
   * está.
   */
  const [mobileAberto, setMobileAberto] = useState(false);
  const fechar = useCallback(() => setMobileAberto(false), []);
  const pathname = usePathname();

  // Fecha ao navegar. Sem isto, tocar num item do menu troca a página COM a
  // gaveta ainda por cima dela — o usuário chega no destino sem conseguir vê-lo
  // e precisa fechar na mão, toda vez.
  //
  // Este efeito é a REDE, não o mecanismo: ele cobre navegação que não nasce de
  // um clique na barra (redirect, botão dentro da página, voltar do navegador).
  // O fechamento no clique vive no `onNavegar` passado à Sidebar, e os dois são
  // necessários — depender só daqui deixa passar o caso de tocar no item da
  // tela em que você JÁ ESTÁ: o `pathname` não muda, o efeito não dispara, e a
  // gaveta fica aberta sem nada acontecer aos olhos de quem tocou. Medido: o
  // e2e de 2026-08-16 reprovou exatamente nesse passo.
  useEffect(() => {
    setMobileAberto(false);
  }, [pathname]);

  // Esc fecha. É o gesto que todo mundo tenta antes de procurar o botão, e sem
  // ele quem abriu a gaveta sem querer fica preso nela.
  useEffect(() => {
    if (!mobileAberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileAberto(false);
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [mobileAberto]);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar collapsed={sidebarCollapsed} mobileAberto={mobileAberto} onNavegar={fechar} />

      {/*
        Véu: fecha ao tocar fora, que é como gaveta se comporta em qualquer app.
        `md:hidden` porque no desktop não há gaveta para fechar. Fica em z-30,
        abaixo da barra (z-40) e acima do conteúdo.

        É um <button> e não uma <div> de propósito: fechar é uma AÇÃO, e numa
        div ela existiria só para quem usa mouse ou toque. Com button, o teclado
        alcança e o leitor de tela anuncia.
      */}
      {mobileAberto && (
        <button
          type="button"
          aria-label="Fechar o menu"
          onClick={fechar}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      {/*
        `min-w-0` é o que permite a coluna de conteúdo ENCOLHER. Um flex item
        nasce com `min-width: auto`, ou seja, nunca fica menor que o conteúdo —
        então qualquer bloco largo (uma fila de abas, uma tabela) empurrava a
        PÁGINA INTEIRA para o lado em vez de rolar dentro da própria caixa, e o
        conteúdo sumia sem nada indicando que existia.

        Medido em 390x844 no detalhe do agente, que tem seis abas: a página
        estourava 476px na horizontal; com esta classe, 212px — o que sobra é o
        cabeçalho, presente também em telas que não têm abas (a lista de agentes
        estoura 236px). Isolado ancestral por ancestral: é este o que decide.

        A MARGEM agora começa em ZERO e só existe de `md` para cima. Era ela —
        `ml-60` incondicional — que reservava 240px para uma barra que, no
        celular, virou gaveta flutuante e não ocupa mais espaço nenhum.
      */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-1 flex-col transition-[margin] duration-200",
          "ml-0",
          sidebarCollapsed ? "md:ml-16" : "md:ml-60",
        )}
      >
        <TopBar onAbrirMenu={() => setMobileAberto(true)} />
        {/*
          `p-6` virava 24px de folga de cada lado num conteúdo que já estava
          espremido. `p-4` no celular devolve 16px úteis, e de `sm` para cima
          nada muda em relação ao que existia.
        */}
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
