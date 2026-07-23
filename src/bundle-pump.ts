/**
 * BundlePump -- the scheduling core for timed OSC playback.
 *
 * Given an anchor time on supersonic's superClock and a time-ordered list of
 * packet groups, the pump emits each group as a timestamped OSC bundle so
 * scsynth executes it sample-accurately on the audio thread, immune to
 * main-thread jitter. Only a short lookahead window is in flight at any
 * moment, so the engine's IN ring never holds a whole piece at once;
 * supersonic's pre-scheduler holds the near future.
 *
 * Timestamped bundles cannot be cancelled per-packet once sent, so the
 * mid-flight cancellation contract is: callers stop the pump, purge the
 * engine's scheduled queue, and start a new pump against the same anchor
 * with a filtered group list. start() skips groups already in the past,
 * which makes that stop/purge/restart sequence a cheap "re-anchor".
 *
 * Port of the first-party player's pump; kept semantically identical.
 */
import type { SuperSonic, OscBundleEncoder } from "supersonic-scsynth";

/** One OSC packet in array form: [address, ...args]. */
export type OscPacket = [string, ...Array<string | number>];

/** A set of packets that share an exact time, replayed in one OSC bundle. */
export interface PumpGroup {
  /** Offset in seconds from the pump's t0 anchor. */
  timeSec: number;
  packets: OscPacket[];
}

const PUMP_LOOKAHEAD_SEC = 2.0;
const PUMP_INTERVAL_MS = 250;

/*
 * Groups whose time has already passed when the pump (re)starts are skipped
 * rather than fired late: their effects either already happened (re-anchor
 * after a purge) or are intentionally dropped (start mid-piece). A small
 * negative margin still admits bundles from the current instant.
 */
const PAST_MARGIN_SEC = 0.05;

export interface PumpStartOptions {
  engine: SuperSonic;
  encoder: OscBundleEncoder;
  /** Anchor on superClock: group at timeSec=0 executes at this clock time. */
  t0: number;
  /** Time-ordered groups (ascending timeSec). */
  groups: PumpGroup[];
}

export class BundlePump {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private opts: PumpStartOptions | null = null;
  private index = 0;

  /**
   * Begin (or re-begin) pumping. Any previous run is stopped first. Groups
   * already in the past relative to t0 are skipped, so restarting with the
   * original anchor resumes exactly where the piece is now.
   */
  start(opts: PumpStartOptions): void {
    this.stop();
    this.opts = opts;

    const nowSec = opts.engine.superClock.now() - opts.t0;
    this.index = 0;
    while (
      this.index < opts.groups.length &&
      opts.groups[this.index].timeSec < nowSec - PAST_MARGIN_SEC
    ) {
      this.index++;
    }
    this.pump();
  }

  /** Stop emitting. Does not purge bundles already handed to the engine. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.opts = null;
  }

  /** True while groups remain unscheduled. */
  isActive(): boolean {
    return this.opts !== null && this.index < this.opts.groups.length;
  }

  private pump = (): void => {
    const opts = this.opts;
    if (!opts) return;

    const nowSec = opts.engine.superClock.now() - opts.t0;
    const horizon = nowSec + PUMP_LOOKAHEAD_SEC;

    while (this.index < opts.groups.length && opts.groups[this.index].timeSec <= horizon) {
      const group = opts.groups[this.index++];
      opts.engine.sendOSC(opts.encoder.encodeBundle(opts.t0 + group.timeSec, group.packets));
    }

    if (this.index < opts.groups.length) {
      this.timer = setTimeout(this.pump, PUMP_INTERVAL_MS);
    } else {
      this.timer = null;
    }
  };
}
