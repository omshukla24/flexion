import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { forLambda, zip } from "../scripts/deploy.mjs";

/** Reads a zip back through its central directory: name, Unix mode and inflated bytes per entry. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const out = [];
  for (let i = 0, p = buf.readUInt32LE(end + 16); i < buf.readUInt16LE(end + 10); i++) {
    const nameLen = buf.readUInt16LE(p + 28), size = buf.readUInt32LE(p + 20), at = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const data = inflateRawSync(buf.subarray(at + 30 + buf.readUInt16LE(at + 26), at + 30 + buf.readUInt16LE(at + 26) + size));
    out.push({ name, mode: (buf.readUInt32LE(p + 38) >>> 16) & 0o777, data: data.toString() });
    p += 46 + nameLen;
  }
  return out;
}

test("zip keeps names, bytes and Unix modes (run.sh must be executable on Lambda)", () => {
  const entries = [{ name: "src/a.js", data: Buffer.from("export const a = 1;\n".repeat(50)) }, { name: "run.sh", data: Buffer.from("#!/bin/bash\n"), mode: 0o755 }];
  assert.deepEqual(unzip(zip(entries)), [
    { name: "src/a.js", mode: 0o644, data: "export const a = 1;\n".repeat(50) },
    { name: "run.sh", mode: 0o755, data: "#!/bin/bash\n" },
  ]);
});

test("the Lambda package keeps onnxruntime's linux/x64 build only, and everything else", () => {
  const bin = "node_modules/onnxruntime-node/bin/napi-v3/";
  assert.equal(forLambda(`${bin}linux/x64/libonnxruntime.so.1.21.0`), true);
  assert.equal(forLambda(`${bin}linux/x64/onnxruntime_binding.node`), true);
  for (const other of ["linux/arm64/libonnxruntime.so.1", "win32/x64/onnxruntime.dll", "darwin/arm64/onnxruntime_binding.node"]) assert.equal(forLambda(bin + other), false, other);
  assert.equal(forLambda("node_modules/onnxruntime-node/dist/index.js"), true);
  assert.equal(forLambda("src/server.js"), true);
});
