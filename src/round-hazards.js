import { wrappedDelta } from "./topology.js";

// Logical pixels are taller than they are wide on the 3:4 board. Use the same
// metric for circular collision geometry as the renderer uses for round hardware.
export const ROUND_Y = 0.8;

export function sweepCircle(x, y, dx, dy, radius) {
  const length = dx * dx + dy * dy;
  const outside = x * x + y * y - radius * radius;
  if (outside <= 0) return 0;
  if (!length) return null;
  const dot = x * dx + y * dy;
  const discriminant = dot * dot - length * outside;
  if (discriminant < 0) return null;
  const t = (-dot - Math.sqrt(discriminant)) / length;
  return t >= 0 && t <= 1 ? t : null;
}

export function roundTouchesRect(entity, radius, x, y, halfWidth, halfHeight) {
  const dx = Math.max(0, Math.abs(wrappedDelta(entity.x - x)) - halfWidth);
  const dy = Math.max(0, Math.abs(entity.y - y) - halfHeight) / ROUND_Y;
  return dx * dx + dy * dy < radius * radius;
}

export function shotHitsRound(entity, radius, x, previousY, y) {
  return sweepCircle(wrappedDelta(x - entity.x), (previousY - entity.y) / ROUND_Y,
    0, (y - previousY) / ROUND_Y, radius + 0.65) !== null;
}
