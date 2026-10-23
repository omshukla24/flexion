// One idempotent deploy: the store's DynamoDB table + S3 bucket, the MCP server on Lambda (Web Adapter) behind a
// public Function URL (kept warm by a 4-minute EventBridge ping), the site on Amplify Hosting, and a $10/month budget alarm.
// Re-run it after any fix.
// Usage (from server/): node scripts/deploy.mjs            → prints the plan, creates nothing
//                       node scripts/deploy.mjs --yes      → creates or updates everything
//                       node scripts/deploy.mjs --yes --server-only | --site-only
// Env: AWS credentials from `aws configure`; AWS_REGION (default us-east-1); BUDGET_EMAIL (who gets the budget alarm; no budget without it);
//      FLEXION_SIGLIP_MODEL (local path of SigLIP's vision_model_quantized.onnx, uploaded for identify when the bucket lacks it).
// Uses the AWS CLI rather than SDK clients, so the deploy adds no npm packages.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { MODEL_KEY } from "../src/identify.js";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const SERVER = fileURLToPath(new URL("..", import.meta.url));
const SITE = fileURLToPath(new URL("../../site/", import.meta.url));
const FN = "flexion-mcp", ROLE = "flexion-mcp-lambda", TABLE = "flexion", SITE_TAG = "flexion-site", BUDGET = "flexion-10usd", WARM = "flexion-keep-warm";
const ADAPTER = `arn:aws:lambda:${REGION}:753240598075:layer:LambdaAdapterLayerX86:30`; // AWS Lambda Web Adapter (README, 2026-10)
const args = new Set(process.argv.slice(2));
let tmp; // made on first write, so importing zip() for tests leaves nothing behind

