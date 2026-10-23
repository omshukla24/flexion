// Flexion persistence: sessions, routines and blobs behind one interface, on local JSON files or DynamoDB + S3.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

export const MAX_LIST = 100; // listSessions never returns more
const DEFAULT_DIR = fileURLToPath(new URL("../.data/", import.meta.url));
const UserId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const Hand = z.enum(["left", "right"]);
const BlobKey = z.string().max(200).regex(/^[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/).refine((k) => !k.split("/").some((s) => s === "." || s === ".."));

const check = (schema, value, what) => {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`invalid ${what}: ${JSON.stringify(value)}`);
  return r.data;
};
const copy = (x) => structuredClone(x);

/** One JSON file per user (sessions + routine) and a blobs/ tree; writes are serialised per user so concurrent saves can't drop data. */
function localBackend(dir) {
  const locks = new Map();
  const withLock = (id, fn) => {
    const next = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
    locks.set(id, next.catch(() => {}));
    return next;
  };
  const file = (id) => join(dir, `${id}.json`);
  const read = async (id) => {
    try {
      return JSON.parse(await readFile(file(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return { sessions: [], routine: null };
      throw e;
    }
  };
  const write = async (id, data) => {
    await mkdir(dir, { recursive: true });
    await writeFile(`${file(id)}.tmp`, JSON.stringify(data));
    await rename(`${file(id)}.tmp`, file(id)); // atomic swap: a crash mid-write never leaves half a file
  };
  const update = (id, fn) => withLock(id, async () => write(id, fn(await read(id))));
  return {
    addSession: (id, rec) => update(id, (d) => ({ ...d, sessions: [...d.sessions, rec] })),
    sessions: async (id) => (await read(id)).sessions,
    setRoutine: (id, routine) => update(id, (d) => ({ ...d, routine })),
    routine: async (id) => (await read(id)).routine,
    async putBlob(key, bytes) {
      const f = join(dir, "blobs", ...key.split("/"));
      await mkdir(dirname(f), { recursive: true });
      await writeFile(f, bytes);
      return pathToFileURL(f).href;
    },
    async getBlob(key) {
      try {
        return new Uint8Array(await readFile(join(dir, "blobs", ...key.split("/"))));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    deleteUser: (id) => withLock(id, async () => {
      await rm(file(id), { force: true });
      await rm(join(dir, "blobs", "users", id), { recursive: true, force: true });
    }),
  };
}

/** DynamoDB rows (pk USER#<id>; sk SESSION#<hand>#<ts>#<n> or ROUTINE; the record as a JSON string) and S3 objects under users/<id>/. */
function awsBackend({ ddb = new DynamoDBClient({}), s3 = new S3Client({}), table, bucket }) {
  if (!table || !bucket) throw new Error("the aws store needs FLEXION_TABLE and FLEXION_BUCKET");
  const pk = (id) => ({ S: `USER#${id}` });
  const put = (id, sk, value) => ddb.send(new PutItemCommand({ TableName: table, Item: { pk: pk(id), sk: { S: sk }, data: { S: JSON.stringify(value) } } }));
  /** Every row of one query (following LastEvaluatedKey), stopping once `max` rows are in. */
  const query = async (input, max = Infinity) => {
    const rows = [];
    let start;
    do {
      const left = Number.isFinite(max) ? max - rows.length : undefined;
      const r = await ddb.send(new QueryCommand({ TableName: table, ConsistentRead: true, ...input, Limit: left, ExclusiveStartKey: start }));
      rows.push(...r.Items);
      start = r.LastEvaluatedKey;
    } while (start && rows.length < max);
    return rows;
  };
  return {
    // the random tail keeps two sessions saved in the same millisecond from overwriting each other
    addSession: (id, rec) => put(id, `SESSION#${rec.hand}#${rec.ts}#${randomUUID().slice(0, 8)}`, rec),
    sessions: async (id, hand, sinceTs = "", n = MAX_LIST) => (await query({
      KeyConditionExpression: "pk = :pk AND sk BETWEEN :lo AND :hi",
      ExpressionAttributeValues: { ":pk": pk(id), ":lo": { S: `SESSION#${hand}#${sinceTs}` }, ":hi": { S: `SESSION#${hand}#~` } }, // "~" sorts after every ISO timestamp
      ScanIndexForward: false,
    }, n)).map((it) => JSON.parse(it.data.S)),
    setRoutine: (id, routine) => put(id, "ROUTINE", routine),
    async routine(id) {
      const r = await ddb.send(new GetItemCommand({ TableName: table, Key: { pk: pk(id), sk: { S: "ROUTINE" } }, ConsistentRead: true }));
      return r.Item ? JSON.parse(r.Item.data.S) : null;
    },
    async putBlob(key, bytes, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
      return `s3://${bucket}/${key}`;
    },
    async getBlob(key) {
      try {
        return await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToByteArray();
      } catch (e) {
        if (e.name === "NoSuchKey") return null;
        throw e;
      }
    },
    async deleteUser(id) {
      const rows = await query({ KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": pk(id) }, ProjectionExpression: "pk, sk" });
      for (let i = 0; i < rows.length; i += 25) { // BatchWriteItem takes 25 at most
        let req = { [table]: rows.slice(i, i + 25).map(({ pk, sk }) => ({ DeleteRequest: { Key: { pk, sk } } })) };
        while (Object.keys(req).length) req = (await ddb.send(new BatchWriteItemCommand({ RequestItems: req }))).UnprocessedItems ?? {};
      }
      let token;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `users/${id}/`, ContinuationToken: token }));
        if (page.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: page.Contents.map(({ Key }) => ({ Key })) } }));
        token = page.NextContinuationToken;
      } while (token);
    },
  };
}

