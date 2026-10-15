/** Offline verification for the OpenAI membrane adapter. No network or paid API call. */
import assert from "node:assert/strict";
import { editOrganismMembrane, OpenAIImageError } from "../src/lib/openai/images";
import { decodePng, encodePng } from "../src/lib/imaging";

const input = encodePng({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    20, 30, 40, 0,
    50, 60, 70, 64,
    80, 90, 100, 192,
    110, 120, 130, 255,
  ]),
});
const responseImage = encodePng({
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    1, 2, 3, 255,
    4, 5, 6, 255,
    7, 8, 9, 255,
    10, 11, 12, 255,
  ]),
});
const base64 = btoa(String.fromCharCode(...responseImage));
let observedBody: unknown;
const previousKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "offline-test-key";

try {
  const result = await editOrganismMembrane(input, {
    fetchImpl: async (_url, init) => {
      observedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: [{ b64_json: base64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "req_offline" },
      });
    },
  });
  assert.equal(result.model, "gpt-image-2.5-flare");
  assert.equal(result.requestId, "req_offline");
  const body = observedBody as {
    model: string;
    images: Array<{ image_url: string }>;
    prompt: string;
    background: string;
    output_format: string;
    quality: string;
    size: string;
    n: number;
  };
  assert.equal(body.model, "gpt-image-2.5-flare");
  assert.match(body.images[0].image_url, /^data:image\/png;base64,/);
  assert.match(body.prompt, /Preserve the reference image's cell layout/);
  assert.equal(body.background, "opaque");
  assert.equal(body.output_format, "png");
  assert.equal(body.quality, "low");
  assert.equal(body.size, "1024x1024");
  assert.equal(body.n, 1);
  const output = decodePng(result.png);
  assert.deepEqual([...output.data], [1, 2, 3, 0, 4, 5, 6, 64, 7, 8, 9, 192, 10, 11, 12, 255]);

  await assert.rejects(
    () => editOrganismMembrane(input, {
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }),
    }),
    (error: unknown) => error instanceof OpenAIImageError && error.code === "quota",
  );
  console.log("OpenAI image adapter offline verification passed.");
} finally {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
}
