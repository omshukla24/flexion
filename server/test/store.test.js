import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/store.js";

const at = (min) => new Date(Date.UTC(2026, 9, 20, 10, min)).toISOString();

/** One behaviour suite for every backend ; the AWS backend joins it with mocked clients. */
function storeSuite(name, makeStore) {
  describe(`store (${name})`, () => {
    let store, cleanup;
    before(async () => ({ store, cleanup } = await makeStore()));
    after(() => cleanup());

    test("saves sessions and lists them newest first", async () => {
      await store.saveSession("om", "right", { ts: at(1), fist: 0.19 });
      await store.saveSession("om", "right", { ts: at(3), fist: 0.17 });
      await store.saveSession("om", "right", { ts: at(2), fist: 0.18 });
      const list = await store.listSessions("om", "right");
      assert.deepEqual(list.map((s) => s.ts), [at(3), at(2), at(1)]);
    });

    test("keeps hands and users apart", async () => {
      await store.saveSession("om", "left", { ts: at(5), fist: 0.3 });
      await store.saveSession("mom", "right", { ts: at(5), fist: 0.4 });
      assert.equal((await store.listSessions("om", "left")).length, 1);
      assert.equal((await store.listSessions("mom", "right")).length, 1);
      assert.equal((await store.listSessions("om", "right")).length, 3);
    });

    test("filters by sinceTs and never returns more than 100", async () => {
      assert.deepEqual((await store.listSessions("om", "right", { sinceTs: at(2) })).map((s) => s.ts), [at(3), at(2)]);
      for (let i = 0; i < 105; i++) await store.saveSession("bulk", "right", { ts: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() });
      assert.equal((await store.listSessions("bulk", "right", { limit: 1000 })).length, 100);
      assert.equal((await store.listSessions("bulk", "right", { limit: 5 })).length, 5);
    });

    test("stamps a session with the current time when it has none", async () => {
      const saved = await store.saveSession("stamp", "right", { fist: 0.2 });
      assert.ok(Date.parse(saved.ts) > Date.now() - 60_000);
    });

    test("saves and reads a routine; unknown user has none", async () => {
      await store.saveRoutine("om", { exercises: [{ id: "fist", reps: 10 }] });
      assert.deepEqual(await store.getRoutine("om"), { exercises: [{ id: "fist", reps: 10 }] });
      assert.equal(await store.getRoutine("nobody"), null);
    });

    test("returns copies: changing a result does not change what is stored", async () => {
      const [first] = await store.listSessions("om", "right");
      first.fist = 999;
      assert.notEqual((await store.listSessions("om", "right"))[0].fist, 999);
    });

    test("rejects unsafe user ids and hands", async () => {
      for (const id of ["../evil", "", "a".repeat(65), "a/b"]) await assert.rejects(store.listSessions(id, "right"), /user id/i, id);
      await assert.rejects(store.saveSession("om", "middle", {}), /hand/i);
    });

    test("stores blobs under the user and refuses path tricks", async () => {
      const blob = await store.putBlob("om", "reports/week-43.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");
      assert.equal(blob.key, "users/om/reports/week-43.pdf");
      assert.ok(blob.url);
      await assert.rejects(store.putBlob("om", "../../x.pdf", new Uint8Array([1]), "application/pdf"), /key/i);
    });

    test("getBlob returns stored bytes, null when missing, and refuses bad keys", async () => {
      assert.deepEqual([...await store.getBlob("om", "reports/week-43.pdf")], [37, 80, 68, 70]);
      assert.equal(await store.getBlob("om", "reports/nope.pdf"), null);
      await assert.rejects(store.getBlob("om", "../x.pdf"), /key/i);
    });

    test("deleteUser removes sessions, routine and blobs", async () => {
      await store.deleteUser("om");
      assert.equal((await store.listSessions("om", "right")).length, 0);
      assert.equal(await store.getRoutine("om"), null);
      assert.equal((await store.listSessions("mom", "right")).length, 1, "other users untouched");
    });
  });
}

storeSuite("local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flexion-store-"));
  return { store: createStore({ backend: "local", dir }), cleanup: () => rm(dir, { recursive: true, force: true }) };
});

