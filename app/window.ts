import { createSignal } from "solid-js";

export const ROW_SLOTS = 12;
/** A row stays in its physical slot until it leaves the window. */
export const slotRow = (first: number, slot: number) => first + (slot - first % ROW_SLOTS + ROW_SLOTS) % ROW_SLOTS;

/** Fixed notification lanes match the mounted row slots, independent of cache size. */
export function createRowChanges() {
  const lanes = Array.from({ length: ROW_SLOTS }, () => createSignal(0));
  return {
    read: (row: number) => lanes[row % ROW_SLOTS][0](),
    notify: (row: number) => lanes[row % ROW_SLOTS][1](n => n + 1),
    clear: () => { for (const [, set] of lanes) set(n => n + 1); },
  };
}
