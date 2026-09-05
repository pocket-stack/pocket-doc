import { expect, test } from "bun:test";
import { BTN } from "@pocketjs/framework/input";
import { BANKS, chordAction, heldBank, moveListSelection } from "../app/commands.ts";

test("four shoulder banks share their displayed and dispatched actions", () => {
  const shoulders = [BTN.LTRIGGER, BTN.RTRIGGER, BTN.ZL, BTN.ZR];
  const actions = new Set<string>();
  for (const button of shoulders) {
    const bank = heldBank(button)!;
    expect(chordAction(bank, button)).toBeUndefined();
    for (const item of BANKS[bank].actions) {
      expect(chordAction(bank, item.button)).toBe(item.action); actions.add(item.action);
    }
  }
  expect(actions.size).toBe(16);
  expect(heldBank(BTN.LTRIGGER | BTN.SELECT)).toBe("selection");
  expect(heldBank(BTN.RTRIGGER | BTN.SELECT)).toBe("view");
  expect(chordAction(undefined, BTN.CIRCLE)).toBeUndefined();
});

test("offscreen selection enters the current viewport before applying further movement", () => {
  for (const direction of [-1, 1]) {
    expect(moveListSelection(0, direction, 12000, 194, 1000)).toBe(500);
    expect(moveListSelection(999, direction, 12000, 194, 1000)).toBe(500);
  }
  expect(moveListSelection(503, 1, 12000, 194, 1000)).toBe(504);
  expect(moveListSelection(503, -1, 12000, 194, 1000)).toBe(502);
  expect(moveListSelection(0, -1, 0, 194, 1000)).toBe(0);
  expect(moveListSelection(999, 1, 23806, 194, 1000)).toBe(999);
  expect(moveListSelection(0, 1, 0, 194, 0)).toBe(0);
});
