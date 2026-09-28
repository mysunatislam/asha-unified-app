// Associate by wrist position, not handedness alone. Model labels can briefly duplicate.
export class HandTracks {
  constructor() {
    this.tracks = [];
    this.next = 1;
  }
  update(hands, t) {
    const old = this.tracks.filter((x) => t - x.t < 1000),
      used = new Set();
    const result = hands.map((h) => {
      let best = null,
        distance = 0.25;
      for (const p of old) {
        if (used.has(p.id)) continue;
        const d = Math.hypot(h.lm[0].x - p.x, h.lm[0].y - p.y);
        if (d < distance) {
          distance = d;
          best = p;
        }
      }
      const id = best?.id || "hand-" + this.next++;
      used.add(id);
      return { ...h, id };
    });
    this.tracks = result.map((h) => ({
      id: h.id,
      x: h.lm[0].x,
      y: h.lm[0].y,
      t,
    }));
    return result;
  }
}
