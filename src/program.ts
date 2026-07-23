/**
 * Program playback: a faithful replay of a captured multi-SynthDef piece.
 *
 * A Program does not reimplement the composition; it recreates the exact
 * node graph the piece was captured against (the manifest's `setup`), then
 * emits each beat's OSC as a timestamped bundle so scsynth executes it
 * sample-accurately on the audio thread, immune to main-thread jitter.
 *
 * Two-layer design, mirroring Synth/ScoreScheduler:
 *
 *   - ProgramTransport (internal, one per Underscore client) owns the
 *     shared engine graph, the bundle pump, the anchor clock, and the
 *     teardown chain. There is one audio engine per client and program
 *     manifests bake fixed node/bus IDs into their OSC, so at most one
 *     program can own the graph at a time; the transport is that
 *     ownership.
 *   - Program (public handle, one per loaded piece) carries the manifest,
 *     the pre-grouped beat schedule, and its synthdef bytes, and delegates
 *     playback to the transport. Handles stay valid across program
 *     switches: playing handle A after handle B re-uploads A's defs from
 *     the bytes it kept, so no network round-trip is needed.
 */
import type { AudioEngine } from "./audio.js";
import type { ProgramManifest, ProgramSection } from "./types.js";
import { BundlePump, type PumpGroup } from "./bundle-pump.js";
import {
  groupEventsByBeat,
  sectionIndexAtBeat,
  stemControlStateAtBeat,
  type BeatGroup,
} from "./program-manifest.js";
import { SynthError } from "./errors.js";

export type ProgramPlaybackState = "idle" | "playing";

export interface ProgramProgress {
  state: ProgramPlaybackState;
  /** Current position in beats (0 before start, capped at durationBeats). */
  beat: number;
  durationBeats: number;
  /** Current position in seconds at the program's tempo. */
  elapsedSec: number;
  /** Total length in seconds at the program's tempo. */
  durationSec: number;
  /** 0..1 position through the piece. */
  progress: number;
  sectionName: string | null;
  sectionIndex: number;
  sectionCount: number;
}

export type ProgramProgressListener = (progress: ProgramProgress) => void;

/*
 * START_DELAY_SEC is the lead-in between "press play" and the first audible
 * beat: enough for setup to be processed and for the first bundles to land
 * ahead of the audio thread. The re-anchor delay for a seek is shorter
 * because the graph already exists (no setup to process), so the jump lands
 * quickly while still scheduling the first bundle ahead of the audio thread.
 */
const START_DELAY_SEC = 0.5;
const SEEK_DELAY_SEC = 0.12;

/** Fixed group node IDs the manifest's setup creates (capture-kit contract). */
const SRC_GROUP_ID = 10;
const FX_GROUP_ID = 20;

/*
 * Progress ticks use a plain interval, not requestAnimationFrame: rAF is
 * absent outside browsers and freezes entirely in background tabs, which
 * would also freeze natural-end detection while the timestamped bundles
 * keep sounding. 100ms is smooth enough for progress UI, and background
 * throttling to ~1Hz only delays the end-of-piece group cleanup, which is
 * inaudible (the manifest's own teardown events have already silenced
 * everything).
 */
const PROGRESS_TICK_MS = 100;

interface ProgramListenerEntry {
  program: Program;
  fn: ProgramProgressListener;
}

/**
 * Shared playback owner for all Program handles of one Underscore client.
 *
 * @internal
 */