const BACKENDS = { local: ({ dir }) => localBackend(dir), aws: awsBackend };

/** Store with the shared interface; every call validates its ids and returns fresh copies. AWS when FLEXION_TABLE and FLEXION_BUCKET are set. */
export function createStore({
  backend = process.env.FLEXION_TABLE && process.env.FLEXION_BUCKET ? "aws" : "local",
  dir = DEFAULT_DIR, ddb, s3, table = process.env.FLEXION_TABLE, bucket = process.env.FLEXION_BUCKET,
} = {}) {
  if (!BACKENDS[backend]) throw new Error(`unknown store backend "${backend}"`);
  const b = BACKENDS[backend]({ dir, ddb, s3, table, bucket });
  return {
    backend,
    async saveSession(userId, hand, session) {
      const id = check(UserId, userId, "user id"), h = check(Hand, hand, "hand");
      const rec = { ...copy(session), hand: h, ts: session.ts ?? new Date().toISOString() };
      await b.addSession(id, rec);
      return copy(rec);
    },
    async listSessions(userId, hand, { sinceTs, limit = MAX_LIST } = {}) {
      const id = check(UserId, userId, "user id"), h = check(Hand, hand, "hand");
      const n = Math.max(1, Math.min(MAX_LIST, limit));
      return (await b.sessions(id, h, sinceTs, n))
        .filter((s) => s.hand === h && (!sinceTs || s.ts >= sinceTs))
        .sort((a, c) => c.ts.localeCompare(a.ts))
        .slice(0, n)
        .map(copy);
    },
    async saveRoutine(userId, routine) {
      await b.setRoutine(check(UserId, userId, "user id"), copy(routine));
    },
    async getRoutine(userId) {
      const r = await b.routine(check(UserId, userId, "user id"));
      return r ? copy(r) : null;
    },
    async putBlob(userId, key, bytes, contentType) {
      const full = `users/${check(UserId, userId, "user id")}/${check(BlobKey, key, "blob key")}`;
      return { key: full, contentType, url: await b.putBlob(full, bytes, contentType) };
    },
    /** Stored bytes, or null when there is no such blob. */
    async getBlob(userId, key) {
      return b.getBlob(`users/${check(UserId, userId, "user id")}/${check(BlobKey, key, "blob key")}`);
    },
    async deleteUser(userId) {
      await b.deleteUser(check(UserId, userId, "user id"));
    },
  };
}
