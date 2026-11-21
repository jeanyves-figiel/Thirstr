// R-08.12 tray selection: tap order, tap again removes, max 10.
import type { Source } from './media';

export const MAX_PICK = 10;
export type Pick = { key: string; src: Source };

export function toggle(sel: Pick[], p: Pick, max = MAX_PICK): Pick[] {
  if (sel.some((s) => s.key === p.key)) return sel.filter((s) => s.key !== p.key);
  return sel.length >= max ? sel : [...sel, p];
}

// #222: a sheet opened from the tray (album name) brings up the keyboard. The chat closes the
// tray when the keyboard shows (it takes the keyboard slot), which unmounted that sheet mid-typing.
// While a tray sheet with a text field is open, the keyboard must not close the tray.
let held = 0;
export function holdTray(on: boolean) {
  held = Math.max(0, held + (on ? 1 : -1));
}
/** Called on keyboardDidShow: close the tray unless one of its own sheets is typing. */
export const keyboardClosesTray = () => held === 0;
