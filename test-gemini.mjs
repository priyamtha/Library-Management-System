import test from "node:test";
import assert from "node:assert/strict";
import { generateGeminiRecommendation } from "./netlify/gemini.mjs";

test("Gemini request uses server credentials, the configured model, and contextual chat content", async () => {
  let clientOptions;
  let generationOptions;
  const answer = await generateGeminiRecommendation({
    apiKey: "server-only-test-key",
    model: "gemini-3.5-flash-lite",
    history: [{ role: "user", parts: [{ text: "I like literary fiction." }] }],
    prompt: "Catalog: [book data]. Current question: Recommend a book.",
  }, (apiKey) => {
    clientOptions = apiKey;
    return {
      models: {
        async generateContent(options) {
          generationOptions = options;
          return { text: "Try a title from the library." };
        },
      },
    };
  });

  assert.equal(clientOptions, "server-only-test-key");
  assert.equal(answer, "Try a title from the library.");
  assert.equal(generationOptions.model, "gemini-3.5-flash-lite");
  assert.equal(generationOptions.contents.length, 2);
  assert.match(generationOptions.config.systemInstruction, /only titles present in the supplied catalog/);
});

test("Gemini empty or malformed responses are rejected", async () => {
  await assert.rejects(
    generateGeminiRecommendation({ apiKey: "test", model: "gemini-3.5-flash-lite", history: [], prompt: "Recommend a book." },
      () => ({ models: { generateContent: async () => ({ candidates: [] }) } })),
    /empty recommendation/,
  );
});
