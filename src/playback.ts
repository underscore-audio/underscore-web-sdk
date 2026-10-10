import { AudioEngine, type AudioEngineConfig } from "./audio.js";
import { Program, ProgramTransport, type ProgramPlaybackDriver } from "./program.js";
import { ScoreScheduler, lowerScore, scoreValuesAt } from "./score-scheduler.js";
import { sectionIndexAtBeat } from "./program-manifest.js";
import { ProgramManifestSchema } from "./schemas.js";
import type { SynthPlaybackDriver } from "./synth.js";
import { SynthError } from "./errors.js";
import type { ParamMetadata, ProgramManifest, SynthScore } from "./types.js";

export { AudioEngine } from "./audio.js";
export {
  groupEventsByBeat,
  sectionIndexAtBeat,
  foldControlPairs,
  stemControlStateAtBeat,
} from "./program-manifest.js";
export type { BeatGroup } from "./program-manifest.js";
export type { ProgramSection } from "./types.js";
export type { ParamMetadata, ProgramManifest, SynthScore } from "./types.js";

export interface PreparedSample {
  bufferNum: number;
  data: ArrayBuffer;
}
export interface PreparedSynth {
  readonly kind: "synth";
  readonly identity: string;
  readonly name: string;
  readonly description: string;
  readonly controlsWritable: boolean;
  readonly params: readonly ParamMetadata[];
  readonly synthdef: ArrayBuffer;
  readonly samples: readonly PreparedSample[];
  readonly score?: SynthScore;
}
export interface PreparedProgram {
  readonly kind: "program";
  readonly identity: string;
  readonly name: string;
  readonly manifest: ProgramManifest;
  readonly synthdefs: ReadonlyMap<string, ArrayBuffer>;
}
export type PreparedArtifact = PreparedSynth | PreparedProgram;
export interface ManualSnapshot {
  readonly identity: string;
  readonly positionSec: number;
  readonly values: Readonly<Record<string, number>>;
}
export interface PlaybackSnapshot {
  readonly identity: string | null;
  readonly kind: PreparedArtifact["kind"] | null;
  readonly playing: boolean;
  readonly positionSec: number;
  readonly durationSec: number;
  readonly params: Readonly<Record<string, number>>;
  readonly manual: ManualSnapshot | null;
  readonly controlsWritable: boolean;
  readonly volume: number;
  readonly error: string | null;
}

export function isProgramManifest(value: unknown): value is ProgramManifest {
  return ProgramManifestSchema.safeParse(value).success;
}

function requireIdentity(identity: string, name: string): void {
  if (!identity || !name) throw new SynthError("Artifact identity and name are required");
}
function requireBytes(data: ArrayBuffer, name: string): void {
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0)
    throw new SynthError(`Missing bytes for ${name}`);
}

/** Preparation is data-only: it never initializes audio, uploads buffers or changes a sounding source. */
export function prepareSynth(
  input: Omit<PreparedSynth, "kind" | "samples" | "controlsWritable"> & {
    samples?: readonly PreparedSample[];
  }
): PreparedSynth {
  requireIdentity(input.identity, input.name);
  requireBytes(input.synthdef, input.name);
  const metadata = new Map<string, ParamMetadata>();
  for (const param of input.params) {
    if (
      metadata.has(param.name) ||
      !param.name ||
      ![param.min, param.max, param.default].every(Number.isFinite) ||
      param.min > param.max ||
      param.default < param.min ||
      param.default > param.max ||
      (param.step !== undefined && (!Number.isFinite(param.step) || param.step <= 0))
    ) {
      throw new SynthError(`Invalid control metadata: ${param.name}`);
    }
    metadata.set(param.name, param);
  }
  let controlsWritable = input.params.length > 0;
  if (input.score) {
    if (!Number.isFinite(input.score.totalDurationSec) || input.score.totalDurationSec < 0)
      throw new SynthError("Invalid score duration");
    for (const event of input.score.events) {
      if (
        !Number.isFinite(event.tMs) ||
        event.tMs < 0 ||
        event.tMs > input.score.totalDurationSec * 1000
      )
        throw new SynthError("Score event is outside its duration");
      for (const [name, value] of Object.entries(event.params)) {
        if (!name || !Number.isFinite(value))
          throw new SynthError(`Invalid score control: ${name}`);
        const param = metadata.get(name);
        if (!param || value < param.min || value > param.max) controlsWritable = false;
      }
    }
  }
  const buffers = new Set<number>();
  const samples = input.samples ?? [];
  for (const sample of samples) {
    if (
      !Number.isInteger(sample.bufferNum) ||
      sample.bufferNum < 0 ||
      buffers.has(sample.bufferNum)
    )
      throw new SynthError("Invalid sample buffer number");
    requireBytes(sample.data, `buffer ${sample.bufferNum}`);
    buffers.add(sample.bufferNum);
  }
  return Object.freeze({
    ...input,
    kind: "synth",
    controlsWritable,
    params: input.params.map((param) => Object.freeze({ ...param })),
    samples: [...samples],
  });
}

