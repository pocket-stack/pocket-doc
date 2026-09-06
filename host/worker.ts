declare const self: { onmessage: (event: MessageEvent) => void; postMessage(value: unknown): void };
import { Library } from "./library.ts";
import { dispatchOffload } from "@pocketjs/framework/offload/provider";
let library: Library;
self.onmessage = async (event: MessageEvent) => {
  if (event.data.init) { library = new Library(event.data.init.root); library.index(); return; }
  self.postMessage(await dispatchOffload(library.methods(), event.data));
};
