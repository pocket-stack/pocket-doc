import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../scripts/seed.ts";
import { connectOffloadProvider } from "../runtime/tools/offload-provider.ts";
import { OffloadDecoder, encodeOffloadRecord } from "../runtime/tools/offload-wire.ts";
test("TCP framing drives the actual SQLite/layout worker with a pairing key", async () => {
  const root = mkdtempSync(join(tmpdir(), "doc-wire-")); seed(root, 2);
  const key = randomBytes(32).toString("hex");
  let received = 0;
  let resolveResult!: (value: any) => void;
  const result = new Promise<any>(resolve => resolveResult = resolve);
  const server = createServer(socket => {
    let auth = Buffer.alloc(0); const decoder = new OffloadDecoder();
    socket.on("data", data => {
      const chunk = typeof data === "string" ? Buffer.from(data) : data;
      if (auth.length < 64) {
        auth = Buffer.concat([auth, chunk]);
        if (auth.length < 64) return;
        expect(auth.toString("utf8", 0, 64)).toBe(key);
        const request = encodeOffloadRecord(JSON.stringify({ v: 1, id: 1, method: "library.list", payload: '{"query":"","offset":0}' }));
        // Fragment both the header and the UTF-8 record across writes.
        socket.write(request.subarray(0, 2)); socket.write(request.subarray(2, 11)); socket.write(request.subarray(11));
        return;
      }
      decoder.push(chunk, raw => { received++; resolveResult(JSON.parse(raw)); });
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const provider = connectOffloadProvider({ address: "127.0.0.1", port, key, worker: new URL("../host/worker.ts", import.meta.url), data: { root } });
  try {
    const reply = await Promise.race([result, Bun.sleep(7000).then(() => { throw new Error("Worker transport timed out"); })]);
    expect(reply.id).toBe(1); expect(JSON.parse(reply.payload).total).toBe(2); expect(received).toBe(1);
  } finally { provider.close(); server.close(); rmSync(root, { recursive: true }); }
}, 10000);
