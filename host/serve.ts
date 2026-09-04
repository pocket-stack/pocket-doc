import { resolve } from "node:path";
import { connectOffloadProvider } from "@pocketjs/framework/offload/provider";
const address = process.argv[2] ?? "172.20.12.37";
const root = resolve(process.argv[3] ?? "data/library");
const key = (await Bun.file(".local/pair.key").text()).trim();
connectOffloadProvider({ address, key, worker: new URL("./worker.ts", import.meta.url), data: { root }, log: console.log });
console.log(`Pocket Folio provider: ${root} -> ${address}`);
