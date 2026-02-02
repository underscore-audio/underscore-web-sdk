import { describe, it, expect } from "vitest";
import { clamp, valueAtTime } from "./automation.js";
import type { AutomationKeyframe } from "./types.js";

describe("clamp", () => {
  it("returns value if within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles equal min/max", () => {
    expect(clamp(5, 5, 5)).toBe(5);
  });
});

describe("valueAtTime", () => {
  const keyframes: AutomationKeyframe[] = [
    { t: 0, value: 0 },
    { t: 10, value: 100 },
    { t: 20, value: 50 },
  ];

  it("returns first value before first keyframe", () => {
    expect(valueAtTime(keyframes, -5)).toBe(0);
  });

  it("returns first value at first keyframe", () => {
    expect(valueAtTime(keyframes, 0)).toBe(0);
  });

  it("interpolates linearly between keyframes", () => {
    expect(valueAtTime(keyframes, 5)).toBe(50);
  });

  it("returns exact value at keyframe boundary", () => {
    expect(valueAtTime(keyframes, 10)).toBe(100);
  });

  it("interpolates descending values", () => {
    expect(valueAtTime(keyframes, 15)).toBe(75);
  });

  it("returns last value after last keyframe", () => {
    expect(valueAtTime(keyframes, 30)).toBe(50);
  });

  it("returns 0 for empty keyframes", () => {
    expect(valueAtTime([], 5)).toBe(0);
  });

  describe("hold curve", () => {
    const holdKeyframes: AutomationKeyframe[] = [
      { t: 0, value: 0, curve: "hold" },
      { t: 10, value: 100 },
    ];

    it("holds value until next keyframe", () => {
      expect(valueAtTime(holdKeyframes, 5)).toBe(0);
      expect(valueAtTime(holdKeyframes, 9.9)).toBe(0);
    });

    it("snaps to new value at keyframe", () => {
      expect(valueAtTime(holdKeyframes, 10)).toBe(100);
    });
  });
});
