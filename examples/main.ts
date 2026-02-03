/**
 * Underscore SDK - Hello World Example
 * 
 * This minimal example demonstrates ALL SDK capabilities:
 * - Initialize audio engine
 * - Load and play synths
 * - Real-time parameter control
 * - Generate new synths with AI
 * - Mute/unmute
 * - Error handling
 */

import { Underscore, Synth, ApiError, AudioError, SynthError, ValidationError } from '@underscore/sdk';

// DOM elements
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const compositionIdInput = document.getElementById('compositionId') as HTMLInputElement;
const initBtn = document.getElementById('initBtn') as HTMLButtonElement;
const loadBtn = document.getElementById('loadBtn') as HTMLButtonElement;
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
const paramsDiv = document.getElementById('params') as HTMLDivElement;
const statusSpan = document.getElementById('status') as HTMLSpanElement;
const logDiv = document.getElementById('log') as HTMLDivElement;

// State
let client: Underscore | null = null;
let synth: Synth | null = null;
let isMuted = false;

// Logging
type LogType = 'info' | 'error' | 'warn';

function log(message: string, type: LogType = 'info'): void {
  const line = document.createElement('div');
  line.className = `log-${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
}

function setStatus(text: string, className = ''): void {
  statusSpan.textContent = text;
  statusSpan.className = className;
}

// Error handling helper
function handleError(error: unknown, context: string): void {
  if (error instanceof ApiError) {
    log(`API Error (${error.status}): ${error.message}`, 'error');
  } else if (error instanceof ValidationError) {
    log(`Validation Error: ${error.message}`, 'error');
  } else if (error instanceof AudioError) {
    log(`Audio Error: ${error.message}`, 'error');
  } else if (error instanceof SynthError) {
    log(`Synth Error: ${error.message}`, 'error');
  } else if (error instanceof Error) {
    log(`${context}: ${error.message}`, 'error');
  } else {
    log(`${context}: Unknown error`, 'error');
  }
  setStatus('Error', 'error');
}

// Initialize the SDK client
initBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    log('Please enter an API key', 'warn');
    return;
  }

  try {
    log('Creating Underscore client...');
    const host = import.meta.env.VITE_UNDERSCORE_HOST || 'https://underscore.audio';
    log(`Using host: ${host}`);
    
    client = new Underscore({
      apiKey,
      wasmBaseUrl: '/supersonic/',
      baseUrl: host,
      logLevel: 'info',
    });

    log('Initializing audio engine...');
    await client.init();
    
    log('Audio engine initialized!', 'info');
    setStatus('Ready', 'ready');
    
    // Enable buttons
    loadBtn.disabled = false;
    generateBtn.disabled = false;
    initBtn.disabled = true;
    
  } catch (error) {
    handleError(error, 'Initialization failed');
  }
});

// Load a synth
loadBtn.addEventListener('click', async () => {
  const compositionId = compositionIdInput.value.trim();
  if (!compositionId) {
    log('Please enter a composition ID', 'warn');
    return;
  }

  if (!client) {
    log('Client not initialized', 'error');
    return;
  }

  try {
    log(`Loading synth from ${compositionId}...`);
    loadBtn.disabled = true;
    
    synth = await client.loadSynth(compositionId);
    
    log(`Loaded: ${synth.name}`, 'info');
    log(`Description: ${synth.description}`);
    log(`Parameters: ${synth.params.map(p => p.name).join(', ')}`);
    
    // Enable playback
    playBtn.disabled = false;
    resetBtn.disabled = false;
    
    // Render parameter controls
    renderParams();
    
  } catch (error) {
    handleError(error, 'Load failed');
    loadBtn.disabled = false;
  }
});

// Play
playBtn.addEventListener('click', async () => {
  if (!synth) return;
  
  try {
    log('Playing...');
    await synth.play();
    setStatus('Playing', 'playing');
    
    playBtn.disabled = true;
    stopBtn.disabled = false;
    muteBtn.disabled = false;
    loadBtn.disabled = true;
    
  } catch (error) {
    handleError(error, 'Play failed');
  }
});

// Stop
stopBtn.addEventListener('click', () => {
  if (!synth) return;
  
  log('Stopped');
  synth.stop();
  setStatus('Ready', 'ready');
  
  playBtn.disabled = false;
  stopBtn.disabled = true;
  muteBtn.disabled = true;
  loadBtn.disabled = false;
  isMuted = false;
  muteBtn.textContent = 'Mute';
});

// Mute/Unmute
muteBtn.addEventListener('click', () => {
  if (!synth) return;
  
  if (isMuted) {
    synth.play();
    muteBtn.textContent = 'Mute';
    log('Unmuted');
  } else {
    synth.stop();
    muteBtn.textContent = 'Unmute';
    log('Muted');
  }
  isMuted = !isMuted;
});

// Reset parameters
resetBtn.addEventListener('click', () => {
  if (!synth) return;
  
  synth.resetParams();
  renderParams();
  log('Parameters reset to defaults');
});

// Render parameter sliders
function renderParams(): void {
  if (!synth) {
    paramsDiv.innerHTML = '<p style="color: #666; font-size: 13px;">Load a synth to see parameters</p>';
    return;
  }

  paramsDiv.innerHTML = '';
  
  for (const param of synth.params) {
    const div = document.createElement('div');
    div.className = 'param';
    
    const label = document.createElement('label');
    label.textContent = param.name;
    
    const input = document.createElement('input');
    input.type = 'range';
    input.min = param.min.toString();
    input.max = param.max.toString();
    input.step = ((param.max - param.min) / 100).toString();
    input.value = param.default.toString();
    
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = param.default.toFixed(2);
    
    input.addEventListener('input', () => {
      const val = parseFloat(input.value);
      synth?.setParam(param.name, val);
      value.textContent = val.toFixed(2);
    });
    
    div.appendChild(label);
    div.appendChild(input);
    div.appendChild(value);
    paramsDiv.appendChild(div);
  }
}

// Generate new synth
generateBtn.addEventListener('click', async () => {
  const compositionId = compositionIdInput.value.trim();
  const prompt = promptInput.value.trim();
  
  if (!compositionId) {
    log('Please enter a composition ID', 'warn');
    return;
  }
  if (!prompt) {
    log('Please enter a description', 'warn');
    return;
  }

  if (!client) {
    log('Client not initialized', 'error');
    return;
  }

  try {
    log(`Generating: "${prompt.slice(0, 50)}..."`);
    generateBtn.disabled = true;
    
    // Stop current synth if playing
    if (synth && synth.isPlaying()) {
      synth.stop();
    }
    
    // Stream generation events
    for await (const event of client.generate(compositionId, prompt)) {
      switch (event.type) {
        case 'thinking':
          // AI reasoning (optional to show)
          break;
        case 'progress':
          log(`Phase: ${event.content}`);
          break;
        case 'code':
          // Generated SuperCollider code (optional to show)
          break;
        case 'ready':
          log(`Generated: ${event.synth.name}`, 'info');
          synth = event.synth;
          renderParams();
          
          // Auto-play the new synth
          await synth.play();
          setStatus('Playing', 'playing');
          playBtn.disabled = true;
          stopBtn.disabled = false;
          muteBtn.disabled = false;
          loadBtn.disabled = true;
          break;
        case 'error':
          log(`Generation failed: ${event.error}`, 'error');
          break;
      }
    }
    
  } catch (error) {
    handleError(error, 'Generation failed');
  } finally {
    generateBtn.disabled = false;
  }
});

// Load values from environment or localStorage
apiKeyInput.value = import.meta.env.VITE_UNDERSCORE_API_KEY || localStorage.getItem('underscore-api-key') || '';
compositionIdInput.value = import.meta.env.VITE_UNDERSCORE_COMPOSITION_ID || localStorage.getItem('underscore-composition-id') || '';

// Save values on change
apiKeyInput.addEventListener('change', () => {
  localStorage.setItem('underscore-api-key', apiKeyInput.value);
});
compositionIdInput.addEventListener('change', () => {
  localStorage.setItem('underscore-composition-id', compositionIdInput.value);
});

// Log startup info
if (import.meta.env.VITE_UNDERSCORE_HOST) {
  log(`Using custom host: ${import.meta.env.VITE_UNDERSCORE_HOST}`, 'info');
}
log('Ready. Enter your API key and click "Initialize Audio".');