/** In-memory DynamoDB: only the calls the aws backend makes; pages of 40 so the backend's paging is exercised. */
function fakeDdb() {
  const items = new Map(); // "pk|sk" → item
  const PAGE = 40;
  return {
    items,
    async send(cmd) {
      const { input } = cmd, name = cmd.constructor.name;
      const k = (it) => `${it.pk.S}|${it.sk.S}`;
      if (name === "PutItemCommand") return items.set(k(input.Item), structuredClone(input.Item)), {};
      if (name === "GetItemCommand") return { Item: structuredClone(items.get(k(input.Key))) };
      if (name === "BatchWriteItemCommand") {
        for (const r of Object.values(input.RequestItems).flat()) items.delete(k(r.DeleteRequest.Key));
        return { UnprocessedItems: {} };
      }
      if (name === "QueryCommand") {
        const v = input.ExpressionAttributeValues;
        let rows = [...items.values()].filter((it) => it.pk.S === v[":pk"].S && (!v[":lo"] || (it.sk.S >= v[":lo"].S && it.sk.S <= v[":hi"].S)));
        rows.sort((a, b) => (a.sk.S < b.sk.S ? -1 : a.sk.S > b.sk.S ? 1 : 0)); // DynamoDB orders sort keys by bytes, not locale
        if (input.ScanIndexForward === false) rows.reverse();
        if (input.ExclusiveStartKey) rows = rows.slice(rows.findIndex((it) => k(it) === k(input.ExclusiveStartKey)) + 1);
        const n = Math.min(PAGE, input.Limit ?? Infinity), page = rows.slice(0, n);
        return { Items: structuredClone(page), LastEvaluatedKey: rows.length > n ? { pk: page.at(-1).pk, sk: page.at(-1).sk } : undefined };
      }
      throw new Error(`fake ddb: ${name} not handled`);
    },
  };
}

/** In-memory S3 for PutObject / GetObject / ListObjectsV2 / DeleteObjects. */
function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(cmd) {
      const { input } = cmd, name = cmd.constructor.name;
      if (name === "PutObjectCommand") return objects.set(input.Key, new Uint8Array(input.Body)), {};
      if (name === "GetObjectCommand") {
        if (!objects.has(input.Key)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        const bytes = objects.get(input.Key);
        return { Body: { transformToByteArray: async () => bytes } };
      }
      if (name === "ListObjectsV2Command") return { Contents: [...objects.keys()].filter((key) => key.startsWith(input.Prefix)).map((Key) => ({ Key })) };
      if (name === "DeleteObjectsCommand") return input.Delete.Objects.forEach((o) => objects.delete(o.Key)), {};
      throw new Error(`fake s3: ${name} not handled`);
    },
  };
}

storeSuite("aws, mocked clients", async () => ({
  store: createStore({ backend: "aws", ddb: fakeDdb(), s3: fakeS3(), table: "t", bucket: "b" }),
  cleanup: () => {},
}));

// The same suite against the real table and bucket: FLEXION_TEST_AWS=1 with FLEXION_TABLE and FLEXION_BUCKET set.
if (process.env.FLEXION_TEST_AWS === "1") {
  storeSuite("aws, live", async () => {
    const store = createStore({ backend: "aws" });
    const ids = ["om", "mom", "bulk", "stamp"];
    await Promise.all(ids.map((id) => store.deleteUser(id)));
    return { store, cleanup: () => Promise.all(ids.map((id) => store.deleteUser(id))) };
  });
}

test("aws backend: same-millisecond sessions both survive, and deleteUser empties table rows and bucket keys", async () => {
  const ddb = fakeDdb(), s3 = fakeS3();
  const store = createStore({ backend: "aws", ddb, s3, table: "t", bucket: "b" });
  await store.saveSession("twin", "right", { ts: at(1), fist: 0.1 });
  await store.saveSession("twin", "right", { ts: at(1), fist: 0.2 });
  assert.equal((await store.listSessions("twin", "right")).length, 2);
  await store.saveRoutine("twin", { exercises: [] });
  await store.putBlob("twin", "a.pdf", new Uint8Array([1]), "application/pdf");
  await store.deleteUser("twin");
  assert.equal([...ddb.items.keys()].filter((k) => k.startsWith("USER#twin|")).length, 0);
  assert.equal([...s3.objects.keys()].filter((k) => k.startsWith("users/twin/")).length, 0);
});

test("aws backend needs a table and a bucket", () => {
  assert.throws(() => createStore({ backend: "aws", ddb: fakeDdb(), s3: fakeS3(), table: "", bucket: "" }), /FLEXION_TABLE|FLEXION_BUCKET/);
});

test("local backend leaves no blobs behind after deleteUser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flexion-store-"));
  const store = createStore({ backend: "local", dir });
  await store.putBlob("gone", "a.pdf", new Uint8Array([1]), "application/pdf");
  await store.deleteUser("gone");
  const left = await readdir(join(dir, "blobs", "users")).catch(() => []);
  assert.ok(!left.includes("gone"));
  await rm(dir, { recursive: true, force: true });
});
