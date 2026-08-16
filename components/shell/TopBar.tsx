"use client";
import { MenuHamburguer } from "@/lib/ui/icons";
import { AlertsBell } from "./AlertsBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

/**
 * `onAbrirMenu` só é usado abaixo de `md`: é a única porta para a navegação
 * quando a barra lateral vira gaveta. Sem ele, quem abre o CRM no celular fica
 * sem menu nenhum — trocaríamos "menu ocupa a tela toda" por "não há menu", que
 * é pior.
 */
export function TopBar({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  return (
    // `px-4` no celular (era `px-6` fixo): 16px de cada lado em vez de 24px.
    // Numa faixa de 390px, os 16px devolvidos são a diferença entre o grupo da
    // direita caber e vazar.
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onAbrirMenu}
          aria-label="Abrir o menu"
          className="-ml-1 shrink-0 rounded-md p-2 hover:bg-accent md:hidden"
        >
          <MenuHamburguer size={20} aria-hidden />
        </button>
        {/*
          `min-w-0` no pai + este wrapper: o seletor de organização tem nome de
          tamanho livre (o do revendedor, o da imobiliária) e sem isto ele empurra
          a barra inteira, que foi uma das causas medidas do vazamento de 72px.
        */}
        <div className="min-w-0">
          <TenantSwitcher />
        </div>
      </div>

      {/*
        A busca SOME abaixo de `sm` e não encolhe. Num campo de 390px ela ficaria
        ilegível e ainda disputaria espaço com o que não tem substituto (menu,
        alertas, conta). Ela continua alcançável pelo atalho de teclado e volta
        inteira a partir de `sm`.
      */}
      <div className="hidden flex-1 justify-center sm:flex md:max-w-md">
        <SearchTrigger />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <AlertsBell />
        <UserMenu />
      </div>
    </header>
  );
}
