/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
*/
import { Renderer } from './Renderer.js';
import { TileSource } from './TileSource.js';
import { utils } from './utils.js';
import config from './config.js';

export class Mapscii {
  constructor(options = {}, terminal) {
    this.terminal = terminal;
    this.width = null;
    this.height = null;
    this.canvas = null;
    this.mouseDragging = false;
    this.mousePosition = {
      x: 0,
      y: 0,
    };

    // Mouse control variables
    this.allowClickToCenter = true;
    this.allowDragging = false;
    this.allowMouseZoom = false;

    this.tileSource = null;
    this.renderer = null;

    this.zoom = 0;
    this.minZoom = null;
    
    Object.assign(config, options);

    this.center = {
      lat: config.initialLat,
      lon: config.initialLon
    };

    config.input = this.terminal;
    config.output = this.terminal;
  }

  async init() {
    this._initKeyboard();
    this._initMouse();
    this._initTileSource();
    await this._initRenderer();
    this._resizeHandler();
    this._draw();
    this.notify('Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, q to quit.');
  }

  _initTileSource() {
    this.tileSource = new TileSource();
    this.tileSource.init(config.source);
  }

  _initKeyboard() {
    this.terminal.onKey(({ key, domEvent }) => {
      this._onKey({
        name: this._translateKey(domEvent.key, domEvent),
        ctrl: domEvent.ctrlKey,
        meta: domEvent.metaKey,
        shift: domEvent.shiftKey
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && (event.key === '+' || event.key === '=' || event.key === '-')) {
        event.preventDefault();
        if (event.key === '+' || event.key === '=') {
          this.zoomBy(config.zoomStep);
          this._draw();
        } else if (event.key === '-') {
          this.zoomBy(-config.zoomStep);
          this._draw();
        }
      }
    });

    this.terminal.focus();
  }

  _translateKey(key, domEvent) {
    switch (key) {
      case 'ArrowUp': return 'up';
      case 'ArrowDown': return 'down';
      case 'ArrowLeft': return 'left';
      case 'ArrowRight': return 'right';
      default: return key.toLowerCase();
    }
  }

  _initMouse() {
    this.terminal.onSelectionChange(() => {
      // Disable text selection to allow for mouse dragging
    });

    // Handle mouse events
    this.terminal.element.addEventListener('mousedown', (event) => this._onMouseDown(event));
    this.terminal.element.addEventListener('mouseup', (event) => this._onMouseUp(event));
    this.terminal.element.addEventListener('mousemove', (event) => this._onMouseMove(event));
    this.terminal.element.addEventListener('wheel', (event) => this._onMouseScroll(event));
    this.terminal.element.addEventListener('click', (event) => this._onClick(event));
  }

  async _initRenderer() {
    try {
      const response = await fetch(config.styleFile);
      const style = await response.json();
      this.renderer = new Renderer(this.terminal, this.tileSource, style);

      this._resizeHandler();
      this.zoom = (config.initialZoom !== null) ? config.initialZoom : this.minZoom;
    } catch (error) {
      console.error('Failed to load style:', error);
      throw error;
    }
  }

  _resizeHandler() {
    // Reserve space for status messages
    const reservedRows = 1;
    const usableRows = Math.max(1, this.terminal.rows - reservedRows);
    
    // Use terminal dimensions
    this.width = config.size && config.size.width ? config.size.width * 2 : this.terminal.cols * 2;
    this.height = config.size && config.size.height ? config.size.height * 4 : usableRows * 4;

    this.minZoom = 4 - Math.log(4096 / this.width) / Math.LN2;

    if (this.renderer) {
      this.renderer.setSize(this.width, this.height);
    }
  }

  _getMousePosition(event) {
    const rect = this.terminal.element.getBoundingClientRect();
    const charWidth = rect.width / this.terminal.cols;
    const charHeight = rect.height / this.terminal.rows;
    
    const x = Math.floor((event.clientX - rect.left) / charWidth);
    const y = Math.floor((event.clientY - rect.top) / charHeight);
    return { x, y };
  }

  _colrow2ll(x, y) {
    const projected = {
      x: (x-0.5)*2,
      y: (y-0.5)*4,
    };

    const size = utils.tilesizeAtZoom(this.zoom);
    const [dx, dy] = [projected.x-this.width/2, projected.y-this.height/2];

    const z = utils.baseZoom(this.zoom);
    const center = utils.ll2tile(this.center.lon, this.center.lat, z);

    return utils.normalize(utils.tile2ll(center.x+(dx/size), center.y+(dy/size), z));
  }

  _updateMousePosition(event) {
    const mousePos = this._getMousePosition(event);
    this.mousePosition = this._colrow2ll(mousePos.x, mousePos.y);
  }

  _onClick(event) {
    // Check if click to center is enabled
    if (!this.allowClickToCenter) {
      return;
    }

    const mousePos = this._getMousePosition(event);
    if (mousePos.x < 0 || mousePos.x > this.width / 2 || mousePos.y < 0 || mousePos.y > this.height / 4) {
      return;
    }
    this._updateMousePosition(event);

    if (this.mouseDragging && event.button === 0) {
      this.mouseDragging = false;
    } else {
      this.setCenter(this.mousePosition.lat, this.mousePosition.lon);
    }

    this._draw();
  }

  _onMouseDown(event) {
    if (!this.allowDragging) {
      return;
    }

    if (event.button === 0) {
      const mousePos = this._getMousePosition(event);
      this.mouseDragging = {
        x: mousePos.x,
        y: mousePos.y,
        center: utils.ll2tile(this.center.lon, this.center.lat, utils.baseZoom(this.zoom)),
      };
    }
  }

  _onMouseUp(event) {
    if (!this.allowDragging) {
      return;
    }

    if (event.button === 0) {
      this.mouseDragging = false;
    }
  }

  _onMouseScroll(event) {
    // Check if mouse zoom is enabled
    if (!this.allowMouseZoom) {
      return;
    }

    event.preventDefault();
    this._updateMousePosition(event);

    const mousePos = this._getMousePosition(event);

    // the location of the pointer, where we want to zoom toward
    const targetMouseLonLat = this._colrow2ll(mousePos.x, mousePos.y);

    // zoom toward the center
    this.zoomBy(config.zoomStep * (event.deltaY < 0 ? 1 : -1));

    // the location the pointer ended up after zooming
    const offsetMouseLonLat = this._colrow2ll(mousePos.x, mousePos.y);

    const z = utils.baseZoom(this.zoom);
    // the projected locations
    const targetMouseTile = utils.ll2tile(targetMouseLonLat.lon, targetMouseLonLat.lat, z);
    const offsetMouseTile = utils.ll2tile(offsetMouseLonLat.lon, offsetMouseLonLat.lat, z);

    // the projected center
    const centerTile = utils.ll2tile(this.center.lon, this.center.lat, z);

    // calculate a new center that puts the pointer back in the target location
    const offsetCenterLonLat = utils.tile2ll(
      centerTile.x - (offsetMouseTile.x - targetMouseTile.x),
      centerTile.y - (offsetMouseTile.y - targetMouseTile.y),
      z
    );
    // move to the new center
    this.setCenter(offsetCenterLonLat.lat, offsetCenterLonLat.lon);

    this._draw();
  }

  _onMouseMove(event) {
    const mousePos = this._getMousePosition(event);
    if (mousePos.x < 0 || mousePos.x > this.width / 2 || mousePos.y < 0 || mousePos.y > this.height / 4) {
      return;
    }

    if (this.allowDragging && this.mouseDragging) {
      const dx = (this.mouseDragging.x - mousePos.x) * 2;
      const dy = (this.mouseDragging.y - mousePos.y) * 4;

      const size = utils.tilesizeAtZoom(this.zoom);

      const newCenter = utils.tile2ll(
        this.mouseDragging.center.x + (dx / size),
        this.mouseDragging.center.y + (dy / size),
        utils.baseZoom(this.zoom)
      );

      this.setCenter(newCenter.lat, newCenter.lon);
      this._draw();
    }

    this._updateMousePosition(event);
    this.notify(this._getFooter());
  }

  _onKey(key) {
    if (!key || !key.name) return;

    // check if the pressed key is configured
    let draw = true;
    switch (key.name) {
      case 'a':
        this.zoomBy(config.zoomStep);
        break;
      case 'y':
      case 'z':
        this.zoomBy(-config.zoomStep);
        break;
      case 'left':
      case 'h':
        this.moveBy(0, -8/Math.pow(2, this.zoom));
        break;
      case 'right':
      case 'l':
        this.moveBy(0, 8/Math.pow(2, this.zoom));
        break;
      case 'up':
      case 'k':
        this.moveBy(6/Math.pow(2, this.zoom), 0);
        break;
      case 'down':
      case 'j':
        this.moveBy(-6/Math.pow(2, this.zoom), 0);
        break;
      case 'c':
        config.useBraille = !config.useBraille;
        break;
      default:
        draw = false;
    }

    if (draw) {
      this._draw();
    }
  }

  _draw() {
    this.renderer.draw(this.center, this.zoom).then((frame) => {
      this._write(frame);
      this.notify(this._getFooter());
    }).catch(() => {
      this.notify('renderer is busy');
    });
  }

  _getFooter() {
    // tile = utils.ll2tile(this.center.lon, this.center.lat, this.zoom);
    // `tile: ${utils.digits(tile.x, 3)}, ${utils.digits(tile.x, 3)}   `+

    let footer = `center: ${utils.digits(this.center.lat, 3)}, ${utils.digits(this.center.lon, 3)} `;
    footer += `  zoom: ${utils.digits(this.zoom, 2)} `;
    // if (this.mousePosition && this.mousePosition.lat !== undefined) {
    //   footer += `  mouse: ${utils.digits(this.mousePosition.lat, 3)}, ${utils.digits(this.mousePosition.lon, 3)} `;
    // }
    return footer;
  }

  notify(text) {
    // Position cursor at bottom of screen for status messages
    const statusRow = Math.floor(this.height / 4) + 1; // Move to row after map area
    this._write(`\x1B[${statusRow};1H\x1B[K${text}`); // Position cursor and clear line
  }

  _write(output) {
    this.terminal.write(output);
  }

  zoomBy(step) {
    if (this.zoom+step < this.minZoom) {
      return this.zoom = this.minZoom;
    }
    if (this.zoom+step > config.maxZoom) {
      return this.zoom = config.maxZoom;
    }

    this.zoom += step;
  }

  moveBy(lat, lon) {
    this.setCenter(this.center.lat+lat, this.center.lon+lon);
  }

  setCenter(lat, lon) {
    this.center = utils.normalize({
      lon: lon,
      lat: lat,
    });
  }
}