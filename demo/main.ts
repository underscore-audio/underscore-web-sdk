import { Underscore, Synth, SynthMetadata } from '@underscore/sdk';

// State
let client: Underscore | null = null;
let currentSynth: Synth | null = null;
let compositionId: string | null = null;

// DOM elements
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const compositionIdInput = document.getElementById('compositionId') as HTMLInputElement;
const initBtn = document.getElementById('initBtn') as HTMLButtonElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const synthsSection = document.getElementById('synthsSection') as HTMLElement;
const synthList = document.getElementById('synthList') as HTMLElement;
const playerSection = document.getElementById('playerSection') as HTMLElement;
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const paramsGrid = document.getElementById('paramsGrid') as HTMLElement;
const generateSection = document.getElementById('generateSection') as HTMLElement;
const generatePrompt = document.getElementById('generatePrompt') as HTMLTextAreaElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const generationOutput = document.getElementById('generationOutput') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;

type LogType = 'message' | 'success' | 'error';

// Logging
function log(message: string, type: LogType = 'message'): void {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-${type}">${message}</span>
  `;
  
  if (logEl.querySelector('.empty-state')) {
    logEl.innerHTML = '';
  }
  
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
}

type StatusState = 'default' | 'connected' | 'playing';

// Update status
function setStatus(text: string, state: StatusState = 'default'): void {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  if (state === 'playing') statusDot.classList.add('playing');
}

// Initialize SDK
async function initialize(): Promise<void> {
  const apiKey = apiKeyInput.value.trim();
  compositionId = compositionIdInput.value.trim();

  if (!apiKey) {
    log('API key is required', 'error');
    return;
  }

  if (!compositionId) {
    log('Composition ID is required', 'error');
    return;
  }

  log('Initializing SDK...');
  initBtn.disabled = true;

  try {
    client = new Underscore({
      apiKey,
      wasmBaseUrl: '/supersonic/',
      baseUrl: 'https://underscore.audio',
    });

    // Initialize audio (requires user interaction)
    await client.init();
    log('Audio engine initialized', 'success');
    setStatus('Connected', 'connected');

    // Load synths
    await loadSynths();

    // Show sections
    synthsSection.style.display = 'block';
    generateSection.style.display = 'block';

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Initialization failed: ${message}`, 'error');
    setStatus('Error');
    initBtn.disabled = false;
  }
}

// Load synths list
async function loadSynths(): Promise<void> {
  if (!client || !compositionId) return;
  
  log('Loading synths...');
  
  try {
    const synths = await client.listSynths(compositionId);
    
    if (synths.length === 0) {
      synthList.innerHTML = '<div class="empty-state">No synths found in this composition</div>';
      log('No synths found');
      return;
    }

    synthList.innerHTML = synths.map(s => `
      <div class="synth-item" data-name="${s.name}">
        <div>
          <div class="synth-name">${s.name}</div>
          <div class="synth-desc">${s.description || 'No description'}</div>
        </div>
        <button class="load-btn">Load</button>
      </div>
    `).join('');

    // Add click handlers
    synthList.querySelectorAll('.load-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const item = target.closest('.synth-item') as HTMLElement;
        const name = item.dataset.name;
        if (name) loadSynth(name);
      });
    });

    log(`Loaded ${synths.length} synth(s)`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to load synths: ${message}`, 'error');
    synthList.innerHTML = `<div class="empty-state">Error: ${message}</div>`;
  }
}

// Load a specific synth
async function loadSynth(name: string): Promise<void> {
  if (!client || !compositionId) return;
  
  log(`Loading synth: ${name}...`);

  try {
    // Stop current synth if playing
    if (currentSynth?.isPlaying()) {
      currentSynth.stop();
    }

    currentSynth = await client.loadSynth(compositionId, name);
    log(`Synth loaded: ${name}`, 'success');

    // Update UI
    synthList.querySelectorAll('.synth-item').forEach(el => {
      const item = el as HTMLElement;
      item.classList.toggle('selected', item.dataset.name === name);
    });

    // Show player
    playerSection.style.display = 'block';
    playBtn.disabled = false;
    stopBtn.disabled = true;
    resetBtn.disabled = false;

    // Build params UI
    buildParamsUI();

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Failed to load synth: ${message}`, 'error');
  }
}

