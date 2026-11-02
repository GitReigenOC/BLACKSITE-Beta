export class DecalManager {
  constructor(engine, scene, { lifetime = 5, maxDecals = 180, textureKind = "bullet" } = {}) {
    this.engine = engine;
    this.scene = scene;
    this.lifetime = lifetime;
    this.maxDecals = maxDecals;
    this.expiresAt = new Float64Array(maxDecals);
    this.active = new Uint8Array(maxDecals);
    this.nextIndex = 0;
    this.geometry = new engine.PlaneGeometry(1, 1);
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.texture = this.loadDecalTexture(textureKind);
    this.material = new engine.MeshStandardMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: .035,
      roughness: .88,
      metalness: .08,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
    this.mesh = new engine.InstancedMesh(this.geometry, this.material, maxDecals);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(engine.DynamicDrawUsage);
    this.mesh.count = maxDecals;
    this.dummy = new engine.Object3D();
    this.normalizedNormal = new engine.Vector3(0, 0, 1);
    this.color = new engine.Color();
    this.forward = new engine.Vector3(0, 0, 1);
    this.hiddenPosition = new engine.Vector3(0, -1000, 0);
    this.hiddenScale = new engine.Vector3(.001, .001, .001);
    this.scene.add(this.mesh);
    for (let index = 0; index < maxDecals; index++) this.hide(index);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  loadDecalTexture(textureKind) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    if (textureKind === "slash") {
      context.lineCap = "round";
      context.shadowColor = "rgba(8,10,8,.95)";
      context.shadowBlur = 7;
      context.strokeStyle = "rgba(18,20,17,.92)";
      context.lineWidth = 13;
      context.beginPath();
      context.moveTo(28, 99);
      context.quadraticCurveTo(61, 58, 100, 25);
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(189,196,177,.68)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(31, 94);
      context.quadraticCurveTo(63, 58, 97, 30);
      context.stroke();
      context.strokeStyle = "rgba(24,26,22,.72)";
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(43, 107);
      context.quadraticCurveTo(72, 70, 111, 43);
      context.stroke();
    } else {
      const glow = context.createRadialGradient(64, 64, 5, 64, 64, 55);
      glow.addColorStop(0, "rgba(9,8,7,.98)");
      glow.addColorStop(.24, "rgba(18,15,12,.94)");
      glow.addColorStop(.43, "rgba(58,42,29,.72)");
      glow.addColorStop(.62, "rgba(72,52,34,.24)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, 128, 128);
      context.strokeStyle = "rgba(12,10,8,.78)";
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(64, 64, 17, 15, -.18, 0, Math.PI * 2);
      context.stroke();
      for (let index = 0; index < 70; index++) {
        const angle = index * 2.399963;
        const radius = 19 + (index * 17 % 36);
        context.fillStyle = index % 2 ? "rgba(10,9,7,.17)" : "rgba(116,85,54,.13)";
        context.fillRect(64 + Math.cos(angle) * radius, 64 + Math.sin(angle) * radius, 2, 2);
      }
    }

    const texture = new this.engine.CanvasTexture(canvas);
    texture.encoding = this.engine.sRGBEncoding;
    return texture;
  }

  hide(index) {
    this.active[index] = 0;
    this.expiresAt[index] = 0;
    this.dummy.position.copy(this.hiddenPosition);
    this.dummy.quaternion.identity();
    this.dummy.scale.copy(this.hiddenScale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  add(position, normal, size = .16, color = "#ffffff", now = performance.now()) {
    if (!position?.isVector3 || !normal?.isVector3 || normal.lengthSq() < 1e-8) return null;
    this.normalizedNormal.copy(normal).normalize();
    const index = this.nextIndex;
    this.nextIndex = (index + 1) % this.maxDecals;
    this.dummy.position.copy(position).addScaledVector(this.normalizedNormal, .006);
    this.dummy.quaternion.setFromUnitVectors(this.forward, this.normalizedNormal);
    this.dummy.rotateZ(Math.random() * Math.PI * 2);
    this.dummy.scale.setScalar(size);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
    this.mesh.setColorAt(index, this.color.set(color));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.active[index] = 1;
    this.expiresAt[index] = now + this.lifetime * 1000;
    return index;
  }

  update(now = performance.now()) {
    let changed = false;
    for (let index = 0; index < this.maxDecals; index++) {
      if (!this.active[index] || now < this.expiresAt[index]) continue;
      this.hide(index);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let index = 0; index < this.maxDecals; index++) this.hide(index);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
