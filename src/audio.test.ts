/**
 * Tests for the audio engine.
 *
 * Note: Full audio tests require a browser environment with WebAudio support.
 * These tests focus on the engine's state management and API surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioEngine } from "./audio.js";
import { AudioError } from "./errors.js";

describe("AudioEngine", () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine({
      wasmBaseUrl: "/supersonic/",
    });
  });

  describe("constructor", () => {
    it("creates an uninitialized engine", () => {
      expect(engine.isInitialized()).toBe(false);
      expect(engine.isPlaying()).toBe(false);
      expect(engine.audioContext).toBeNull();
    });

    it("accepts custom worker URL", () => {
      const customEngine = new AudioEngine({
        wasmBaseUrl: "/assets/wasm/",
        workerBaseUrl: "/assets/workers/",
      });
      expect(customEngine["config"].workerBaseUrl).toBe("/assets/workers/");
    });
  });

  describe("state", () => {
    it("returns initial state", () => {
      const state = engine.state;
      expect(state).toEqual({
        playing: false,
        synthName: null,
        paramValues: {},
      });
    });
  });

  describe("subscribe", () => {
    it("calls listener immediately with current state", () => {
      const listener = vi.fn();
      engine.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        playing: false,
        synthName: null,
        paramValues: {},
      });
    });

    it("returns unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = engine.subscribe(listener);

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();

      // After unsubscribe, listener should not be in the set
      expect(engine["listeners"].has(listener)).toBe(false);
    });

    it("supports multiple listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      engine.subscribe(listener1);
      engine.subscribe(listener2);

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe("pre-init operations", () => {
    it("stop() does nothing when not initialized", () => {
      expect(() => engine.stop()).not.toThrow();
      expect(engine.isPlaying()).toBe(false);
    });

    it("setParam() does nothing when not initialized", () => {
      expect(() => engine.setParam("cutoff", 1000)).not.toThrow();
    });

    it("setParams() does nothing when not initialized", () => {
      expect(() => engine.setParams({ cutoff: 1000, amp: 0.5 })).not.toThrow();
    });

    it("getParam() returns undefined when not initialized", () => {
      expect(engine.getParam("cutoff")).toBeUndefined();
    });

    it("getAllParams() returns empty object when not initialized", () => {
      expect(engine.getAllParams()).toEqual({});
    });
  });

  describe("play()", () => {
    it("throws when not initialized", async () => {
      await expect(engine.play("test_synth")).rejects.toThrow(
        "Audio not initialized",
      );
    });
  });

  describe("toggle()", () => {
    it("does nothing when no synth is loaded", async () => {
      await expect(engine.toggle()).resolves.toBeUndefined();
      expect(engine.isPlaying()).toBe(false);
    });
  });

  describe("loadSamples()", () => {
    it("is a no-op for empty samples", async () => {
      await expect(engine.loadSamples([])).resolves.toBeUndefined();
    });

    it("throws AudioError when a sample is missing url", async () => {
      await expect(
        engine.loadSamples([
          {
            bufferNum: 0,
            id: "kick",
            description: "A kick",
            s3Key: "compositions/x/kick.wav",
            durationSec: 1.0,
            channels: 2,
            sampleRate: 48000,
            loop: false,
          },
        ])
      ).rejects.toBeInstanceOf(AudioError);
    });
  });
});
