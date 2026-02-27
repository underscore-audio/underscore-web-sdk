/**
 * MSW handlers for mocking the Underscore API in tests.
 */

import { http, HttpResponse } from "msw";

/**
 * Sample test data for mocked API responses.
 */
export const testData = {
  compositionId: "cmp_test123",
  synth: {
    name: "warm_pad",
    description: "A warm analog pad sound",
    params: [
      { name: "amp", type: "amp", default: 0.5, min: 0, max: 1, description: "Output volume" },
      {
        name: "cutoff",
        type: "freq",
        default: 1000,
        min: 20,
        max: 20000,
        scale: "log",
        unit: "Hz",
        description: "Filter cutoff frequency",
      },
      {
        name: "resonance",
        type: "control",
        default: 0.3,
        min: 0,
        max: 1,
        description: "Filter resonance",
      },
    ],
    createdAt: "2024-01-15T10:30:00Z",
    synthdefUrl: "/api/v1/compositions/cmp_test123/synths/warm_pad/synthdef",
  },
};

/**
 * MSW request handlers for the Underscore API.
 */
export const handlers = [
  // List synths
  http.get("*/api/v1/compositions/:compositionId/synths", ({ params }) => {
    const { compositionId } = params;

    if (compositionId === "cmp_notfound") {
      return HttpResponse.json({ error: "Composition not found" }, { status: 404 });
    }

    if (compositionId === "cmp_empty") {
      return HttpResponse.json({ synths: [] });
    }

    return HttpResponse.json({
      synths: [
        {
          name: testData.synth.name,
          description: testData.synth.description,
          params: testData.synth.params,
          createdAt: testData.synth.createdAt,
        },
      ],
    });
  }),

  // Get synth metadata
  http.get("*/api/v1/compositions/:compositionId/synths/:synthName", ({ params }) => {
    const { compositionId, synthName } = params;

    if (compositionId === "cmp_notfound" || synthName === "not_found") {
      return HttpResponse.json({ error: "Synth not found" }, { status: 404 });
    }

    return HttpResponse.json(testData.synth);
  }),

  // Get synthdef binary
  http.get("*/api/v1/compositions/:compositionId/synths/:synthName/synthdef", ({ params }) => {
    const { compositionId, synthName } = params;

    if (compositionId === "cmp_notfound" || synthName === "not_found") {
      return HttpResponse.json({ error: "Synthdef not found" }, { status: 404 });
    }

    // Return mock binary data
    const mockSynthdef = new Uint8Array([83, 67, 103, 102, 0, 0, 0, 2]);
    return HttpResponse.arrayBuffer(mockSynthdef.buffer, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }),

  // Generate synth
  http.post("*/api/v1/compositions/:compositionId/generate", async ({ params, request }) => {
    const { compositionId } = params;

    if (compositionId === "cmp_notfound") {
      return HttpResponse.json({ error: "Composition not found" }, { status: 404 });
    }

    const body = (await request.json()) as { description?: string };
    if (!body.description) {
      return HttpResponse.json({ error: "Description is required" }, { status: 400 });
    }

    return HttpResponse.json({
      streamUrl: `/api/stream/${compositionId}/job_123`,
    });
  }),
];

/**
 * Handler for invalid API key.
 */
export const unauthorizedHandler = http.get("*/api/v1/*", () => {
  return HttpResponse.json({ error: "Invalid API key" }, { status: 401 });
});

/**
 * Handler for server errors.
 */
export const serverErrorHandler = http.get("*/api/v1/*", () => {
  return HttpResponse.json({ error: "Internal server error" }, { status: 500 });
});
