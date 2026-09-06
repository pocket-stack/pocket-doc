export const ROW_SLOTS = 12;
/** A row stays in its physical slot until it leaves the window. */
export const slotRow = (first: number, slot: number) => first + (slot - first % ROW_SLOTS + ROW_SLOTS) % ROW_SLOTS;
