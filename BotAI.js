const CELL_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class BotAI {
  constructor({ repathInterval = .45 } = {}) {
    this.repathInterval = repathInterval;
  }

  isOpen(grid, x, y) {
    const column = Math.floor(x);
    const row = Math.floor(y);
    return row >= 0 && column >= 0 && row < grid.length && column < grid[row].length && grid[row][column] === "0";
  }

  hasLineOfSight(grid, from, to) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(distance / .16);
    for (let step = 1; step < steps; step++) {
      const ratio = step / steps;
      if (!this.isOpen(grid, from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio)) return false;
    }
    return true;
  }

  findPath(grid, from, to) {
    const start = [Math.floor(from.x), Math.floor(from.y)];
    const goal = [Math.floor(to.x), Math.floor(to.y)];
    const key = (x, y) => `${x},${y}`;
    const startKey = key(...start);
    const goalKey = key(...goal);
    const queue = [start];
    const previous = new Map([[startKey, null]]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const [x, y] = queue[cursor];
      if (key(x, y) === goalKey) break;
      for (const [dx, dy] of CELL_DIRECTIONS) {
        const nextX = x + dx;
        const nextY = y + dy;
        const nextKey = key(nextX, nextY);
        if (previous.has(nextKey) || !this.isOpen(grid, nextX + .5, nextY + .5)) continue;
        previous.set(nextKey, key(x, y));
        queue.push([nextX, nextY]);
      }
    }
    if (!previous.has(goalKey)) return [];
    const path = [];
    let nodeKey = goalKey;
    while (nodeKey !== startKey) {
      const [x, y] = nodeKey.split(",").map(Number);
      path.push({ x: x + .5, y: y + .5 });
      nodeKey = previous.get(nodeKey);
    }
    path.reverse();
    return path;
  }

  findCover(grid, enemy, player) {
    let candidate = null;
    let candidateDistance = Infinity;
    for (let rowOffset = -5; rowOffset <= 5; rowOffset++) {
      for (let columnOffset = -5; columnOffset <= 5; columnOffset++) {
        const x = Math.floor(enemy.x) + columnOffset + .5;
        const y = Math.floor(enemy.y) + rowOffset + .5;
        const distance = Math.hypot(x - enemy.x, y - enemy.y);
        if (distance < .65 || distance > 5 || distance >= candidateDistance || !this.isOpen(grid, x, y)) continue;
        if (this.hasLineOfSight(grid, { x, y }, player)) continue;
        candidate = { x, y };
        candidateDistance = distance;
      }
    }
    return candidate;
  }

  update(enemy, player, dt, grid, weapon) {
    const boss = enemy.type === "boss";
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.max(.001, Math.hypot(dx, dy));
    enemy.attack = Math.max(0, enemy.attack - dt);
    enemy.stateTimer = Math.max(0, (enemy.stateTimer || 0) - dt);
    enemy.repathTimer = Math.max(0, (enemy.repathTimer || 0) - dt);
    enemy.facingX = dx / distance;
    enemy.facingY = dy / distance;
    const hasLineOfSight = this.hasLineOfSight(grid, enemy, player);

    if (enemy.underFire) {
      enemy.underFire = false;
      enemy.state = "dodge";
      enemy.stateTimer = .55 + Math.random() * .25;
      enemy.cover = this.findCover(grid, enemy, player);
      enemy.path = enemy.cover ? this.findPath(grid, enemy, enemy.cover) : [];
      enemy.pathTarget = enemy.cover ? `${Math.floor(enemy.cover.x)},${Math.floor(enemy.cover.y)}` : "";
    }

    if (enemy.stateTimer <= 0) {
      const needsCover = enemy.health / (enemy.maxHealth || 100) < (boss ? .68 : .45) &&
        Math.random() < (boss ? .86 : .7);
      if (needsCover) {
        enemy.cover = this.findCover(grid, enemy, player);
        enemy.state = enemy.cover ? "cover" : "dodge";
      } else {
        enemy.cover = null;
        enemy.state = hasLineOfSight && distance <= weapon.range * .88
          ? Math.random() < (boss ? .55 : .25) ? "dodge" : "attack"
          : "seek";
        if (enemy.state === "dodge") enemy.strafe *= -1;
      }
      enemy.stateTimer = boss ? .7 + Math.random() * .6 : 1.4 + Math.random() * 1.8;
    }

    if (enemy.state === "attack" && (!hasLineOfSight || distance > weapon.range * .95)) {
      enemy.state = "seek";
      enemy.stateTimer = .5;
    }

    if (enemy.state === "attack" && hasLineOfSight && distance <= weapon.range) {
      const strafe = boss ? .48 : enemy.type === "brute" ? .12 : .32;
      return {
        state: enemy.state,
        moveX: -enemy.facingY * enemy.strafe * strafe,
        moveY: enemy.facingX * enemy.strafe * strafe,
        sprinting: false,
        fire: enemy.attack <= 0,
        distance,
        hasLineOfSight
      };
    }

    let destination = player;
    let lateral = enemy.strafe * (boss ? .34 : enemy.type === "brute" ? .08 : .2);
    if ((enemy.state === "cover" || enemy.state === "dodge") && enemy.cover) {
      destination = enemy.cover;
      lateral = 0;
    } else if (enemy.state === "dodge" && !enemy.cover) {
      destination = { x: enemy.x - enemy.facingX * 2, y: enemy.y - enemy.facingY * 2 };
      lateral = 0;
    }

    const pathDestination = enemy.state === "cover" || enemy.state === "dodge" ? enemy.cover || destination : player;
    const pathTarget = `${Math.floor(pathDestination.x)},${Math.floor(pathDestination.y)}`;
    if (enemy.repathTimer <= 0 || enemy.pathTarget !== pathTarget || !enemy.path?.length) {
      enemy.path = this.findPath(grid, enemy, pathDestination);
      enemy.pathTarget = pathTarget;
      enemy.repathTimer = this.repathInterval;
    }
    while (enemy.path?.length && Math.hypot(enemy.path[0].x - enemy.x, enemy.path[0].y - enemy.y) < .22) {
      enemy.path.shift();
    }

    const waypoint = enemy.path?.[0] || destination;
    const waypointDx = waypoint.x - enemy.x;
    const waypointDy = waypoint.y - enemy.y;
    const waypointDistance = Math.hypot(waypointDx, waypointDy) || 1;
    let moveX = waypointDx / waypointDistance - enemy.facingY * lateral;
    let moveY = waypointDy / waypointDistance + enemy.facingX * lateral;
    const moveLength = Math.hypot(moveX, moveY) || 1;
    moveX /= moveLength;
    moveY /= moveLength;
    const reachedCover = enemy.cover &&
      Math.hypot(enemy.cover.x - enemy.x, enemy.cover.y - enemy.y) < .3;
    if ((enemy.state === "cover" || enemy.state === "dodge") && reachedCover) {
      return {
        state: "cover",
        moveX: 0,
        moveY: 0,
        sprinting: false,
        fire: hasLineOfSight && distance <= weapon.range && enemy.attack <= 0,
        distance,
        hasLineOfSight
      };
    }

    return {
      state: enemy.state,
      moveX,
      moveY,
      sprinting: distance > 4 && (enemy.state === "seek" || enemy.state === "dodge"),
      fire: hasLineOfSight && distance <= weapon.range && enemy.attack <= 0,
      distance,
      hasLineOfSight
    };
  }
}
