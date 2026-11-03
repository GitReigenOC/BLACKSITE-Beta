import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const DEFAULT_WEAPON_ASSETS = [
  { name: "rifle", url: "assets/weapons/rifle.glb" },
  { name: "sniper", url: "assets/weapons/sniper.glb" },
  { name: "shotgun", url: "assets/weapons/shotgun.glb" },
  { name: "smg", url: "assets/weapons/smg.glb" },
  { name: "knife", url: "assets/weapons/knife.glb" }
];

export class WeaponAssetLoader {
  constructor(engine, Loader, overrides = globalThis.BLACKSITE_WEAPON_ASSETS || {}) {
    this.engine = engine;
    this.loader = new Loader();
    this.assets = DEFAULT_WEAPON_ASSETS.map((asset, index) => {
      const override = overrides[asset.name] || overrides[index];
      return typeof override === "string" ? { ...asset, url: override } : { ...asset, ...override };
    });
    this.loaded = new Map();
    this.fallbacks = this.assets.map((asset, index) => this.createProceduralWeapon(index));
  }

  createProceduralWeapon(index) {
    const group = new this.engine.Group();
    group.position.set(0, -.08, -.12);
    const receiverMaterial = new this.engine.MeshStandardMaterial({
      color: index === 2 ? "#756b51" : "#657165",
      roughness: .48,
      metalness: .62,
      emissive: "#202a21",
      emissiveIntensity: .42
    });
    const darkMaterial = new this.engine.MeshStandardMaterial({
      color: "#252d27",
      roughness: .7,
      metalness: .22,
      emissive: "#101610",
      emissiveIntensity: .3
    });
    const addBox = (size, position, material = receiverMaterial) => {
      const mesh = new this.engine.Mesh(new this.engine.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };

    if (index === 4) {
      const bladeMaterial = new this.engine.MeshStandardMaterial({
        color: "#c5cec2",
        roughness: .3,
        metalness: .76,
        emissive: "#343d32",
        emissiveIntensity: .24
      });
      addBox([.07, .045, .34], [0, 0, -.19], bladeMaterial).name = "knife-blade";
      addBox([.055, .045, .27], [0, 0, -.49], bladeMaterial).name = "knife-tip";
      addBox([.07, .13, .09], [0, -.075, .015], darkMaterial);
      return group;
    }

    const isSniper = index === 1;
    const isShotgun = index === 2;
    const isSmg = index === 3;
    const barrelLength = isSniper ? .58 : isShotgun ? .43 : isSmg ? .27 : .36;
    const barrel = new this.engine.Mesh(
      new this.engine.CylinderGeometry(isShotgun ? .035 : .025, isShotgun ? .04 : .035, barrelLength, 8),
      darkMaterial
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, .005, -.22 - barrelLength / 2);
    barrel.name = "weapon-barrel";
    barrel.castShadow = true;
    group.add(barrel);
    addBox([isSniper ? .14 : .15, .12, isSniper ? .3 : .27], [0, 0, -.19]);
    addBox([.12, .09, .2], [0, 0, .045], darkMaterial).name = "weapon-bolt";
    addBox([.075, .13, .12], [0, -.105, -.17], darkMaterial);
    addBox([.11, .13, .1], [0, -.075, .015], darkMaterial);

    if (isSniper) {
      addBox([.065, .065, .3], [0, .105, -.2], darkMaterial);
      addBox([.11, .085, .12], [0, .105, -.19]);
    } else {
      addBox([.045, .045, .09], [0, .078, -.2], darkMaterial);
    }
    if (isShotgun) addBox([.09, .11, .16], [0, .035, -.41]).name = "weapon-pump";
    return group;
  }

  async loadAll() {
    await Promise.all(this.assets.map(async (asset, index) => {
      const url = new URL(asset.url, document.baseURI).href;
      try {
        const gltf = await this.loader.loadAsync(url);
        const model = gltf.scene;
        model.position.set(...(asset.position || [0, -.08, -.12]));
        model.rotation.set(...(asset.rotation || [0, 0, 0]));
        model.traverse(object => {
          if (!object.isMesh) return;
          object.geometry.computeBoundingBox();
          object.geometry.computeBoundingSphere();
          object.castShadow = true;
          object.receiveShadow = true;
        });
        model.updateMatrixWorld(true);
        const bounds = new this.engine.Box3().setFromObject(model);
        const size = bounds.getSize(new this.engine.Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z);
        if (largestDimension <= 0) throw new Error("Weapon asset has no measurable geometry.");
        model.scale.setScalar(asset.scale ?? .72 / largestDimension);
        this.loaded.set(index, { model, asset });
      } catch (error) {
        console.warn(`Could not load optional ${asset.name} weapon asset at ${url}. Add a GLB/GLTF file there or configure window.BLACKSITE_WEAPON_ASSETS.`, error);
      }
    }));
  }

  createInstance(index) {
    const entry = this.loaded.get(index);
    return entry ? cloneSkeleton(entry.model) : cloneSkeleton(this.fallbacks[index]);
  }

  getMuzzle(instance, index) {
    let muzzle = null;
    instance.traverse(object => {
      if (!muzzle && /(^|[_ -])(muzzle|barrel[_ -]?(end|tip))($|[_ -])/i.test(object.name)) muzzle = object;
    });
    if (muzzle) return muzzle;
    const configuredOffset = this.loaded.get(index)?.asset.muzzle;
    const socket = new this.engine.Group();
    socket.name = `${this.assets[index]?.name || "weapon"}-muzzle-socket`;
    socket.position.set(...(configuredOffset || [0, .025, -.62]));
    instance.add(socket);
    return socket;
  }

  getSight(instance, index) {
    let sight = null;
    instance.traverse(object => {
      if (!sight && /iron[_ -]?sight|ads[_ -]?sight|aim[_ -]?point|sight/i.test(object.name)) sight = object;
    });
    if (sight) return sight;
    const configuredOffset = this.loaded.get(index)?.asset.sight;
    if (!configuredOffset) return null;
    sight = new this.engine.Group();
    sight.name = `${this.assets[index]?.name || "weapon"}-ads-sight`;
    sight.position.set(...configuredOffset);
    instance.add(sight);
    return sight;
  }

  getHandOffset(index) {
    const asset = this.loaded.get(index)?.asset;
    return {
      position: asset?.handPosition || [0, 0, 0],
      rotation: asset?.handRotation || [0, 0, 0],
      scale: asset?.handScale ?? 1
    };
  }
}
