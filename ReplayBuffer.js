function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function interpolateAngle(earlier, later, alpha) {
  const delta = Math.atan2(Math.sin(later - earlier), Math.cos(later - earlier));
  return earlier + delta * alpha;
}

function interpolateVector(earlier, later, alpha, angular = false) {
  if (!earlier || !later) return earlier || later || null;
  const result = {};
  for (const axis of ["x", "y", "z"]) {
    if (!Number.isFinite(earlier[axis]) || !Number.isFinite(later[axis])) continue;
    result[axis] = angular
      ? interpolateAngle(earlier[axis], later[axis], alpha)
      : earlier[axis] + (later[axis] - earlier[axis]) * alpha;
  }
  return result;
}

export class ReplayBuffer {
  constructor({ duration = 10, sampleRate = 20 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new RangeError("Replay duration and sample rate must be positive numbers.");
    }
    this.duration = duration;
    this.sampleInterval = 1000 / sampleRate;
    this.frames = [];
    this.events = [];
    this.playbackStartedAt = null;
  }

  record(timestamp, state) {
    if (!Number.isFinite(timestamp) || !state || typeof state !== "object") {
      throw new TypeError("Replay frames require a finite timestamp and an entity state.");
    }
    const newest = this.frames[this.frames.length - 1];
    if (newest && timestamp - newest.timestamp < this.sampleInterval) return false;
    this.frames.push({ timestamp, state: clone(state) });
    const oldestTimestamp = timestamp - this.duration * 1000;
    while (this.frames.length && this.frames[0].timestamp < oldestTimestamp) this.frames.shift();
    while (this.events.length && this.events[0].timestamp < oldestTimestamp) this.events.shift();
    return true;
  }

  recordEvent(timestamp, event) {
    if (!Number.isFinite(timestamp) || !event || typeof event !== "object") {
      throw new TypeError("Replay events require a finite timestamp and event data.");
    }
    this.events.push({ timestamp, event: clone(event) });
    const oldestTimestamp = timestamp - this.duration * 1000;
    while (this.events.length && this.events[0].timestamp < oldestTimestamp) this.events.shift();
  }

  startPlayback(now = performance.now()) {
    if (this.frames.length < 2 || !Number.isFinite(now)) return false;
    this.playbackStartedAt = now;
    return true;
  }

  sample(now = performance.now()) {
    if (this.playbackStartedAt === null || this.frames.length < 2) return null;
    const elapsed = Math.max(0, now - this.playbackStartedAt);
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
      if (!earlier || !later) return clone(earlier || later || null);
      const actor = {
        ...earlier,
        x: Number.isFinite(earlier.x) && Number.isFinite(later.x) ? lerp(earlier.x, later.x) : earlier.x,
        y: Number.isFinite(earlier.y) && Number.isFinite(later.y) ? lerp(earlier.y, later.y) : earlier.y
      };
      if (Number.isFinite(earlier.angle) && Number.isFinite(later.angle)) {
        actor.angle = interpolateAngle(earlier.angle, later.angle, alpha);
      }
      if (earlier.position || later.position) {
        actor.position = interpolateVector(earlier.position, later.position, alpha);
      }
      if (earlier.rotation || later.rotation) {
        actor.rotation = interpolateVector(earlier.rotation, later.rotation, alpha, true);
      }
      for (const key of ["cameraPosition", "cameraDirection"]) {
        if (!earlier[key] || !later[key]) continue;
        actor[key] = interpolateVector(earlier[key], later[key], alpha);
        if (key === "cameraDirection") {
          const length = Math.hypot(actor[key].x, actor[key].y, actor[key].z) || 1;
          actor[key].x /= length;
          actor[key].y /= length;
          actor[key].z /= length;
        }
      }
      if (Number.isFinite(earlier.fov) && Number.isFinite(later.fov)) actor.fov = lerp(earlier.fov, later.fov);
      if (Number.isFinite(earlier.pitch) && Number.isFinite(later.pitch)) actor.pitch = lerp(earlier.pitch, later.pitch);
      const discreteSource = alpha < .5 ? earlier : later;
      for (const key of ["weapon", "weaponId", "animationState", "state"]) {
        if (discreteSource[key] !== undefined) actor[key] = discreteSource[key];
      }
      return actor;
    };
    const earlierEnemies = older.state.enemies || [];
    const laterEnemies = newer.state.enemies || [];
    const earlierById = new Map(earlierEnemies.map(enemy => [enemy.id, enemy]));
    const laterById = new Map(laterEnemies.map(enemy => [enemy.id, enemy]));
    const enemies = [...new Set([...earlierById.keys(), ...laterById.keys()])]
      .map(id => interpolateActor(earlierById.get(id), laterById.get(id)));

    return {
      timestamp,
      finished: elapsed >= duration,
      player: interpolateActor(older.state.player, newer.state.player),
      opponent: interpolateActor(older.state.opponent, newer.state.opponent),
      enemies
    };
  }

  getBestEvent() {
    return this.events.findLast?.(({ event }) => event.type === "kill") ||
      [...this.events].reverse().find(({ event }) => event.type === "kill") || null;
  }

  reset() {
    this.frames.length = 0;
    this.events.length = 0;
    this.playbackStartedAt = null;
  }
}
