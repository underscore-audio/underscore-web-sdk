/**
 * Vitest setup file for SDK tests.
 *
 * Sets up MSW server and mocks browser APIs not available in Node.js.
 */

import { vi, beforeAll, afterAll, afterEach } from "vitest";
import { server } from "./mocks/server.js";

/**
 * Start MSW server before all tests.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

/**
 * Reset handlers after each test.
 */
afterEach(() => {
  server.resetHandlers();
});

/**
 * Close MSW server after all tests.
 */
afterAll(() => {
  server.close();
});

/**
 * Mock EventSource (not available in Node.js).
 *
 * `instances` lets a test grab the live EventSource after the SDK
 * constructs one, so it can drive the stream via _simulateMessage /
 * _simulateError without reaching into private SDK state.
 */
export class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  static instances: MockEventSource[] = [];
  static resetInstances(): void {
    MockEventSource.instances = [];
  }

  url: string;
  readyState = MockEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private _listeners: Map<string, Set<(event: MessageEvent) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN;
      this.onopen?.({ type: "open" } as Event);
    }, 0);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this._listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  /**
   * Helper to simulate receiving a message (for testing).
   */
  _simulateMessage(data: string): void {
    const event = { data, type: "message" } as MessageEvent;
    this.onmessage?.(event);
    this._listeners.get("message")?.forEach((l) => l(event));
  }

  /**
   * Helper to simulate an error (for testing).
   */
  _simulateError(): void {
    const event = { type: "error" } as Event;
    this.onerror?.(event);
  }
}

vi.stubGlobal("EventSource", MockEventSource);

/**
 * Mock supersonic-scsynth module.
 */
vi.mock("supersonic-scsynth", () => {
  const mockAudioContext = {
    state: "suspended",
    resume: vi.fn().mockResolvedValue(undefined),
  };

  return {
    SuperSonic: vi.fn().mockImplementation(() => ({
      audioContext: mockAudioContext,
      init: vi.fn().mockResolvedValue(undefined),
      loadSynthDef: vi.fn().mockResolvedValue(undefined),
      loadSample: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
    })),
  };
});

/**
 * Mock URL.createObjectURL and URL.revokeObjectURL.
 */
let objectUrlCounter = 0;
vi.stubGlobal(
  "URL",
  class MockURL extends URL {
    static createObjectURL(_blob: Blob): string {
      return `blob:mock-url-${++objectUrlCounter}`;
    }
    static revokeObjectURL(_url: string): void {
      // No-op
    }
  }
);

/**
 * Mock Blob (partial implementation for tests).
 */
if (typeof Blob === "undefined") {
  vi.stubGlobal(
    "Blob",
    class MockBlob {
      private _parts: BlobPart[];
      private _options: BlobPropertyBag;

      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        this._parts = parts ?? [];
        this._options = options ?? {};
      }

      get type(): string {
        return this._options.type ?? "";
      }

      get size(): number {
        return this._parts.reduce((acc, part) => {
          if (typeof part === "string") return acc + part.length;
          if (part instanceof ArrayBuffer) return acc + part.byteLength;
          return acc;
        }, 0);
      }
    }
  );
}

/**
 * Mock requestAnimationFrame and cancelAnimationFrame.
 */
let rafId = 0;
const rafCallbacks: Map<number, FrameRequestCallback> = new Map();

vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
  const id = ++rafId;
  rafCallbacks.set(id, callback);
  // Execute on next tick to simulate animation frame
  setTimeout(() => {
    const cb = rafCallbacks.get(id);
    if (cb) {
      rafCallbacks.delete(id);
      cb(performance.now());
    }
  }, 16);
  return id;
});

vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
  rafCallbacks.delete(id);
});
