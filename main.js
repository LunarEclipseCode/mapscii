/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>
  Discover the planet in your console!
*/
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { Mapscii } from './src/Mapscii.js';
import config from './src/config.js';

const urlParams = new URLSearchParams(window.location.search);

const options = {
  initialLat: parseFloat(urlParams.get('lat')) || config.initialLat,
  initialLon: parseFloat(urlParams.get('lon')) || config.initialLon,
  initialZoom: parseFloat(urlParams.get('zoom')) || config.initialZoom,
  size: {
    width: parseInt(urlParams.get('width')) || null,
    height: parseInt(urlParams.get('height')) || null
  },
  source: config.source,
  styleFile: config.styleFile,
};

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  const terminalContainer = document.getElementById('terminal');
  if (!terminalContainer) {
    console.error('Terminal container element not found.');
    return;
  }

  const terminalConfig = {
    fontSize: 16,
    cursorBlink: false,
    theme: {
      background: '#000000',
      foreground: '#ffffff',
    },
    convertEol: true,
  };

  // When scrollback is enabled, zooming in/out via trackpad is buggy on firefox
  if (!!window.chrome) {
    terminalConfig.scrollback = false;
  }

  const terminal = new Terminal(terminalConfig);

  // Fit addon for responsive sizing
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  try {
    const webglAddon = new WebglAddon();
    terminal.loadAddon(webglAddon);
  } catch (e) {
    console.warn('WebGL addon failed to load, falling back to canvas renderer');
  }
    
  terminal.open(terminalContainer);
  fitAddon.fit();

  let mapscii;

  // Debounced resize handler to prevent excessive redraws
  const debouncedResize = debounce(() => {
    fitAddon.fit();
    if (mapscii) {
      // Clear terminal before resize operations
      terminal.clear();
      mapscii._resizeHandler();
      mapscii._draw();
    }
  }, 150);

  window.addEventListener('resize', debouncedResize);

  try {
    // Create and initialize MapSCII
    mapscii = new Mapscii(options, terminal);
    await mapscii.init();
    
  } catch (error) {
    console.error('Failed to start MapSCII:', error);
    terminal.write(`\r\n\x1b[31mFailed to start MapSCII: ${error.message}\x1b[0m\r\n`);
  }
});