export function prepareProgram(input: Omit<PreparedProgram, "kind">): PreparedProgram {
  requireIdentity(input.identity, input.name);
  const validated = ProgramManifestSchema.safeParse(input.manifest);
  if (!validated.success) throw new SynthError("Invalid program manifest");
  const manifest = validated.data;
  if (
    manifest.format !== 1 ||
    !Number.isFinite(manifest.bpm) ||
    manifest.bpm <= 0 ||
    !Number.isFinite(manifest.durationBeats) ||
    manifest.durationBeats < 0
  )
    throw new SynthError("Invalid program timing");
  for (const name of manifest.synthdefs) {
    const bytes = input.synthdefs.get(name);
    if (!bytes) throw new SynthError(`Missing bytes for ${name}`);
    requireBytes(bytes, name);
  }
  return Object.freeze({
    ...input,
    manifest,
    kind: "program",
    synthdefs: new Map(input.synthdefs),
  });
}

function defaults(artifact: PreparedSynth): Record<string, number> {
  return Object.fromEntries(artifact.params.map((param) => [param.name, param.default]));
}
function duration(artifact: PreparedArtifact | null): number {
  return !artifact
    ? 0
    : artifact.kind === "program"
      ? (artifact.manifest.durationBeats * 60) / artifact.manifest.bpm
      : (artifact.score?.totalDurationSec ?? 0);
}

export interface PlaybackCoreConfig extends Partial<AudioEngineConfig> {
  /** Supply an engine when sharing playback with existing handles. */
  engine?: AudioEngine;
}

/** Persistent audio owner. Hosts fetch resources; this class only consumes prepared artifacts. */
export class PlaybackCore {
  private readonly audio: AudioEngine;
  private readonly programTransport: ProgramTransport;
  private readonly score = new ScoreScheduler();
  private active: PreparedArtifact | null = null;
  private program: Program | null = null;
  private programUnsubscribe: (() => void) | null = null;
  private loadedIdentity: string | null = null;
  private manualStates = new Map<
    string,
    { snapshot: ManualSnapshot; values: Record<string, number> }
  >();
  private generation = 0;
  private operations: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PlaybackSnapshot = Object.freeze({
    identity: null,
    kind: null,
    playing: false,
    positionSec: 0,
    durationSec: 0,
    params: Object.freeze({}),
    manual: null,
    controlsWritable: false,
    volume: 1,
    error: null,
  });

  constructor(config: PlaybackCoreConfig = {}) {
    this.audio =
      config.engine ??
      new AudioEngine({ ...config, wasmBaseUrl: config.wasmBaseUrl ?? "/supersonic/" });
    this.programTransport = new ProgramTransport(this.audio);
    this.audio.onBeforePlayback = () => this.programTransport.interrupt();
    this.audio.subscribe((state) => {
      if (this.snapshot.kind === "synth" && !this.snapshot.playing && state.playing)
        this.update({ playing: true });
      if (this.snapshot.kind === "synth" && this.snapshot.playing && !state.playing) {
        this.score.cancel();
        this.clearTicker();
        this.update({ playing: false });
      }
    });
  }

  getSnapshot = (): PlaybackSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get audioContext(): AudioContext | null {
    return this.audio.audioContext;
  }
  get analyser(): AnalyserNode | null {
    return this.audio.analyserNode;
  }
  isInitialized(): boolean {
    return this.audio.isInitialized();
  }
  init(): Promise<void> {
    return this.audio.init();
  }
  prepareSynth = prepareSynth;
  prepareProgram = prepareProgram;

