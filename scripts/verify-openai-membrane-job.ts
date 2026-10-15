/**
 * Offline compatibility coverage for the signed OpenAI membrane-job adapter.
 * No network calls and no OpenAI/Moth credentials are used.
 */
import assert from "node:assert/strict";
import { encodePng } from "../src/lib/imaging";
import { MothError } from "../src/lib/moth/errors";
import {
  openAIImageJobResult,
  openAIImageJobStatus,
  submitOpenAIImageJob,
} from "../src/lib/openai/membraneJob";
import { OpenAIImageError } from "../src/lib/openai/images";

const inputAsset = "11111111-1111-4111-8111-111111111111";
const outputAsset = "22222222-2222-4222-8222-222222222222";
const seed = encodePng({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    1, 2, 3, 255, 4, 5, 6, 255,
    7, 8, 9, 255, 10, 11, 12, 255,
  ]),
});
const membrane = encodePng({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    13, 14, 15, 255, 16, 17, 18, 255,
    19, 20, 21, 255, 22, 23, 24, 255,
  ]),
});

const saved = {
  mothKey: process.env.MOTH_API_KEY,
  mothBase: process.env.MOTH_API_BASE,
  openAIKey: process.env.OPENAI_API_KEY,
  receiptSecret: process.env.OPENAI_IMAGE_JOB_SECRET,
};
process.env.MOTH_API_KEY = "offline-moth-key";
process.env.MOTH_API_BASE = "https://atlas.test/api/v1";
process.env.OPENAI_API_KEY = "offline-openai-key";
process.env.OPENAI_IMAGE_JOB_SECRET = "0123456789abcdef0123456789abcdef";

let reads = 0;
let uploads = 0;
let edits = 0;
const atlas = {
  fetchAsset: async (assetId: string) => {
    assert.equal(assetId, inputAsset);
    reads++;
    return new Response(seed as unknown as BodyInit, { headers: { "content-length": String(seed.byteLength), "content-type": "image/png" } });
  },
  uploadAsset: async (bytes: Uint8Array, filename: string, contentType: string) => {
    uploads++;
    assert.deepEqual(bytes, membrane);
    assert.equal(filename, "openai-membrane.png");
    assert.equal(contentType, "image/png");
    return outputAsset;
  },
};

function request(key = "visitor-key"): Request {
  return new Request("http://localhost/api/moth/engines/tessa-image-v1/process", {
    headers: { Authorization: `Bearer ${key}` },
  });
}

function changedLastCharacter(text: string): string {
  const last = text.at(-1);
  return `${text.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

async function expectMothError(run: () => Promise<unknown>, status: number, type: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => (
    error instanceof MothError && error.status === status && error.type === type
  ));
}

try {
  const acknowledgement = await submitOpenAIImageJob(request(), inputAsset, atlas, {
    edit: async (bytes) => {
      edits++;
      assert.deepEqual(bytes, seed);
      return { png: membrane, model: "gpt-image-2.5-flare", requestId: "req_offline" };
    },
  });
  assert.equal(acknowledgement.status, "completed");
  assert.match(acknowledgement.job_id, /^oai1_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(reads, 1);
  assert.equal(edits, 1);
  assert.equal(uploads, 1);

  // The existing Tessa job consumer sees a completed job and ordinary PNG output.
  const status = await openAIImageJobStatus(request(), acknowledgement.job_id);
  assert.equal(status.engine_id, "tessa-image-v1");
  assert.equal(status.status, "completed");
  assert.deepEqual(status.outputs, [{
    slot: "result",
    content_type: "image/png",
    size_bytes: membrane.byteLength,
    output_asset_id: outputAsset,
    filename: "openai-membrane.png",
  }]);
  assert.deepEqual(status.result, { provider: "openai", model: "gpt-image-2.5-flare" });

  const result = await openAIImageJobResult(request(), acknowledgement.job_id);
  assert.deepEqual(result.outputs, status.outputs);
  assert.deepEqual(result.result, { provider: "openai", model: "gpt-image-2.5-flare", request_id: "req_offline" });
  assert.equal((await openAIImageJobStatus(request(), acknowledgement.job_id)).status, "completed", "the same server secret validates receipts across calls");

  await expectMothError(
    () => openAIImageJobStatus(request(), changedLastCharacter(acknowledgement.job_id)),
    404,
    "openai_job_not_found",
  );
  await expectMothError(
    () => openAIImageJobResult(request("other-visitor-key"), acknowledgement.job_id),
    404,
    "openai_job_not_found",
  );

  // A provider failure makes exactly one edit attempt; callers must explicitly retry a paid image edit.
  let failedEdits = 0;
  await expectMothError(
    () => submitOpenAIImageJob(request(), inputAsset, atlas, {
      edit: async () => {
        failedEdits++;
        throw new OpenAIImageError("rate_limit", "OpenAI image generation is temporarily rate limited.");
      },
    }),
    429,
    "openai_image_rate_limit",
  );
  assert.equal(failedEdits, 1);

  const realNow = Date.now;
  try {
    Date.now = () => 0;
    const expired = await submitOpenAIImageJob(request(), inputAsset, atlas, {
      edit: async () => ({ png: membrane, model: "gpt-image-2.5-flare" }),
    });
    Date.now = () => 8 * 24 * 60 * 60_000;
    await expectMothError(() => openAIImageJobStatus(request(), expired.job_id), 410, "openai_job_expired");
  } finally {
    Date.now = realNow;
  }

  console.log("PASS OpenAI membrane job: completed compatibility, receipt scope/tamper protection, one paid attempt, and expiry.");
} finally {
  if (saved.mothKey === undefined) delete process.env.MOTH_API_KEY;
  else process.env.MOTH_API_KEY = saved.mothKey;
  if (saved.mothBase === undefined) delete process.env.MOTH_API_BASE;
  else process.env.MOTH_API_BASE = saved.mothBase;
  if (saved.openAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved.openAIKey;
  if (saved.receiptSecret === undefined) delete process.env.OPENAI_IMAGE_JOB_SECRET;
  else process.env.OPENAI_IMAGE_JOB_SECRET = saved.receiptSecret;
}
