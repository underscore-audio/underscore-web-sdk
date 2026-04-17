/*
 * Setup file for the live test suite.
 *
 * Unlike the mocked suite, we do NOT install MSW or mock
 * `supersonic-scsynth`. Live tests intentionally talk to the real API and
 * skip the audio engine entirely (Node has no WebAudio).
 *
 * The only shim we install is a Node-compatible `EventSource` so the
 * SDK's `subscribeToGeneration` can run without a browser. Node 22+ ships
 * a native global EventSource, but we target wider Node coverage and the
 * polyfill is a few hundred lines with no dependencies.
 */

import { EventSource as EventSourcePolyfill } from "eventsource";

if (typeof globalThis.EventSource === "undefined") {
  // Cast: the polyfill is API-compatible with the DOM EventSource type
  // modulo constructor signature (it supports a fetch-like options arg we
  // don't use here).
  (globalThis as { EventSource: typeof EventSource }).EventSource =
    EventSourcePolyfill as unknown as typeof EventSource;
}
