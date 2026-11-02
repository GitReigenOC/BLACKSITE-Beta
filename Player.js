export class Player {
  constructor({ x, y, angle = -Math.PI / 2, health = 100, weaponIndex = 0, score = 0 }) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.health = health;
    this.weaponIndex = weaponIndex;
    this.score = score;
    this.killstreak = 0;
    this.spawnInvulnerability = 0;
  }

  move(dx, dy, canOccupy, radius = .24) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / .1));
    const stepX = dx / steps;
    const stepY = dy / steps;
    for (let step = 0; step < steps; step++) {
      if (canOccupy(this.x + stepX, this.y, radius)) this.x += stepX;
      if (canOccupy(this.x, this.y + stepY, radius)) this.y += stepY;
    }
  }

  applyDamage(amount) {
    if (this.spawnInvulnerability > 0) return this.health;
    this.health = Math.max(0, this.health - Math.max(0, amount));
    return this.health;
  }

  reset({ x, y }) {
    this.x = x;
    this.y = y;
    this.angle = -Math.PI / 2;
    this.health = 100;
    this.weaponIndex = 0;
    this.score = 0;
    this.killstreak = 0;
    this.spawnInvulnerability = 3;
  }

  capture() {
    return {
      x: this.x,
      y: this.y,
      angle: this.angle,
      health: this.health,
      spawnShielded: this.spawnInvulnerability > 0
    };
  }
}
