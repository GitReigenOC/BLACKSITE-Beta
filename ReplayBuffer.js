export class ReplayBuffer {
  constructor({ duration = 10, sampleRate = 20 } = {}) {
    this.duration = duration;
    this.sampleInterval = 1000 / sampleRate;
    this.frames = [];
    this.events = [];
    this.playbackStartedAt = 0;
  }

  record(timestamp, state) {
    const newest = this.frames[this.frames.length - 1];
    if (newest && timestamp - newest.timestamp < this.sampleInterval) return false;
    this.frames.push({ timestamp, state: structuredClone(state) });
    const oldestTimestamp = timestamp - this.duration * 1000;
    while (this.frames.length && this.frames[0].timestamp < oldestTimestamp) this.frames.shift();
    while (this.events.length && this.events[0].timestamp < oldestTimestamp) this.events.shift();
    return true;
  }

  recordEvent(timestamp, event) {
    this.events.push({ timestamp, event: structuredClone(event) });
    const oldestTimestamp = timestamp - this.duration * 1000;
    while (this.events.length && this.events[0].timestamp < oldestTimestamp) this.events.shift();
  }

  startPlayback(now = performance.now()) {
    if (this.frames.length < 2) return false;
    this.playbackStartedAt = now;
    return true;
  }

  sample(now = performance.now()) {
    if (!this.playbackStartedAt || this.frames.length < 2) return null;
    const elapsed = now - this.playbackStartedAt;
    const start = this.frames[0].timestamp;
    const end = this.frames[this.frames.length - 1].timestamp;
    const duration = end - start;
    const timestamp = start + Math.min(elapsed, duration);
    let index = 0;
    while (index < this.frames.length - 2 && this.frames[index + 1].timestamp < timestamp) index++;
    const older = this.frames[index];
    const newer = this.frames[index + 1];
    const span = Math.max(1, newer.timestamp - older.timestamp);
    const alpha = Math.min(1, Math.max(0, (timestamp - older.timestamp) / span));
    const lerp = (a, b) => a + (b - a) * alpha;
    const interpolateActor = (earlier, later) => {
      if (!earlier || !later) return earlier || later || null;
      const angleDelta = Math.atan2(
        Math.sin(later.angle - earlier.angle),
        Math.cos(later.angle - earlier.angle)
      );
      const actor = {
        ...earlier,
        x: lerp(earlier.x, later.x),
        y: lerp(earlier.y, later.y),
        angle: earlier.angle + angleDelta * alpha
      };
      for (const key of ["cameraPosition", "cameraDirection"]) {
        if (!earlier[key] || !later[key]) continue;
        actor[key] = {
          x: lerp(earlier[key].x, later[key].x),
          y: lerp(earlier[key].y, later[key].y),
          z: lerp(earlier[key].z, later[key].z)
        };
        if (key === "cameraDirection") {
          const length = Math.hypot(actor[key].x, actor[key].y, actor[key].z) || 1;
          actor[key].x /= length;
          actor[key].y /= length;
          actor[key].z /= length;
        }
      }
      if (Number.isFinite(earlier.fov) && Number.isFinite(later.fov)) {
        actor.fov = lerp(earlier.fov, later.fov);
      }
      if (Number.isFinite(earlier.pitch) && Number.isFinite(later.pitch)) {
        actor.pitch = lerp(earlier.pitch, later.pitch);
      }
      return actor;
    };
    return {
      timestamp,
      finished: elapsed >= duration,
      player: interpolateActor(older.state.player, newer.state.player),
      opponent: interpolateActor(older.state.opponent, newer.state.opponent),
      enemies: older.state.enemies.map(enemy => {
        const laterEnemy = newer.state.enemies.find(item => item.id === enemy.id);
        if (!laterEnemy) return enemy;
        return { ...enemy, x: lerp(enemy.x, laterEnemy.x), y: lerp(enemy.y, laterEnemy.y) };
      })
    };
  }

  getBestEvent() {
    return this.events.findLast?.(({ event }) => event.type === "kill") ||
      [...this.events].reverse().find(({ event }) => event.type === "kill") || null;
  }

  reset() {
    this.frames.length = 0;
    this.events.length = 0;
    this.playbackStartedAt = 0;
  }
}