export class ProgramTransport {
  private engine: AudioEngine;
  private pump = new BundlePump();
  private t0 = 0;
  private started = false;
  private state: ProgramPlaybackState = "idle";
  private active: Program | null = null;
  /*
   * SynthDef names are only unique within one program, so the engine
   * holds exactly one program's defs at a time; switching re-uploads the
   * next program's bytes and /d_free's the names it does not reuse,
   * reclaiming RT memory that otherwise accumulates per distinct program.
   */
  private loadedKey: string | null = null;
  private loadedDefNames: string[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<ProgramListenerEntry>();
  /*
   * All graph teardowns are serialized on this chain. resetGraph awaits an
   * async purge() before sending /g_deepFree, so a fire-and-forget stop
   * could otherwise land its deep-free AFTER a subsequent play's setup --
   * killing the new program's groups and stems and purging its first
   * scheduled bundles. startAt awaits the chain before sending setup,
   * which closes that race for every caller.
   */
  private teardown: Promise<void> = Promise.resolve();

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  subscribe(program: Program, fn: ProgramProgressListener): () => void {
    const entry: ProgramListenerEntry = { program, fn };
    this.listeners.add(entry);
    fn(this.snapshotFor(program, this.active === program ? this.currentBeat() : 0));
    return () => this.listeners.delete(entry);
  }

  isPlayingProgram(program: Program): boolean {
    return this.state === "playing" && this.active === program;
  }

  /** Upload `program`'s defs into the engine if another program's are resident. */
  async ensureLoaded(program: Program): Promise<void> {
    if (this.loadedKey === program.key) return;

    for (const def of program.manifest.synthdefs) {
      const bytes = program.synthdefData(def);
      if (!bytes) {
        throw new SynthError(`Program "${program.name}" is missing synthdef bytes for "${def}"`);
      }
      await this.engine.loadSynthdefFromData(bytes);
    }
    await this.engine.engine!.sync();

    /*
     * Load the next program's defs first (same-name /d_recv overwrites
     * are already authoritative), then free names the previous program
     * owned that this one does not reuse. Freeing before load would
     * leave a window with no defs if setup raced ahead.
     */
    const nextDefs = new Set(program.manifest.synthdefs);
    const orphans = this.loadedDefNames.filter((name) => !nextDefs.has(name));
    if (orphans.length > 0) this.engine.freeSynthDefs(orphans);
    this.loadedDefNames = [...program.manifest.synthdefs];
    this.loadedKey = program.key;
  }

  /**
   * Start (or restart) `program` so `startBeat` sounds after the lead-in.
   * Rebuilds the graph from setup, optionally restores the cumulative stem
   * state at `startBeat`, then pumps every event from there onward.
   */
  async startAt(program: Program, startBeat: number): Promise<void> {
    if (this.state === "playing") this.stopImmediate();
    await this.ensureLoaded(program);

    const sonic = this.engine.engine;
    const encoder = this.engine.oscEncoder;
    if (!sonic || !encoder) {
      throw new SynthError("Audio not initialized. Call init() first.");
    }

    // Single engine owner: silence any single synth before taking over.
    this.engine.stop();
    await this.queueTeardown();

    const ctx = sonic.audioContext;
    if (ctx?.state === "suspended") await ctx.resume();

    /*
     * Setup runs immediately so groups and stem/FX synths exist well
     * before the first timestamped event (START_DELAY_SEC later). Node
     * IDs and bus numbers are baked into the manifest, so this
     * reconstructs the exact graph the piece was captured against.
     */
    for (const command of program.manifest.setup) {
      sonic.send(command.cmd, ...command.args);
    }
    /*
     * Mid-piece start: advance the freshly-created stems to the
     * cumulative control state a from-zero playthrough would have
     * reached by startBeat, so the section sounds as it should rather
     * than at its setup defaults.
     */
    if (startBeat > 0) {
      for (const packet of stemControlStateAtBeat(program.manifest, startBeat)) {
        sonic.send(...packet);
      }
    }

    this.active = program;
    this.started = true;
    this.state = "playing";
    this.anchorAndPump(program, startBeat, START_DELAY_SEC);
  }

  /**
   * Jump the playhead to `beat`. While `program` is already playing, the
   * running graph is re-anchored in place so sound is continuous;
   * otherwise the program (re)starts from that beat.
   */
  async seek(program: Program, beat: number): Promise<void> {
    const target = Math.max(0, beat);
    if (this.state === "playing" && this.started && this.active === program) {
      await this.reanchor(program, target);
    } else {
      await this.startAt(program, target);
    }
  }

  /**
   * Stop playback and tear down the graph -- but only when `program` is
   * the one playing, so a stale handle's stop cannot kill its successor.
   */
  async stop(program: Program): Promise<void> {
    if (this.active !== program) return;
    const previous = this.active;
    this.clearTimers();
    this.state = "idle";
    this.active = null;
    await this.queueTeardown();
    this.emitIdleFor(previous);
  }

  /**
   * Synchronous takeover stop, wired to AudioEngine.onBeforePlayback so a
   * single-synth play silences program playback without awaiting teardown.
   */
  interrupt(): void {
    if (this.state !== "playing") return;
    const previous = this.active;
    this.clearTimers();
    this.state = "idle";
    this.active = null;
    void this.queueTeardown();
    this.emitIdleFor(previous);
  }

  /**
   * Re-anchor the already-running graph to `beat`: cancel the future
   * bundles the old anchor scheduled (up to the pump's lookahead), restore
   * the stems to their cumulative state at the target, then re-anchor the
   * clock and re-pump. The persistent graph is left intact -- no teardown
   * -- so the jump is continuous; only the pending schedule is rebuilt.
   */
  private async reanchor(program: Program, beat: number): Promise<void> {
    const sonic = this.engine.engine;
    const encoder = this.engine.oscEncoder;
    if (!sonic || !encoder) return;

    this.pump.stop();
    try {
      await sonic.purge();
    } catch {
      /* best-effort: a failed purge still lets the re-anchor proceed */
    }
    for (const packet of stemControlStateAtBeat(program.manifest, beat)) {
      sonic.send(...packet);
    }
    this.anchorAndPump(program, beat, SEEK_DELAY_SEC);
  }

  /**
   * Anchor the clock so `beat` sounds `delaySec` from now, then (re)start
   * the pump from that beat. The single home for the delicate
   * `t0 = now + delay - beat*secPerBeat` math shared by first-play,
   * play-from-here, and seek; miscopying it detunes every onset.
   */
  private anchorAndPump(program: Program, beat: number, delaySec: number): void {
    const sonic = this.engine.engine!;
    const encoder = this.engine.oscEncoder!;
    const secPerBeat = 60 / program.manifest.bpm;
    this.t0 = sonic.superClock.now() + delaySec - beat * secPerBeat;
    this.pump.start({
      engine: sonic,
      encoder,
      t0: this.t0,
      groups: this.pumpGroupsFrom(program, beat, secPerBeat),
    });
    if (this.tickTimer === null) {
      this.tickTimer = setInterval(this.tick, PROGRESS_TICK_MS);
    }
    this.emitActive(beat);
  }

  /**
   * Beat groups at or after `startBeat`, timed on the absolute beat grid.
   * The explicit filter is NOT redundant with the pump's own past-group
   * skip: groups just before `startBeat` map to times inside the lead-in
   * delay (still future), so the pump would replay them. Dropping them
   * here is what prevents ghost onsets from just before the seek target.
   */
  private pumpGroupsFrom(program: Program, startBeat: number, secPerBeat: number): PumpGroup[] {
    return program.beatGroups
      .filter((group) => group.beat >= startBeat - 1e-9)
      .map((group) => ({ timeSec: group.beat * secPerBeat, packets: group.packets }));
  }

  private currentBeat(): number {
    const sonic = this.engine.engine;
    const manifest = this.active?.manifest;
    if (!sonic || !manifest || this.state !== "playing") return 0;
    const secPerBeat = 60 / manifest.bpm;
    return Math.max(0, (sonic.superClock.now() - this.t0) / secPerBeat);
  }

  private tick = (): void => {
    const program = this.active;
    if (this.state !== "playing" || !program) return;

    const beat = this.currentBeat();
    if (beat >= program.manifest.durationBeats) {
      this.finishNaturally(program);
      return;
    }
    this.emitActive(beat);
  };

  /**
   * Playback reached the end of the manifest. The manifest's own teardown
   * events already freed the transient/stem synths; free the two group
   * nodes so a later replay can recreate them cleanly.
   */
  private finishNaturally(program: Program): void {
    const sonic = this.engine.engine;
    this.clearTimers();
    this.state = "idle";
    this.active = null;
    if (sonic && this.started) {
      sonic.send("/n_free", SRC_GROUP_ID, FX_GROUP_ID);
    }
    this.started = false;
    this.emitFor(program, program.manifest.durationBeats);
  }

  /**
   * Free the program's node graph if it exists. Purge first so any bundles
   * still in flight can't recreate nodes after the groups are freed.
   */
  private async resetGraph(): Promise<void> {
    const sonic = this.engine.engine;
    if (!sonic || !this.started) return;
    try {
      await sonic.purge();
    } catch {
      /* purge is best-effort; a failed purge still lets us free the graph */
    }
    sonic.send("/g_deepFree", SRC_GROUP_ID);
    sonic.send("/g_deepFree", FX_GROUP_ID);
    sonic.send("/n_free", SRC_GROUP_ID, FX_GROUP_ID);
    this.started = false;
  }

  /**
   * Append a resetGraph to the teardown chain (see `teardown`). Failures
   * are swallowed so one broken teardown cannot poison every later one.
   */
  private queueTeardown(): Promise<void> {
    const next = this.teardown.then(() => this.resetGraph()).catch(() => {});
    this.teardown = next;
    return next;
  }

  private clearTimers(): void {
    this.pump.stop();
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Synchronous teardown for the internal play()-restart path. */
  private stopImmediate(): void {
    const previous = this.active;
    this.clearTimers();
    this.state = "idle";
    this.active = null;
    void this.queueTeardown();
    this.emitIdleFor(previous);
  }

  private snapshotFor(program: Program, beat: number): ProgramProgress {
    const manifest = program.manifest;
    const playing = this.state === "playing" && this.active === program;
    const secPerBeat = 60 / manifest.bpm;
    const sections: ProgramSection[] = manifest.sections;
    const index = sectionIndexAtBeat(sections, beat);
    return {
      state: playing ? "playing" : "idle",
      beat,
      durationBeats: manifest.durationBeats,
      elapsedSec: beat * secPerBeat,
      durationSec: manifest.durationBeats * secPerBeat,
      progress: manifest.durationBeats > 0 ? Math.min(1, beat / manifest.durationBeats) : 0,
      sectionName: index >= 0 ? sections[index].name : null,
      sectionIndex: index,
      sectionCount: sections.length,
    };
  }

  private emitFor(program: Program, beat: number): void {
    for (const entry of this.listeners) {
      if (entry.program === program) entry.fn(this.snapshotFor(program, beat));
    }
  }

  private emitActive(beat: number): void {
    if (this.active) this.emitFor(this.active, beat);
  }

  private emitIdleFor(program: Program | null): void {
    if (program) this.emitFor(program, 0);
  }
}

/**
 * A loaded, playable program. Created by Underscore.loadProgram().
 */
export class Program {
  private transport: ProgramTransport;
  private _compositionId: string;
  private _name: string;
  private _manifest: ProgramManifest;
  private _beatGroups: BeatGroup[];
  /*
   * Synthdef bytes are kept on the handle so switching back to this
   * program after another one evicted its defs re-uploads from memory
   * instead of re-fetching. Compiled defs are a few KB each; the
   * manifest (already held) dwarfs them.
   */
  private defs: Map<string, ArrayBuffer>;

  constructor(
    transport: ProgramTransport,
    compositionId: string,
    name: string,
    manifest: ProgramManifest,
    defs: Map<string, ArrayBuffer>
  ) {
    this.transport = transport;
    this._compositionId = compositionId;
    this._name = name;
    this._manifest = manifest;
    this._beatGroups = groupEventsByBeat(manifest.events);
    this.defs = defs;
  }

  /** Composition ID this program belongs to. */
  get compositionId(): string {
    return this._compositionId;
  }

  /** Program name (unique within its composition). */
  get name(): string {
    return this._name;
  }

  /** Display title from the manifest. */
  get title(): string {
    return this._manifest.title;
  }

  /** Human-readable description from the manifest. */
  get description(): string {
    return this._manifest.description;
  }

  /** Tempo in beats per minute. */
  get bpm(): number {
    return this._manifest.bpm;
  }

  /** Total length in beats. */
  get durationBeats(): number {
    return this._manifest.durationBeats;
  }

  /** Total length in seconds at the program's tempo. */
  get durationSec(): number {
    return (this._manifest.durationBeats / this._manifest.bpm) * 60;
  }

  /** Named sections with their start beats, in playback order. */
  get sections(): ProgramSection[] {
    return this._manifest.sections;
  }

  /** The full captured manifest. */
  get manifest(): ProgramManifest {
    return this._manifest;
  }

  /** @internal Identity key for transport-level ownership checks. */
  get key(): string {
    return `${this._compositionId}/${this._name}`;
  }

  /** @internal Pre-grouped beat schedule shared with the transport. */
  get beatGroups(): BeatGroup[] {
    return this._beatGroups;
  }

  /** @internal Synthdef bytes for the transport's def uploads. */
  synthdefData(defName: string): ArrayBuffer | undefined {
    return this.defs.get(defName);
  }

  /**
   * Play from the beginning. Stops any single-synth playback and any
   * other program first (one engine, one audible owner).
   */
  async play(): Promise<void> {
    await this.transport.startAt(this, 0);
  }

  /**
   * Jump the playhead to `beat` (fast-forward or rewind). While this
   * program is playing, the running graph is re-anchored in place so
   * sound is continuous; otherwise playback (re)starts from that beat.
   * Either way the persistent stems are restored to the cumulative
   * control state a from-zero playthrough would have reached by `beat`.
   */
  async seek(beat: number): Promise<void> {
    await this.transport.seek(this, beat);
  }

  /** Convenience: seek to a section by index (see `sections`). */
  async seekToSection(index: number): Promise<void> {
    const section = this._manifest.sections[index];
    if (!section) {
      throw new SynthError(`Program "${this._name}" has no section ${index}`);
    }
    await this.seek(section.beat);
  }

  /**
   * Stop playback and tear down the graph. No-op when another program
   * (or none) currently owns playback.
   */
  async stop(): Promise<void> {
    await this.transport.stop(this);
  }

  /** Whether this program is the one currently playing. */
  isPlaying(): boolean {
    return this.transport.isPlayingProgram(this);
  }

  /**
   * Subscribe to playback progress (beat position, section, 0..1
   * progress) at a steady tick while this program plays. The listener
   * fires immediately with the current snapshot and receives a final
   * idle snapshot when playback stops or another program takes over.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ProgramProgressListener): () => void {
    return this.transport.subscribe(this, listener);
  }
}
