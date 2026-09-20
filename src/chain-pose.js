import { wrapX, wrappedDelta } from "./topology.js";

/** Art articulation only. The simulation retains the original link centers,
 * path, turn timing and hitboxes. A tracked unit seats against the tooth ring for the
 * middle of an arcade turn, then returns to its ordinary path. */
export function chainPoses(section, gears = [], variant = "classic") {
  const cylinder = variant === "cylinder";
  const deltaX = (dx) => (cylinder ? wrappedDelta(dx) : dx);
  const links = (section.links || []).map((link, i) => {
    let x = link.x,
      y = link.y;
    if (link.turning) {
      let nearest = null,
        distance = 15;
      for (const gear of gears) {
        const d = Math.hypot(deltaX(gear.x - x), gear.y - y);
        if (d > 4 && d < distance) {
          nearest = gear;
          distance = d;
        }
      }
      if (nearest) {
        const seat = Math.min(
          2.2 * Math.sin((link.turning.progress * Math.PI) / 8),
          Math.max(0, distance - 6.7),
        );
        x += (deltaX(nearest.x - x) / distance) * seat;
        y += ((nearest.y - y) / distance) * seat;
      }
    }
    return { ...link, x: cylinder ? wrapX(x) : x, y, head: i === 0 };
  });
  return links.map((link, i) => {
    const dx = Math.cos(link.angle || 0) * 4;
    const dy = Math.sin(link.angle || 0) * 4;
    const front = links[i - 1] || { x: link.x + dx, y: link.y + dy };
    const back = links[i + 1] || { x: link.x - dx, y: link.y - dy };
    return {
      ...link,
      angle: Math.atan2(
        front.y - back.y,
        cylinder
          ? deltaX(front.x - link.x) - deltaX(back.x - link.x)
          : front.x - back.x,
      ),
    };
  });
}
