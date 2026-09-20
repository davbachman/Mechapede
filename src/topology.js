/** Horizontal coordinates on the cylinder; vertical coordinates remain bounded. */
export function wrapX(x, width = 240) {
  return x >= 0 && x < width ? x : ((x % width) + width) % width;
}

/** Signed shortest horizontal displacement, in [-width / 2, width / 2). */
export function wrappedDelta(dx, width = 240) {
  return dx - width * Math.floor((dx + width / 2) / width);
}
