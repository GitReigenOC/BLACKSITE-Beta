import { DecalManager } from "./DecalManager.js";

export class VFXSystem {
  constructor(engine, scene, { bulletCapacity = 80, particleCapacity = 512, tracerCapacity = 96 } = {}) {
    this.engine = engine;
    this.scene = scene;
    this.bullets = [];
    this.bulletCursor = 0;
    this.tracers = Array.from({ length: tracerCapacity }, () => ({
      active: false, remaining: 0, duration: .075
    }));
    this.tracerCursor = 0;
    this.particleCursor = 0;
    this.particles = Array.from({ length: particleCapacity }, () => ({
      active: false,
      position: new engine.Vector3(),
      velocity: new engine.Vector3(),
      remaining: 0,
      duration: 0,
      scale: 0,
      endScale: 0,
      gravity: 0,
      expanding: false
    }));
    this.lights = Array.from({ length: 8 }, () => {
      const light = new engine.PointLight("#ffc76b", 0, 3, 2);
      light.visible = false;
      scene.add(light);
      return { light, remaining: 0, duration: .055, intensity: 3.5 };
    });
    this.dummy = new engine.Object3D();
    this.identityQuaternion = new engine.Quaternion();
    this.bulletOrientation = new engine.Quaternion();
    this.bulletForward = new engine.Vector3(0, 0, 1);
    this.tracerUp = new engine.Vector3(0, 1, 0);
    this.bulletDirection = new engine.Vector3();
    this.bulletScale = new engine.Vector3(1, 1, 9);
    this.hiddenBulletScale = new engine.Vector3(.001, .001, .001);
    this.colorScratch = new engine.Color();
    this.hiddenPosition = new engine.Vector3(0, -1000, 0);
    this.zeroVelocity = new engine.Vector3();
    this.bulletGeometry = this.withBounds(new engine.SphereGeometry(.012, 6, 4));
    this.bulletPool = new engine.InstancedMesh(
      this.bulletGeometry,
      new engine.MeshBasicMaterial({ color: "#f5d992" }),
      bulletCapacity
    );
    this.bulletPool.frustumCulled = false;
    this.bulletPool.instanceMatrix.setUsage(engine.DynamicDrawUsage);
    this.bulletPool.userData.capacity = bulletCapacity;
    this.scene.add(this.bulletPool);
    for (let index = 0; index < bulletCapacity; index++) {
      this.setInstance(this.bulletPool, index, this.hiddenPosition, this.identityQuaternion, this.hiddenBulletScale);
      this.bullets.push({ active: false, position: new engine.Vector3(), velocity: new engine.Vector3(), remaining: 0 });
    }
    this.tracerPool = new engine.InstancedMesh(
      new engine.BoxGeometry(1, 1, 1),
      new engine.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: .88,
        depthTest: true,
        depthWrite: false
      }),
      tracerCapacity
    );
    this.tracerPool.frustumCulled = false;
    this.tracerPool.instanceMatrix.setUsage(engine.DynamicDrawUsage);
    this.tracerPool.userData.capacity = tracerCapacity;
    this.scene.add(this.tracerPool);
    for (let index = 0; index < tracerCapacity; index++) {
      this.setInstance(this.tracerPool, index, this.hiddenPosition, this.identityQuaternion, .001);
    }

    this.particleGeometry = this.withBounds(new engine.SphereGeometry(1, 8, 6));
    this.particlePool = new engine.InstancedMesh(
      this.particleGeometry,
      new engine.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: .9, depthWrite: false }),
      particleCapacity
    );
    this.particlePool.frustumCulled = false;
    this.particlePool.instanceMatrix.setUsage(engine.DynamicDrawUsage);
    this.particlePool.userData.capacity = particleCapacity;
    this.scene.add(this.particlePool);
    for (let index = 0; index < particleCapacity; index++) {
      this.setInstance(this.particlePool, index, this.hiddenPosition, this.identityQuaternion, .001);
    }

    this.decals = new DecalManager(engine, scene);
    this.slashes = new DecalManager(engine, scene, { lifetime: 5, maxDecals: 48, textureKind: "slash" });
  }

  withBounds(geometry) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  setInstance(mesh, index, position, quaternion, scale) {
    this.dummy.position.copy(position);
    this.dummy.quaternion.copy(quaternion);
    if (typeof scale === "number") this.dummy.scale.setScalar(scale);
    else this.dummy.scale.copy(scale);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  spawnBullet(origin, destination, { color = "#f5d992", speed = 180 } = {}) {
    let index = -1;
    for (let checked = 0; checked < this.bullets.length; checked++) {
      const candidate = (this.bulletCursor + checked) % this.bullets.length;
      if (!this.bullets[candidate].active) {
        index = candidate;
        break;
      }
    }
    if (index < 0) return false;
    const bullet = this.bullets[index];
    this.bulletCursor = (index + 1) % this.bullets.length;
    bullet.position.copy(origin);
    bullet.velocity.copy(destination).sub(origin);
    const distance = bullet.velocity.length();
    if (distance < .01) return false;
    bullet.velocity.multiplyScalar(speed / distance);
    bullet.remaining = distance / speed;
    bullet.active = true;
    bullet.color = color;
    this.bulletPool.setColorAt(index, this.colorScratch.set(color));
    this.bulletDirection.copy(bullet.velocity).normalize();
    this.bulletOrientation.setFromUnitVectors(this.bulletForward, this.bulletDirection);
    this.setInstance(this.bulletPool, index, bullet.position, this.bulletOrientation, this.bulletScale);
    this.bulletPool.instanceColor.needsUpdate = true;
    this.bulletPool.instanceMatrix.needsUpdate = true;
    return true;
  }

  addTracer(start, end, color = "#f3d58c") {
    let slot = -1;
    for (let checked = 0; checked < this.tracers.length; checked++) {
      const candidate = (this.tracerCursor + checked) % this.tracers.length;
      if (!this.tracers[candidate].active) {
        slot = candidate;
        break;
      }
    }
    if (slot < 0) slot = this.tracerCursor;
    const tracer = this.tracers[slot];
    this.tracerCursor = (slot + 1) % this.tracers.length;
    this.dummy.position.copy(start).add(end).multiplyScalar(.5);
    this.bulletDirection.copy(end).sub(start);
    const length = this.bulletDirection.length();
    if (length < .001) return false;
    this.bulletDirection.multiplyScalar(1 / length);
    this.bulletOrientation.setFromUnitVectors(this.tracerUp, this.bulletDirection);
    this.dummy.quaternion.copy(this.bulletOrientation);
    this.dummy.scale.set(.012, length, .012);
    this.dummy.updateMatrix();
    this.tracerPool.setMatrixAt(slot, this.dummy.matrix);
    this.tracerPool.setColorAt(slot, this.colorScratch.set(color));
    this.tracerPool.instanceMatrix.needsUpdate = true;
    this.tracerPool.instanceColor.needsUpdate = true;
    tracer.active = true;
    tracer.remaining = tracer.duration;
    return true;
  }

  spawnImpact(position, normal, color = "#44392d", size = .11) {
    this.decals.add(position, normal, size, color);
  }

  spawnSlash(position, normal, size = .42) {
    const tangent = new this.engine.Vector3().crossVectors(normal, new this.engine.Vector3(0, 1, 0));
    if (tangent.lengthSq() < .01) tangent.set(1, 0, 0);
    tangent.normalize();
    this.slashes.add(position, normal, size, "#ffffff");
    this.slashes.add(position.clone().addScaledVector(tangent, .1), normal, size * .82, "#ded8c4");
    this.slashes.add(position.clone().addScaledVector(tangent, -.1), normal, size * .66, "#ffffff");
    for (let index = 0; index < 7; index++) {
      const direction = tangent.clone().multiplyScalar((Math.random() - .5) * 2)
        .add(new this.engine.Vector3(0, .35 + Math.random() * .8, 0))
        .addScaledVector(normal, .3 + Math.random() * .7)
        .normalize();
      this.spawnParticle(position, {
        velocity: direction.multiplyScalar(1.2 + Math.random() * 2),
        duration: .14 + Math.random() * .1,
        scale: .025 + Math.random() * .02,
        gravity: 1.2,
        color: index % 2 ? "#e4e6d5" : "#b9d1c2"
      });
    }
  }

  clearDecals() {
    this.decals.clear();
    this.slashes.clear();
  }

  updateDecals(now) {
    this.decals.update(now);
    this.slashes.update(now);
  }

  spawnParticle(position, {
    velocity = null,
    duration = .22,
    scale = .018,
    endScale = 0,
    gravity = 2.8,
    color = "#d8c184",
    expanding = false
  } = {}) {
    let index = this.particleCursor;
    for (let checked = 0; checked < this.particles.length; checked++) {
      const candidate = (this.particleCursor + checked) % this.particles.length;
      if (!this.particles[candidate].active) {
        index = candidate;
        break;
      }
    }
    this.particleCursor = (index + 1) % this.particles.length;
    const particle = this.particles[index];
    particle.active = true;
    particle.position.copy(position);
    particle.velocity.copy(velocity || this.zeroVelocity);
    particle.remaining = duration;
    particle.duration = duration;
    particle.scale = scale;
    particle.endScale = endScale;
    particle.gravity = gravity;
    particle.expanding = expanding;
    this.setInstance(this.particlePool, index, particle.position, this.identityQuaternion, scale);
    this.particlePool.setColorAt(index, this.colorScratch.set(color));
    this.particlePool.instanceColor.needsUpdate = true;
    this.particlePool.instanceMatrix.needsUpdate = true;
    return true;
  }

  addImpactParticles(position, color = "#d8c184") {
    for (let index = 0; index < 4; index++) {
      this.spawnParticle(position, {
        velocity: new this.engine.Vector3((Math.random() - .5) * 1.8, Math.random() * 1.1, (Math.random() - .5) * 1.8),
        color,
        scale: .018
      });
    }
  }

  spawnBlood(position) {
    for (let index = 0; index < 12; index++) {
      const direction = new this.engine.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.4 + .25,
        Math.random() * 2 - 1
      ).normalize();
      this.spawnParticle(position, {
        velocity: direction.multiplyScalar(1.2 + Math.random() * 2),
        color: "#7f2522",
        duration: .65,
        scale: .025,
        gravity: 3.8
      });
    }
  }

  spawnMuzzleFlash(position) {
    this.spawnParticle(position, {
      color: "#ffd987",
      duration: .055,
      scale: .17,
      gravity: 0
    });
    const flash = this.lights.find(item => item.remaining <= 0) ||
      this.lights.reduce((oldest, item) => item.remaining < oldest.remaining ? item : oldest);
    flash.light.position.copy(position);
    flash.duration = .055;
    flash.intensity = 3.5;
    flash.light.intensity = flash.intensity;
    flash.light.visible = true;
    flash.remaining = flash.duration;
  }

  spawnExplosion(position, color = "#ff913d") {
    this.spawnParticle(position, {
      color,
      duration: .4,
      scale: .12,
      endScale: 4.2,
      gravity: 0,
      expanding: true
    });
    this.spawnParticle(position, {
      color: "#ffe0a2",
      duration: .28,
      scale: .08,
      endScale: 2.4,
      gravity: 0,
      expanding: true
    });
    for (let index = 0; index < 42; index++) {
      const direction = new this.engine.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.8 - .1,
        Math.random() * 2 - 1
      ).normalize();
      this.spawnParticle(position, {
        velocity: direction.multiplyScalar(3 + Math.random() * 8),
        color: index % 3 ? color : "#ffd98a",
        duration: .65 + Math.random() * .6,
        scale: .035 + Math.random() * .035,
        gravity: 6.5
      });
    }
    for (let index = 0; index < 28; index++) {
      const direction = new this.engine.Vector3(
        Math.random() * 2 - 1,
        Math.random() * .5,
        Math.random() * 2 - 1
      ).normalize();
      const offsetPosition = position.clone().add(new this.engine.Vector3(
        (Math.random() - .5) * .8, Math.random() * .45, (Math.random() - .5) * .8
      ));
      this.spawnParticle(offsetPosition, {
        velocity: direction.multiplyScalar(.2 + Math.random() * 1.2),
        duration: .9 + Math.random() * .65,
        scale: .12 + Math.random() * .08,
        endScale: .75 + Math.random() * .6,
        gravity: 0,
        color: index % 2 ? "#77736b" : "#4c4944",
        expanding: true
      });
    }
    this.decals.add(
      new this.engine.Vector3(position.x, .012, position.z),
      new this.engine.Vector3(0, 1, 0),
      2.7,
      "#39291e"
    );
    const flash = this.lights.find(item => item.remaining <= 0) ||
      this.lights.reduce((oldest, item) => item.remaining < oldest.remaining ? item : oldest);
    flash.light.position.copy(position);
    flash.duration = .22;
    flash.intensity = 9;
    flash.light.intensity = flash.intensity;
    flash.light.visible = true;
    flash.remaining = flash.duration;
  }

  update(dt) {
    let bulletsChanged = false;
    for (let index = 0; index < this.bullets.length; index++) {
      const bullet = this.bullets[index];
      if (!bullet.active) continue;
      const step = Math.min(dt, bullet.remaining);
      bullet.position.addScaledVector(bullet.velocity, step);
      bullet.remaining -= step;
      if (bullet.remaining <= 0) bullet.active = false;
      this.bulletDirection.copy(bullet.velocity).normalize();
      this.bulletOrientation.setFromUnitVectors(this.bulletForward, this.bulletDirection);
      this.setInstance(
        this.bulletPool,
        index,
        bullet.active ? bullet.position : this.hiddenPosition,
        this.bulletOrientation,
        bullet.active ? this.bulletScale : this.hiddenBulletScale
      );
      bulletsChanged = true;
    }
    if (bulletsChanged) this.bulletPool.instanceMatrix.needsUpdate = true;
    let tracersChanged = false;
    for (let index = 0; index < this.tracers.length; index++) {
      const tracer = this.tracers[index];
      if (!tracer.active) continue;
      tracer.remaining -= dt;
      if (tracer.remaining > 0) continue;
      tracer.active = false;
      this.setInstance(this.tracerPool, index, this.hiddenPosition, this.identityQuaternion, .001);
      tracersChanged = true;
    }
    if (tracersChanged) this.tracerPool.instanceMatrix.needsUpdate = true;
    let activeParticles = false;
    for (let index = this.particles.length - 1; index >= 0; index--) {
      const particle = this.particles[index];
      if (!particle.active) continue;
      particle.remaining -= dt;
      const progress = 1 - particle.remaining / particle.duration;
      if (particle.expanding) {
        const growth = particle.scale + (particle.endScale - particle.scale) * progress;
        const fade = progress > .72 ? (1 - progress) / .28 : 1;
        this.setInstance(
          this.particlePool,
          index,
          particle.position,
          this.identityQuaternion,
          Math.max(.001, growth * fade)
        );
      } else {
        particle.position.addScaledVector(particle.velocity, dt);
        particle.velocity.y -= particle.gravity * dt;
        this.setInstance(
          this.particlePool,
          index,
          particle.position,
          this.identityQuaternion,
          Math.max(.001, particle.scale * (1 - progress))
        );
      }
      activeParticles = true;
      if (particle.remaining > 0) continue;
      particle.active = false;
      this.setInstance(
        this.particlePool,
        index,
        this.hiddenPosition,
        this.identityQuaternion,
        .001
      );
    }
    if (activeParticles) this.particlePool.instanceMatrix.needsUpdate = true;
    for (let index = this.lights.length - 1; index >= 0; index--) {
      const flash = this.lights[index];
      if (flash.remaining <= 0) continue;
      flash.remaining -= dt;
      flash.light.intensity = Math.max(0, flash.remaining / flash.duration) * flash.intensity;
      if (flash.remaining > 0) continue;
      flash.light.intensity = 0;
      flash.light.visible = false;
      flash.duration = .055;
      flash.intensity = 3.5;
    }
  }

  clearTransient() {
    for (let index = 0; index < this.bullets.length; index++) {
      const bullet = this.bullets[index];
      bullet.active = false;
      bullet.remaining = 0;
      this.setInstance(this.bulletPool, index, this.hiddenPosition, this.identityQuaternion, this.hiddenBulletScale);
    }
    this.bulletPool.instanceMatrix.needsUpdate = true;
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      particle.active = false;
      particle.remaining = 0;
      this.setInstance(this.particlePool, index, this.hiddenPosition, this.identityQuaternion, .001);
    }
    this.particlePool.instanceMatrix.needsUpdate = true;
    for (const flash of this.lights) {
      const { light } = flash;
      light.intensity = 0;
      light.visible = false;
      flash.duration = .055;
      flash.intensity = 3.5;
      flash.remaining = 0;
    }
    for (let index = 0; index < this.tracers.length; index++) {
      this.tracers[index].active = false;
      this.tracers[index].remaining = 0;
      this.setInstance(this.tracerPool, index, this.hiddenPosition, this.identityQuaternion, .001);
    }
    this.tracerPool.instanceMatrix.needsUpdate = true;
    this.decals.clear();
    this.slashes.clear();
  }

  dispose() {
    this.clearTransient();
    this.decals.dispose();
    this.slashes.dispose();
    this.scene.remove(this.bulletPool, this.tracerPool, this.particlePool);
    this.lights.forEach(({ light }) => this.scene.remove(light));
    this.bulletGeometry.dispose();
    this.tracerPool.geometry.dispose();
    this.tracerPool.material.dispose();
    this.particleGeometry.dispose();
    this.bulletPool.material.dispose();
    this.particlePool.material.dispose();
  }
}