  private update(patch: Partial<PlaybackSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const epoch = this.generation;
    const next = this.operations.then(operation);
    this.operations = next.catch(() => {});
    return next.catch((error) => {
      if (epoch === this.generation)
        this.update({ error: error instanceof Error ? error.message : "Playback failed" });
      throw error;
    });
  }
  private rememberManual(): void {
    if (this.snapshot.identity && this.snapshot.manual)
      this.manualStates.set(this.snapshot.identity, {
        snapshot: this.snapshot.manual,
        values: { ...this.snapshot.params },
      });
  }
  private clearTicker(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  private async silence(): Promise<void> {
    this.score.cancel();
    this.clearTicker();
    if (this.program) await this.program.stop();
    this.programUnsubscribe?.();
    this.programUnsubscribe = null;
    this.program = null;
    if (this.audio.isInitialized() && this.audio.engine) await this.audio.engine.purge();
    this.audio.stop();
  }
  private scoreValues(artifact: PreparedSynth, seconds: number): Record<string, number> {
    const initial = defaults(artifact);
    return artifact.score
      ? scoreValuesAt(lowerScore(artifact.score, initial), initial, seconds)
      : initial;
  }

  activate(
    artifact: PreparedArtifact,
    options: { play: boolean; startSec?: number } = { play: false }
  ): Promise<void> {
    if (options.startSec !== undefined && !Number.isFinite(options.startSec))
      return Promise.reject(new SynthError("Playback position must be finite"));
    this.rememberManual();
    const token = ++this.generation;
    this.audio.cancelCrossfade();
    this.score.cancel();
    this.clearTicker();
    return this.enqueue(async () => {
      if (token !== this.generation) return;
      await this.silence();
      if (token !== this.generation) return;
      this.active = artifact;
      const position = Math.max(
        0,
        Math.min(options.startSec ?? 0, duration(artifact) || options.startSec || 0)
      );
      this.update({
        identity: artifact.identity,
        kind: artifact.kind,
        controlsWritable: artifact.kind === "synth" && artifact.controlsWritable,
        playing: false,
        durationSec: duration(artifact),
        positionSec: position,
        params: Object.freeze(
          artifact.kind === "synth" ? this.scoreValues(artifact, position) : {}
        ),
        manual: null,
        error: null,
      });
      const remembered = this.manualStates.get(artifact.identity);
      if (remembered) this.restoreManual(remembered.snapshot, remembered.values);
      if (options.play) await this.start(artifact, this.snapshot.positionSec, token);
    });
  }

  private async start(artifact: PreparedArtifact, seconds: number, token: number): Promise<void> {
    await this.audio.init();
    if (token !== this.generation) return;
    const position = Math.max(0, Math.min(seconds, duration(artifact) || seconds));
    if (artifact.kind === "program") {
      const program = new Program(
        this.programTransport,
        artifact.identity,
        artifact.name,
        artifact.manifest,
        new Map(artifact.synthdefs)
      );
      this.program = program;
      this.programUnsubscribe = program.subscribe((progress) => {
        if (this.active !== artifact || this.program !== program) return;
        this.update({ playing: progress.state === "playing", positionSec: progress.elapsedSec });
      });
      this.loadedIdentity = null;
      await this.programTransport.startAt(
        program,
        (position * artifact.manifest.bpm) / 60,
        () => token === this.generation && this.active === artifact
      );
      if (token !== this.generation) {
        await program.stop();
        return;
      }
      this.loadedIdentity = null;
      return;
    }
    if (this.loadedIdentity !== artifact.identity) {
      this.audio.clearBuffers();
      for (const sample of artifact.samples) {
        if (token !== this.generation) return;
        await this.audio.loadSampleFromData(sample.bufferNum, sample.data);
      }
      if (token !== this.generation) return;
      this.programTransport.invalidateDefinitions();
      await this.audio.loadSynthdefFromData(artifact.synthdef);
      if (token !== this.generation) return;
      this.programTransport.replaceDefinitions([artifact.name]);
      this.loadedIdentity = artifact.identity;
    }
    await this.audio.play(artifact.name);
    if (token !== this.generation) {
      this.audio.stop();
      return;
    }
    const params = this.snapshot.manual
      ? { ...this.snapshot.params }
      : this.scoreValues(artifact, position);
    this.audio.setParams(params);
    this.update({
      playing: true,
      positionSec: position,
      params: Object.freeze(params),
      error: null,
    });
    if (!this.snapshot.manual) this.startScore(artifact, position);
  }

  private startScore(artifact: PreparedSynth, seconds: number): void {
    const engine = this.audio.engine;
    const encoder = this.audio.oscEncoder;
    const nodeId = this.audio.playingNodeId;
    if (!artifact.score || !engine || !encoder || nodeId === null) return;
    this.score.startAudio({
      score: artifact.score,
      initialValues: defaults(artifact),
      engine,
      encoder,
      nodeId,
      startSec: seconds,
      onTick: (params) => {
        if (this.active !== artifact || this.snapshot.manual) return;
        this.audio.cacheParams(params);
      },
      onEnd: () => {
        if (this.active !== artifact) return;
        this.clearTicker();
        this.update({
          playing: false,
          positionSec: duration(artifact),
          params: Object.freeze(this.scoreValues(artifact, duration(artifact))),
        });
        this.audio.stop();
      },
    });
    this.clearTicker();
    this.timer = setInterval(() => {
      if (this.active === artifact && !this.snapshot.manual)
        this.update({
          positionSec: this.score.positionSec,
          params: Object.freeze(this.score.values),
        });
    }, 100);
  }

  play(): Promise<void> {
    const artifact = this.active;
    if (!artifact)
      return Promise.reject(new SynthError("Select a prepared artifact before playing"));
    const token = ++this.generation;
    return this.enqueue(async () => {
      if (token !== this.generation) return;
      if (this.snapshot.playing) return;
      await this.start(
        artifact,
        this.snapshot.positionSec >= duration(artifact) ? 0 : this.snapshot.positionSec,
        token
      );
    });
  }
  stop(identity?: string): Promise<void> {
    if (identity && identity !== this.snapshot.identity) return Promise.resolve();
    ++this.generation;
    const position = this.snapshot.manual
      ? this.snapshot.positionSec
      : this.score.positionSec || this.snapshot.positionSec;
    this.score.cancel();
    this.clearTicker();
    this.audio.cancelCrossfade();
    this.audio.stop();
    this.programTransport.interrupt();
    this.update({
      playing: false,
      positionSec: position,
      params: Object.freeze(
        this.active?.kind === "synth" && !this.snapshot.manual
          ? this.scoreValues(this.active, position)
          : { ...this.snapshot.params }
      ),
    });
    return this.enqueue(() => this.silence());
  }
  seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds))
      return Promise.reject(new SynthError("Seek position must be finite"));
    const artifact = this.active;
    if (!artifact) return Promise.resolve();
    const playing = this.snapshot.playing;
    const position = Math.max(0, Math.min(seconds, duration(artifact) || seconds));
    const token = ++this.generation;
    this.score.cancel();
    this.clearTicker();
    this.manualStates.delete(artifact.identity);
    this.update({
      positionSec: position,
      manual: null,
      params: Object.freeze(artifact.kind === "synth" ? this.scoreValues(artifact, position) : {}),
    });
    return this.enqueue(async () => {
      if (token !== this.generation) return;
      if (playing && artifact.kind === "program" && this.program) {
        await this.programTransport.seek(
          this.program,
          (position * artifact.manifest.bpm) / 60,
          () => token === this.generation && this.active === artifact
        );
      } else {
        await this.silence();
        if (playing && token === this.generation) await this.start(artifact, position, token);
      }
    });
  }

  /** Explicit takeover is additive; ordinary SDK parameter writes retain their existing meaning. */
  setParam(name: string, value: number): Promise<void> {
    return this.writeParam(name, value, true);
  }
  writeParam(name: string, value: number, holdAutomation = false): Promise<void> {
    const artifact = this.active;
    if (!artifact || artifact.kind !== "synth")
      return Promise.reject(new SynthError("This source has no writable controls"));
    const metadata = artifact.params.find((param) => param.name === name);
    if (!metadata || !Number.isFinite(value))
      return Promise.reject(new SynthError(`Invalid control: ${name}`));
    if (holdAutomation && !artifact.controlsWritable)
      return Promise.reject(new SynthError("This source has no safe automation controls"));
    const step = metadata.step ?? (metadata.type === "switch" ? 1 : undefined);
    const quantized =
      step === undefined ? value : metadata.min + Math.round((value - metadata.min) / step) * step;
    const clamped = Math.max(metadata.min, Math.min(metadata.max, quantized));
    const live =
      this.snapshot.playing && artifact.score && this.score.isActive && !this.snapshot.manual
        ? this.score.values
        : this.snapshot.params;
    const current = live[name] ?? metadata.default;
    if (
      Math.abs(clamped - current) <=
      Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(clamped))
    )
      return Promise.resolve();
    let held = false;
    if (holdAutomation && !this.snapshot.manual) {
      // A pending same-source Play still owns transport intent and reads these held values.
      const seconds =
        this.snapshot.playing && this.score.isActive
          ? this.score.positionSec
          : this.snapshot.positionSec;
      const captured = Object.freeze({ ...this.scoreValues(artifact, seconds), ...live });
      const manual = Object.freeze({
        identity: artifact.identity,
        positionSec: seconds,
        values: captured,
      });
      this.score.cancel();
      this.clearTicker();
      this.update({ manual, positionSec: seconds, params: captured });
      held = true;
    }
    const params = Object.freeze({ ...this.snapshot.params, [name]: clamped });
    this.update({ params });
    this.rememberManual();
    return this.enqueue(async () => {
      if (this.active !== artifact) return;
      if (held && this.audio.isInitialized() && this.audio.engine) await this.audio.engine.purge();
      if (this.active !== artifact) return;
      if (holdAutomation) this.audio.setParams({ ...this.snapshot.params });
      else this.audio.setParam(name, clamped);
    });
  }
  resumeAutomation(): Promise<void> {
    const artifact = this.active;
    const manual = this.snapshot.manual;
    if (!artifact || artifact.kind !== "synth" || !manual || manual.identity !== artifact.identity)
      return Promise.resolve();
    const token = this.generation;
    this.manualStates.delete(artifact.identity);
    this.update({
      manual: null,
      positionSec: manual.positionSec,
      params: Object.freeze({ ...manual.values }),
    });
    return this.enqueue(async () => {
      if (token !== this.generation || this.active !== artifact) return;
      if (this.audio.isInitialized() && this.audio.engine) await this.audio.engine.purge();
      if (token !== this.generation || this.snapshot.manual) return;
      // Play may have completed while Resume waited behind initialization or uploads.
      if (this.snapshot.playing) {
        this.audio.setParams({ ...manual.values });
        this.startScore(artifact, manual.positionSec);
      }
    });
  }
  restoreManual(manual: ManualSnapshot, values: Record<string, number>): void {
    const artifact = this.active;
    if (
      !artifact ||
      artifact.kind !== "synth" ||
      !artifact.controlsWritable ||
      this.snapshot.playing ||
      manual.identity !== artifact.identity ||
      !Number.isFinite(manual.positionSec)
    )
      return;
    const valid = (map: Readonly<Record<string, number>>): boolean =>
      artifact.params.every(
        (param) =>
          Number.isFinite(map[param.name]) &&
          map[param.name] >= param.min &&
          map[param.name] <= param.max
      );
    if (
      manual.positionSec < 0 ||
      (duration(artifact) > 0 && manual.positionSec > duration(artifact)) ||
      !valid(manual.values) ||
      !valid(values)
    )
      return;
    const exposed = (map: Readonly<Record<string, number>>): Record<string, number> =>
      Object.fromEntries(artifact.params.map((param) => [param.name, map[param.name]]));
    this.update({
      manual: Object.freeze({ ...manual, values: Object.freeze(exposed(manual.values)) }),
      positionSec: manual.positionSec,
      params: Object.freeze(exposed(values)),
    });
    this.rememberManual();
  }
  /** Clear host-owned selection and manual state without unlocking or starting audio. */
  reset(): Promise<void> {
    const stopped = this.stop();
    this.manualStates.clear();
    this.active = null;
    this.update({
      identity: null,
      kind: null,
      playing: false,
      positionSec: 0,
      durationSec: 0,
      params: Object.freeze({}),
      manual: null,
      controlsWritable: false,
      error: null,
    });
    return stopped;
  }

  setVolume(value: number): void {
    this.audio.setMasterVolume(value);
    this.update({ volume: this.audio.getMasterVolume() });
  }
  createProgram(artifact: PreparedProgram, compositionId = artifact.identity): Program {
    const selected = (): boolean => this.snapshot.identity === artifact.identity;
    const driver: ProgramPlaybackDriver = {
      play: () => this.activate(artifact, { play: true }),
      seek: (beat) =>
        selected() && this.snapshot.playing
          ? this.seek((beat * 60) / artifact.manifest.bpm)
          : this.activate(artifact, { play: true, startSec: (beat * 60) / artifact.manifest.bpm }),
      stop: () =>
        selected() && this.snapshot.playing ? this.stop(artifact.identity) : Promise.resolve(),
      isPlaying: () => selected() && this.snapshot.playing,
      subscribe: (listener) => {
        const notify = (): void => {
          const seconds = selected() ? this.snapshot.positionSec : 0;
          const beat = (seconds * artifact.manifest.bpm) / 60;
          const sectionIndex = sectionIndexAtBeat(artifact.manifest.sections, beat);
          listener({
            state: selected() && this.snapshot.playing ? "playing" : "idle",
            beat,
            durationBeats: artifact.manifest.durationBeats,
            elapsedSec: seconds,
            durationSec: duration(artifact),
            progress: duration(artifact) > 0 ? Math.min(1, seconds / duration(artifact)) : 0,
            sectionIndex,
            sectionName: sectionIndex >= 0 ? artifact.manifest.sections[sectionIndex].name : null,
            sectionCount: artifact.manifest.sections.length,
          });
        };
        notify();
        return this.subscribe(notify);
      },
    };
    return new Program(
      this.programTransport,
      compositionId,
      artifact.name,
      artifact.manifest,
      new Map(artifact.synthdefs),
      driver
    );
  }

  synthDriver(artifact: PreparedSynth): SynthPlaybackDriver {
    const selected = (): boolean => this.snapshot.identity === artifact.identity;
    return {
      play: () => this.activate(artifact, { play: true }),
      stop: () => {
        if (selected() && this.snapshot.playing) void this.stop(artifact.identity).catch(() => {});
      },
      setParams: (params) => {
        if (selected() && this.snapshot.playing)
          for (const [name, value] of Object.entries(params))
            void this.writeParam(name, value).catch(() => {});
      },
      getAllParams: () => (selected() ? { ...this.snapshot.params } : {}),
      isPlaying: () => selected() && this.snapshot.playing,
      subscribe: (listener) => {
        const notify = (): void =>
          listener({
            playing: selected() && this.snapshot.playing,
            synthName: selected() ? artifact.name : null,
            paramValues: selected() ? { ...this.snapshot.params } : {},
          });
        notify();
        return this.subscribe(notify);
      },
      crossfadeIn: (seconds) => this.crossfade(artifact, seconds),
      isCrossfading: () => selected() && this.audio.isCrossfading(),
    };
  }

  async crossfade(artifact: PreparedSynth, seconds = 3): Promise<void> {
    const token = ++this.generation;
    this.score.cancel();
    this.clearTicker();
    await this.enqueue(async () => {
      if (token !== this.generation) return;
      await this.audio.init();
      if (token !== this.generation) return;
      if (this.program) await this.program.stop();
      for (const sample of artifact.samples)
        await this.audio.loadSampleFromData(sample.bufferNum, sample.data);
      this.programTransport.invalidateDefinitions();
      await this.audio.loadSynthdefFromData(artifact.synthdef);
      if (token !== this.generation) return;
      this.active = artifact;
      this.update({
        identity: artifact.identity,
        kind: "synth",
        controlsWritable: artifact.controlsWritable,
        manual: null,
        params: Object.freeze(defaults(artifact)),
        durationSec: duration(artifact),
        positionSec: 0,
        error: null,
      });
      await this.audio.crossfadeTo(artifact.name, seconds, defaults(artifact).amp ?? 0.3);
      if (token !== this.generation) {
        this.audio.stop();
        return;
      }
      this.programTransport.replaceDefinitions([artifact.name]);
      this.loadedIdentity = artifact.identity;
      this.update({ playing: true });
      this.startScore(artifact, 0);
    });
  }
}
