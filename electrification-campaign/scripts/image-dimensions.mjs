// A viewBox defines coordinates, NOT a reliable HTMLImageElement pixel size.
// For images paired with masks require explicit width/height on the SVG root.
export function imageDimensions(data, extension) {
  if (extension === '.png') {
    if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
      throw new Error('Invalid PNG header');
    }
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  if (extension === '.svg') {
    const root = /<svg\b[^>]*>/i.exec(data.toString('utf8'))?.[0];
    if (!root) throw new Error('Invalid SVG: missing root element');
    const size = name => {
      const attr = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(root)?.[1];
      const match = attr && /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(attr);
      if (!match) return null;
      const value = Number(match[1]);
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    const w = size('width'), h = size('height');
    return w && h ? [w, h] : null;
  }
  return null;
}
export function assertSameDimensions(a, b, name) {
  if (!a || !b) {
    throw new Error(`Cannot verify image dimensions: ${name}. For SVG map/mask files, set explicit integer width and height in pixels; a viewBox alone is not enough.`);
  }
  if (a[0] !== b[0] || a[1] !== b[1]) {
    throw new Error(`Image dimensions differ: ${name}: ${a[0]} x ${a[1]} vs ${b[0]} x ${b[1]}`);
  }
}
