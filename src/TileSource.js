/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
*/
import { Tile } from './Tile.js';

const modes = {
  HTTP: 3,
};

export class TileSource {
  init(source) {
    this.source = source;
    
    this.cache = {};
    this.cacheSize = 16;
    this.cached = [];
    
    this.mode = null;
    this.styler = null;
    
    if (this.source.startsWith('http')) {
      this.mode = modes.HTTP;
    } else {
      throw new Error('Only HTTP/HTTPS tile sources are supported.');
    }
  }

  useStyler(styler) {
    this.styler = styler;
  }

  getTile(z, x, y) {
    if (!this.mode) {
      throw new Error('no TileSource defined');
    }
    
    const cached = this.cache[[z, x, y].join('-')];
    if (cached) {
      return Promise.resolve(cached);
    }
    
    if (this.cached.length > this.cacheSize) {
      const overflow = Math.abs(this.cacheSize - this.cache.length);
      for (const tile in this.cached.splice(0, overflow)) {
        delete this.cache[tile];
      }
    }
  
    switch (this.mode) {
      case modes.HTTP:
        return this._getHTTP(z, x, y);
    }
  }

  _getHTTP(z, x, y) {
    const url = this.source + [z, x, y].join('/') + '.pbf';
    
    return fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/x-protobuf',
      },
    })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => {
      return this._createTile(z, x, y, buffer);
    })
    .catch((error) => {
      console.error(`Failed to fetch tile ${z}/${x}/${y}:`, error);
      throw error;
    });
  }

  _createTile(z, x, y, buffer) {
    const name = [z, x, y].join('-');
    this.cached.push(name);
    
    const tile = this.cache[name] = new Tile(this.styler);
    return tile.load(buffer);
  }
}