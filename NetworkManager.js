export class NetworkManager {
  constructor({ interpolationDelay = 110, maxSnapshots = 24, maxPredictions = 120 } = {}) {
    this.interpolationDelay = interpolationDelay;
    this.maxSnapshots = maxSnapshots;
    this.maxPredictions = maxPredictions;
    this.sequence = 0;
    this.snapshots = [];
    this.predictions = [];
    this.lastSequence = -1;
    this.lastAuthoritative = null;
    this.lastAuthorityTime = 0;
    this.correction = { x: 0, y: 0 };
  }

  createSnapshot(state) {
    const sequence = ++this.sequence;
    const snapshot = { ...state, sequence };
    this.predictions.push({
      sequence,
      x: state.position.x,
      z: state.position.z
    });
    if (this.predictions.length > this.maxPredictions) this.predictions.shift();
    return snapshot;
  }

  pushSnapshot(snapshot, { maxSpeed = 10, canOccupy = () => true } = {}) {
    if (!Number.isInteger(snapshot.sequence) || snapshot.sequence <= this.lastSequence) return null;
    const now = performance.now();
    let position = { ...snapshot.position };
    if (this.lastAuthoritative) {
      const elapsed = Math.max(.05, Math.min(1, (now - this.lastAuthorityTime) / 1000));
      const dx = position.x - this.lastAuthoritative.x;
      const dz = position.z - this.lastAuthoritative.z;
      const distance = Math.hypot(dx, dz);
      const maxDistance = maxSpeed * elapsed + .45;
      if (distance > maxDistance) {
        const scale = maxDistance / distance;
        position.x = this.lastAuthoritative.x + dx * scale;
        position.z = this.lastAuthoritative.z + dz * scale;
      }
      if (!canOccupy(position.x, -position.z)) position = { ...this.lastAuthoritative };
    } else if (!canOccupy(position.x, -position.z)) {
      return null;
    }
    this.lastSequence = snapshot.sequence;
    this.lastAuthorityTime = now;
    this.lastAuthoritative = position;
    const accepted = { ...snapshot, position, receivedAt: now };
    this.snapshots.push(accepted);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    return accepted;
  }

  sampleRemote(now = performance.now()) {
    if (!this.snapshots.length) return null;
    const targetTime = now - this.interpolationDelay;
    while (this.snapshots.length > 2 && this.snapshots[1].receivedAt <= targetTime) this.snapshots.shift();
    const older = this.snapshots[0];
    const newer = this.snapshots[1];
    if (!newer) return older;
    const span = newer.receivedAt - older.receivedAt;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (targetTime - older.receivedAt) / span)) : 1;
    const lerp = (a, b) => a + (b - a) * alpha;
    const angleDelta = Math.atan2(Math.sin(newer.angle - older.angle), Math.cos(newer.angle - older.angle));
    const direction = {
      x: lerp(older.cameraDirection.x, newer.cameraDirection.x),
      y: lerp(older.cameraDirection.y, newer.cameraDirection.y),
      z: lerp(older.cameraDirection.z, newer.cameraDirection.z)
    };
    const directionLength = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const cameraPosition = older.cameraPosition && newer.cameraPosition
      ? {
          x: lerp(older.cameraPosition.x, newer.cameraPosition.x),
          y: lerp(older.cameraPosition.y, newer.cameraPosition.y),
          z: lerp(older.cameraPosition.z, newer.cameraPosition.z)
        }
      : newer.cameraPosition || older.cameraPosition;
    return {
      ...newer,
      x: lerp(older.position.x, newer.position.x),
      y: -lerp(older.position.z, newer.position.z),
      angle: older.angle + angleDelta * alpha,
      pitch: lerp(older.pitch, newer.pitch),
      fov: Number.isFinite(older.fov) && Number.isFinite(newer.fov)
        ? lerp(older.fov, newer.fov)
        : newer.fov,
      cameraPosition,
      cameraDirection: {
        x: direction.x / directionLength,
        y: direction.y / directionLength,
        z: direction.z / directionLength
      }
    };
  }

  reconcile(acknowledgement) {
    if (!Number.isInteger(acknowledgement.sequence) || !acknowledgement.position) return;
    const predicted = this.predictions.find(item => item.sequence === acknowledgement.sequence);
    if (predicted) {
      this.correction.x += acknowledgement.position.x - predicted.x;
      this.correction.y += -acknowledgement.position.z - predicted.z;
    }
    this.predictions = this.predictions.filter(item => item.sequence > acknowledgement.sequence);
  }

  consumeCorrection(deltaTime) {
    const blend = 1 - Math.exp(-12 * deltaTime);
    const x = this.correction.x * blend;
    const y = this.correction.y * blend;
    this.correction.x -= x;
    this.correction.y -= y;
    return { x, y };
  }

  reset() {
    this.snapshots.length = 0;
    this.predictions.length = 0;
    this.lastSequence = -1;
    this.lastAuthoritative = null;
    this.lastAuthorityTime = 0;
    this.correction.x = 0;
    this.correction.y = 0;
  }
}
