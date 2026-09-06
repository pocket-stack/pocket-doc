import { expect, test } from "bun:test";
import { BTN } from "@pocketjs/framework/input";
import { BANKS, heldBank, moveCommand, moveListSelection } from "../app/commands.ts";

test("only L/R open menus and direction movement stays in its command grid", () => {
  expect(heldBank(BTN.LTRIGGER)).toBe("library");
  expect(heldBank(BTN.RTRIGGER)).toBe("document");
  expect(heldBank(BTN.ZL | BTN.ZR)).toBeUndefined();
  expect(moveCommand("library", 0, BTN.DOWN)).toBe(1);
  expect(moveCommand("library", 0, BTN.RIGHT)).toBe(0);
  expect(moveCommand("document", 2, BTN.RIGHT)).toBe(2);
  expect(moveCommand("document", 2, BTN.DOWN)).toBe(5);
  expect(moveCommand("document", 5, BTN.LEFT)).toBe(4);
  expect(moveCommand("document", 11, BTN.DOWN)).toBe(11);
  expect(BANKS.document.actions[6].action).toBe("undo");
  expect(BANKS.document.actions[7].action).toBe("redo");
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
