import { C } from "./constants.js";
import { wrappedDelta } from "./topology.js";

export const gantryFootY = (gantry) => C.GANTRY_PISTON_TOP + gantry.extension;

// Shared by the simulation and artwork: the warning is harmless, but both the
// extended shaft and the wide press foot remain solid until fully retracted.
export function pistonTouches(gantry, x, y, halfWidth = 0, halfHeight = 0) {
  if (gantry.extension <= 0 || gantry.entered === false) return false;
  const dx = Math.abs(wrappedDelta(x - gantry.x));
  const footY = gantryFootY(gantry);
  const stem = dx < C.GANTRY_STEM_HALF_WIDTH + halfWidth &&
    y + halfHeight > C.GANTRY_PISTON_TOP && y - halfHeight < footY;
  const foot = dx < C.GANTRY_FOOT_HALF_WIDTH + halfWidth &&
    Math.abs(y - footY) < 1.5 + halfHeight;
  return stem || foot;
}
