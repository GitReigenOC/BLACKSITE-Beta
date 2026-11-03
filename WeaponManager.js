export const WEAPON_PROFILES = [
  { name: "ASSAULT RIFLE", short: "RIFLE", magazine: 30, ammo: 30, reserve: 90, damage: 50, spread: .075, interval: .18, reloadTime: 1.15, range: 18, auto: true, recoil: 9, movementSpeed: 1, inspect: { position: [.12, .12, .04], rotation: [-.32, -.68, .12] } },
  { name: "PRECISION SNIPER", short: "SNIPER", magazine: 5, ammo: 5, reserve: 25, damage: 72, spread: 0, interval: 1.25, reloadTime: 1.6, range: 22, scoped: true, piercing: true, chamberTime: .72, recoil: 20, movementSpeed: 1.05, inspect: { position: [-.06, .2, .08], rotation: [.24, -.82, -.16] } },
  { name: "BREACH SHOTGUN", short: "SHOTGUN", magazine: 8, ammo: 8, reserve: 40, damage: 100, pellets: 7, spread: .24, interval: .65, reloadTime: 1.4, range: 9, recoil: 15, movementSpeed: .88, inspect: { position: [.17, .08, .02], rotation: [-.5, .42, .3] } },
  { name: "COMPACT SMG", short: "SMG", magazine: 32, ammo: 32, reserve: 128, damage: 34, spread: .12, interval: .085, reloadTime: 1.1, range: 13, auto: true, recoil: 5, movementSpeed: 1.12, inspect: { position: [.14, .16, .08], rotation: [.48, 1.05, -.2] } },
  { name: "COMBAT KNIFE", short: "KNIFE", magazine: 0, ammo: 0, reserve: 0, damage: 52, spread: .6, interval: .84, melee: true, range: 1.8, recoil: 7, movementSpeed: 1.3, inspect: { position: [-.12, .24, -.06], rotation: [-.18, -.28, .08] } }
].map(profile => ({
  ...profile,
  attachments: { optic: false, suppressor: false, foregrip: false }
}));

export function collectPenetratingHits(intersections, wallDistance, piercing, maxTargets = 5) {
  const targets = [];
  const seen = new Set();
  for (const hit of intersections) {
    const userData = hit.object?.userData;
    const enemy = userData?.enemyRef;
    if (!enemy || userData.isWeapon) continue;
    if (seen.has(enemy)) continue;
    if (Number.isFinite(wallDistance) && hit.distance >= wallDistance - .015) break;
    seen.add(enemy);
    targets.push({
      enemy,
      distance: hit.distance,
      hitZone: userData.hitZone || "chest",
      point: hit.point.clone(),
      normal: hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld) || null,
      penetrationScale: piercing ? Math.pow(.72, targets.length) : 1
    });
    if (!piercing || targets.length >= maxTargets) break;
  }
  return targets;
}

export class WeaponManager {
  constructor(profiles = WEAPON_PROFILES) {
    this.weapons = profiles.map(profile => ({
      ...profile,
      attachments: { ...profile.attachments }
    }));
    this.selectedIndex = 0;
  }

  current(index = this.selectedIndex) {
    const weapon = this.weapons[index];
    if (!weapon) throw new RangeError(`Unknown weapon slot: ${index}`);
    return weapon;
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.weapons.length) return false;
    this.selectedIndex = index;
    return true;
  }

  setAttachment(index, name, enabled) {
    const weapon = this.current(index);
    if (!(name in weapon.attachments)) throw new RangeError(`Unknown weapon attachment: ${name}`);
    if (enabled && (
      (name === "optic" && (index === 2 || index === 4)) ||
      (index === 4 && name === "suppressor")
    )) return false;
    weapon.attachments[name] = Boolean(enabled);
    return weapon.attachments[name];
  }

  resetAmmo() {
    const magazines = [30, 5, 8, 32, 0];
    const reserves = [90, 25, 40, 128, 0];
    this.weapons.forEach((weapon, index) => {
      weapon.ammo = magazines[index];
      weapon.reserve = reserves[index];
    });
  }
}