/** AWS CLI call → parsed JSON ({} when it prints nothing). */
function aws(...a) {
  const out = execFileSync("aws", [...a, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  return out.trim() ? JSON.parse(out) : {};
}
/** Same, but null when the thing doesn't exist. */
function find(...a) {
  try {
    return aws(...a);
  } catch (e) {
    if (/NotFound|NoSuch|does not exist|\(404\)|Not Found/i.test(e.stderr ?? "")) return null;
    throw e;
  }
}
/** Bytes written to the temp folder; returns the path. */
function write(name, data) {
  tmp ??= mkdtempSync(join(tmpdir(), "flexion-deploy-"));
  const p = join(tmp, name);
  writeFileSync(p, data);
  return p;
}
/** A value as a `file://` JSON argument (avoids Windows quoting of inline JSON). */
const file = (name, value) => `file://${write(name, JSON.stringify(value))}`;
const step = (msg) => console.log(`\n▸ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A zip with Unix modes: Lambda runs run.sh only if the zip marks it executable, and Windows zip tools don't. */
export function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const { name, data, mode = 0o644 } of entries) {
    const packed = deflateRawSync(data), crc = crc32(data), n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode below is read
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, n, packed);
    central.push(dir, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** Files under `root/dir`, as zip names with forward slashes. */
const filesIn = (root, dir) => readdirSync(join(root, dir), { recursive: true })
  .map((f) => join(dir, f))
  .filter((f) => statSync(join(root, f)).isFile())
  .map((f) => f.split(sep).join("/"));

// onnxruntime-node ships builds for six platforms (165 MB); Lambda runs linux/x64 only.
const ORT_BIN = "node_modules/onnxruntime-node/bin/napi-v3/";
export const forLambda = (name) => !name.startsWith(ORT_BIN) || name.startsWith(`${ORT_BIN}linux/x64/`);

function lambdaZip() {
  const names = ["package.json", ...["src", "app", "host", "node_modules"].flatMap((d) => filesIn(SERVER, d))].filter(forLambda);
  const run = "#!/bin/bash\n# Lambda Web Adapter starts the unchanged Node server and proxies Function URL requests to it\nexec node \"$LAMBDA_TASK_ROOT/src/server.js\"\n";
  return zip([...names.map((name) => ({ name, data: readFileSync(join(SERVER, name)) })), { name: "run.sh", data: Buffer.from(run), mode: 0o755 }]);
}

async function ensureTable() {
  step(`DynamoDB table ${TABLE}`);
  if (find("dynamodb", "describe-table", "--table-name", TABLE)) return console.log("  exists");
  aws("dynamodb", "create-table", "--table-name", TABLE, "--billing-mode", "PAY_PER_REQUEST",
    "--attribute-definitions", "AttributeName=pk,AttributeType=S", "AttributeName=sk,AttributeType=S",
    "--key-schema", "AttributeName=pk,KeyType=HASH", "AttributeName=sk,KeyType=RANGE");
  aws("dynamodb", "wait", "table-exists", "--table-name", TABLE);
  console.log("  created (on-demand)");
}

/** SigLIP's image encoder in the data bucket, where identify.js loads it; uploaded when missing or a different size. */
function ensureModel(dataBucket) {
  step(`identify model s3://${dataBucket}/${MODEL_KEY}`);
  const local = process.env.FLEXION_SIGLIP_MODEL;
  const remote = find("s3api", "head-object", "--bucket", dataBucket, "--key", MODEL_KEY);
  if (local && remote?.ContentLength !== statSync(local).size) {
    execFileSync("aws", ["s3", "cp", local, `s3://${dataBucket}/${MODEL_KEY}`, "--region", REGION, "--only-show-errors"], { stdio: "inherit" });
    return console.log(`  uploaded (${(statSync(local).size / 1e6).toFixed(1)} MB)`);
  }
  console.log(remote ? "  exists" : "  missing: set FLEXION_SIGLIP_MODEL to upload it; until then identify answers \"unavailable\"");
}

function ensureBucket(name) {
  step(`S3 bucket ${name}`);
  if (find("s3api", "head-bucket", "--bucket", name)) return console.log("  exists");
  aws("s3api", "create-bucket", "--bucket", name); // new buckets block public access and encrypt by default
  console.log("  created (private)");
}

async function ensureRole(account, dataBucket) {
  step(`IAM role ${ROLE}`);
  let role = find("iam", "get-role", "--role-name", ROLE)?.Role;
  if (!role) {
    role = aws("iam", "create-role", "--role-name", ROLE, "--assume-role-policy-document", file("trust.json", {
      Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
    })).Role;
    console.log("  created");
  } else console.log("  exists");
  // Least privilege: its own logs, the one table, the one bucket (users' files; the identify model read-only), Nova 2 Sonic (the simulator's voice), and Nova for when Bedrock opens.
  aws("iam", "put-role-policy", "--role-name", ROLE, "--policy-name", "flexion", "--policy-document", file("policy.json", {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource: `arn:aws:logs:${REGION}:${account}:log-group:/aws/lambda/${FN}:*` },
      { Effect: "Allow", Action: ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:BatchWriteItem"], Resource: `arn:aws:dynamodb:${REGION}:${account}:table/${TABLE}` },
      { Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: `arn:aws:s3:::${dataBucket}/users/*` },
      { Effect: "Allow", Action: "s3:GetObject", Resource: `arn:aws:s3:::${dataBucket}/models/*` },
      { Effect: "Allow", Action: "s3:ListBucket", Resource: `arn:aws:s3:::${dataBucket}` },
      { Effect: "Allow", Action: "bedrock:InvokeModel", Resource: ["arn:aws:bedrock:*::foundation-model/amazon.nova-*", `arn:aws:bedrock:*:${account}:inference-profile/*.amazon.nova-*`] },
      { Effect: "Allow", Action: "bedrock:InvokeModelWithBidirectionalStream", Resource: `arn:aws:bedrock:${REGION}::foundation-model/amazon.nova-2-sonic-v1:0` },
    ],
  }));
  return role.Arn;
}

async function ensureFunction(roleArn, dataBucket) {
  step(`Lambda ${FN} (Node 22, Web Adapter, Function URL)`);
  const code = `fileb://${write("lambda.zip", lambdaZip())}`;
  const size = statSync(code.slice("fileb://".length)).size;
  console.log(`  package ${(size / 1e6).toFixed(1)} MB`);
  if (size > 50 * 2 ** 20) throw new Error("the package is over Lambda's 50 MB direct-upload limit"); // then: upload it to S3 first
  // The site (Amplify, another origin) calls /api/voice when a visitor talks back to the coach, so its hostname is allowed too.
  const site = aws("amplify", "list-apps").apps.find((a) => a.name === SITE_TAG);
  const siteHost = site ? `main.${site.defaultDomain}` : null;
  const env = (url) => file("env.json", { Variables: {
    AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap", PORT: "8080", AWS_LWA_READINESS_CHECK_PATH: "/healthz",
    AWS_LWA_PASS_THROUGH_PATH: "/healthz", // non-HTTP events (the keep-warm ping) land on /healthz instead of a 404 at /events
    FLEXION_TABLE: TABLE, FLEXION_BUCKET: dataBucket,
    ...(url && { PUBLIC_URL: url.origin, ALLOWED_HOSTS: [url.hostname, siteHost].filter(Boolean).join(",") }),
  } });
  const conf = ["--runtime", "nodejs22.x", "--handler", "run.sh", "--timeout", "30", "--memory-size", "2048", "--layers", ADAPTER];
  if (!find("lambda", "get-function", "--function-name", FN)) {
    for (let i = 0; ; i++) { // a brand-new role takes a few seconds before Lambda can assume it
      try {
        aws("lambda", "create-function", "--function-name", FN, "--role", roleArn, "--zip-file", code, "--environment", env(), "--architectures", "x86_64", ...conf);
        break;
      } catch (e) {
        if (i > 8 || !/cannot be assumed/i.test(e.stderr ?? "")) throw e;
        await sleep(5000);
      }
    }
    aws("lambda", "wait", "function-active-v2", "--function-name", FN);
    console.log("  created");
  } else {
    aws("lambda", "update-function-code", "--function-name", FN, "--zip-file", code);
    aws("lambda", "wait", "function-updated-v2", "--function-name", FN);
    console.log("  code updated");
  }
  let urlConf = find("lambda", "get-function-url-config", "--function-name", FN);
  if (!urlConf) {
    urlConf = aws("lambda", "create-function-url-config", "--function-name", FN, "--auth-type", "NONE", "--invoke-mode", "BUFFERED");
    // Public URLs need both permissions since Oct 2025; the second is limited to calls that come through the URL.
    aws("lambda", "add-permission", "--function-name", FN, "--statement-id", "public-url", "--action", "lambda:InvokeFunctionUrl", "--principal", "*", "--function-url-auth-type", "NONE");
    aws("lambda", "add-permission", "--function-name", FN, "--statement-id", "public-url-invoke", "--action", "lambda:InvokeFunction", "--principal", "*", "--invoked-via-function-url");
  }
  const url = new URL(urlConf.FunctionUrl);
  aws("lambda", "update-function-configuration", "--function-name", FN, "--role", roleArn, "--environment", env(url), ...conf);
  aws("lambda", "wait", "function-updated-v2", "--function-name", FN);
  console.log(`  ${url.origin}/mcp`);
  return url;
}

/** A cold start adds ~2 s (1.1 s init + unpacking the zip) to Alexa's 3 s budget; a ping every 4 minutes keeps one instance warm (with identify's model, once loaded). */
function ensureKeepWarm(account) {
  step(`EventBridge rule ${WARM} (pings ${FN} every 4 minutes)`);
  const rule = aws("events", "put-rule", "--name", WARM, "--schedule-expression", "rate(4 minutes)").RuleArn;
  try {
    aws("lambda", "add-permission", "--function-name", FN, "--statement-id", WARM, "--action", "lambda:InvokeFunction", "--principal", "events.amazonaws.com", "--source-arn", rule);
  } catch (e) {
    if (!/ResourceConflict/.test(e.stderr ?? "")) throw e; // granted on an earlier run
  }
  aws("events", "put-targets", "--rule", WARM, "--targets", `Id=${FN},Arn=arn:aws:lambda:${REGION}:${account}:function:${FN}`);
  console.log("  on");
}

function buildSite() {
  step("site build (vite)");
  execSync("npm run build", { cwd: SITE, stdio: "inherit" });
}

/** The site on Amplify Hosting (HTTPS + CDN). CloudFront itself is closed to this account until AWS finishes its verification. */
async function ensureAmplify() {
  step(`Amplify Hosting app ${SITE_TAG}`);
  const found = aws("amplify", "list-apps").apps.find((a) => a.name === SITE_TAG);
  // Unknown paths get the site's own 404 page with a real 404 status ("404-200" would answer 200).
  const app = aws("amplify", found ? "update-app" : "create-app", ...(found ? ["--app-id", found.appId] : ["--name", SITE_TAG, "--platform", "WEB"]),
    "--custom-rules", file("rules.json", [{ source: "/<*>", target: "/404.html", status: "404" }])).app;
  if (!find("amplify", "get-branch", "--app-id", app.appId, "--branch-name", "main")) aws("amplify", "create-branch", "--app-id", app.appId, "--branch-name", "main");
  const dist = join(SITE, "dist");
  const body = zip(filesIn(dist, ".").map((name) => ({ name, data: readFileSync(join(dist, name)) })));
  const { jobId, zipUploadUrl } = aws("amplify", "create-deployment", "--app-id", app.appId, "--branch-name", "main");
  const put = await fetch(zipUploadUrl, { method: "PUT", body });
  if (!put.ok) throw new Error(`site zip upload: HTTP ${put.status}`);
  aws("amplify", "start-deployment", "--app-id", app.appId, "--branch-name", "main", "--job-id", jobId);
  let status;
  while ((status = aws("amplify", "get-job", "--app-id", app.appId, "--branch-name", "main", "--job-id", jobId).job.summary.status) !== "SUCCEED") {
    if (["FAILED", "CANCELLED"].includes(status)) throw new Error(`Amplify deployment ${jobId}: ${status}`);
    await sleep(3000);
  }
  console.log(`  https://main.${app.defaultDomain}/`);
}

function ensureBudget(account) {
  step(`budget ${BUDGET} ($10/month)`);
  if (!process.env.BUDGET_EMAIL) return console.log("  skipped: set BUDGET_EMAIL");
  if (find("budgets", "describe-budget", "--account-id", account, "--budget-name", BUDGET)) return console.log("  exists");
  const to = [{ SubscriptionType: "EMAIL", Address: process.env.BUDGET_EMAIL }];
  aws("budgets", "create-budget", "--account-id", account,
    "--budget", file("budget.json", { BudgetName: BUDGET, BudgetLimit: { Amount: "10", Unit: "USD" }, TimeUnit: "MONTHLY", BudgetType: "COST" }),
    "--notifications-with-subscribers", file("notify.json", [
      { Notification: { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold: 50, ThresholdType: "PERCENTAGE" }, Subscribers: to },
      { Notification: { NotificationType: "FORECASTED", ComparisonOperator: "GREATER_THAN", Threshold: 100, ThresholdType: "PERCENTAGE" }, Subscribers: to },
    ]));
  console.log("  created: email at $5 actual and at $10 forecast");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { Account: account } = aws("sts", "get-caller-identity");
  const dataBucket = `flexion-data-${account}`;
  const server = !args.has("--site-only"), site = !args.has("--server-only");
  if (!args.has("--yes")) {
    console.log(`Plan for account ${account}, ${REGION} (nothing is created without --yes):`);
    if (server) console.log(`  DynamoDB ${TABLE} (on-demand) · S3 ${dataBucket} (+ identify model ${MODEL_KEY}${process.env.FLEXION_SIGLIP_MODEL ? "" : ": FLEXION_SIGLIP_MODEL not set"}) · IAM role ${ROLE} (+ Nova 2 Sonic stream) · Lambda ${FN} 2048 MB + Web Adapter + public Function URL · EventBridge ${WARM} (every 4 min)`);
    if (site) console.log(`  Amplify Hosting app ${SITE_TAG} (branch main) · budget ${BUDGET} → ${process.env.BUDGET_EMAIL ?? "(no BUDGET_EMAIL: skipped)"}`);
    process.exit(0);
  }
  if (server) {
    await ensureTable();
    ensureBucket(dataBucket);
    ensureModel(dataBucket);
    const url = await ensureFunction(await ensureRole(account, dataBucket), dataBucket);
    ensureKeepWarm(account);
    step("smoke");
    console.log(`  GET /healthz → ${(await fetch(new URL("/healthz", url))).status}`);
  }
  if (site) {
    buildSite();
    await ensureAmplify();
    ensureBudget(account);
  }
}