// Build parameter controls
function buildParamsUI(): void {
  if (!currentSynth) return;

  const params = currentSynth.params;
  
  if (params.length === 0) {
    paramsGrid.innerHTML = '<div class="empty-state">No controllable parameters</div>';
    return;
  }

  paramsGrid.innerHTML = params.map(p => `
    <div class="param-row" data-param="${p.name}">
      <div class="param-header">
        <span class="param-name">${p.name}</span>
        <span class="param-value">${p.default.toFixed(2)}</span>
      </div>
      <input 
        type="range" 
        min="${p.min}" 
        max="${p.max}" 
        step="${(p.max - p.min) / 100}"
        value="${p.default}"
        data-param="${p.name}"
      />
      <div class="param-desc">${p.description} (${p.min} - ${p.max})</div>
    </div>
  `).join('');

  // Add change handlers
  paramsGrid.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const name = target.dataset.param;
      const value = parseFloat(target.value);
      
      if (!name) return;
      
      // Update display
      const row = target.closest('.param-row') as HTMLElement;
      const valueEl = row?.querySelector('.param-value');
      if (valueEl) valueEl.textContent = value.toFixed(2);
      
      // Update synth
      if (currentSynth) {
        currentSynth.setParam(name, value);
      }
    });
  });
}

// Play
async function play(): Promise<void> {
  if (!currentSynth) return;

  try {
    await currentSynth.play();
    log(`Playing: ${currentSynth.name}`, 'success');
    setStatus('Playing', 'playing');
    playBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Play failed: ${message}`, 'error');
  }
}

// Stop
function stop(): void {
  if (!currentSynth) return;

  currentSynth.stop();
  log('Stopped');
  setStatus('Connected', 'connected');
  playBtn.disabled = false;
  stopBtn.disabled = true;
}

// Reset params
function resetParams(): void {
  if (!currentSynth) return;

  currentSynth.resetParams();
  log('Parameters reset to defaults');

  // Update UI
  currentSynth.params.forEach(p => {
    const row = paramsGrid.querySelector(`[data-param="${p.name}"]`) as HTMLElement;
    if (row) {
      const input = row.querySelector('input') as HTMLInputElement;
      const valueEl = row.querySelector('.param-value');
      if (input) input.value = p.default.toString();
      if (valueEl) valueEl.textContent = p.default.toFixed(2);
    }
  });
}

// Generate new synth
async function generate(): Promise<void> {
  if (!client || !compositionId) return;
  
  const prompt = generatePrompt.value.trim();
  
  if (!prompt) {
    log('Please enter a description', 'error');
    return;
  }

  log(`Starting generation: "${prompt.substring(0, 50)}..."`);
  generateBtn.disabled = true;
  generationOutput.style.display = 'block';
  generationOutput.textContent = '';

  try {
    for await (const event of client.generate(compositionId, prompt)) {
      switch (event.type) {
        case 'thinking':
          generationOutput.textContent += event.content;
          break;
        case 'progress':
          log(`Generation phase: ${event.content}`);
          break;
        case 'code':
          generationOutput.textContent += event.content;
          break;
        case 'ready':
          log(`Generation complete: ${event.synth.name}`, 'success');
          currentSynth = event.synth;
          await loadSynths();
          buildParamsUI();
          playerSection.style.display = 'block';
          playBtn.disabled = false;
          
          // Auto-play the new synth
          await play();
          break;
        case 'error':
          log(`Generation error: ${event.error}`, 'error');
          break;
      }
      generationOutput.scrollTop = generationOutput.scrollHeight;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Generation failed: ${message}`, 'error');
  } finally {
    generateBtn.disabled = false;
  }
}

// Event listeners
initBtn.addEventListener('click', initialize);
playBtn.addEventListener('click', play);
stopBtn.addEventListener('click', stop);
resetBtn.addEventListener('click', resetParams);
generateBtn.addEventListener('click', generate);

// Allow Enter key to initialize
compositionIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') initialize();
});

// Log startup
log('Demo ready. Enter your API key and composition ID to begin.');
