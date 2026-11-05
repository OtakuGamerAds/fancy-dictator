/**
 * A long dropdown list scrolls after 8 rows, with its scrollbar on the left and clearly
 * visible so it is obvious there is more. direction:rtl moves the scrollbar; the rows
 * switch back to ltr.
 */
export const SCROLL_LIST =
  "max-h-[234px] [direction:rtl] *:[direction:ltr] [&::-webkit-scrollbar-thumb]:bg-white/20 hover:[&::-webkit-scrollbar-thumb]:bg-white/30";
