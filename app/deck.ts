/** One spacing grid for the 320x240 auxiliary screen in both modes. */
export const DECK = { width: 320, height: 240, gap: 6, bar: 28, keysTop: 30, keyPitch: 22, keyHeight: 20, fileWidth: 108 } as const;
export const keyboardBottom = DECK.keysTop + 3 * DECK.keyPitch + DECK.keyHeight;
export function deckLayout(typing: boolean) {
  const y = (typing ? keyboardBottom : DECK.bar) + DECK.gap;
  const right = DECK.gap * 2 + DECK.fileWidth;
  return { left: DECK.gap, leftWidth: DECK.fileWidth, right, rightWidth: DECK.width - DECK.gap - right,
    y, height: DECK.height - DECK.gap - y };
}
