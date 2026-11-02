import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { AudioManager } from "./AudioManager.js";
import { NetworkManager } from "./NetworkManager.js";
import { Player } from "./Player.js";
import { WeaponManager } from "./WeaponManager.js";
import { BotAI } from "./BotAI.js";
import { VFXSystem } from "./VFX.js";
import { ReplayBuffer } from "./ReplayBuffer.js";
import { WeaponAssetLoader } from "./WeaponAssetLoader.js";

(() => {
      "use strict";

      const canvas = document.querySelector("#game");
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#111a17");
      scene.fog = new THREE.Fog("#202920", 12, 27);
      const camera = new THREE.PerspectiveCamera(72, 16 / 9, .035, 120);
      camera.rotation.order = "YXZ";
      camera.position.set(7.5, 1.65, -7.5);
      scene.add(camera);
      const audioManager = new AudioManager(camera, scene, THREE);
      const networkManager = new NetworkManager();
      const botAI = new BotAI();
      const replayBuffer = new ReplayBuffer({ duration: 10, sampleRate: 20 });
      const vfxSystem = new VFXSystem(THREE, scene);
      let replayPlayback = false;
      const ambientLight = new THREE.AmbientLight("#bac7aa", 1.15);
      scene.add(ambientLight);
      const sunLight = new THREE.DirectionalLight("#f0e5c4", 2.2);
      sunLight.position.set(-5, 12, 7);
      scene.add(sunLight.target);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.left = -18;
      sunLight.shadow.camera.right = 18;
      sunLight.shadow.camera.top = 18;
      sunLight.shadow.camera.bottom = -18;
      sunLight.shadow.camera.near = .5;
      sunLight.shadow.camera.far = 35;
      sunLight.shadow.bias = -.00025;
      scene.add(sunLight);
      const staticMaterials = new Map();
      const staticGeometries = new Map();
      const arenaTextures = new Map();
      let poolWaterMaterial = null;
      const enemyModels = new Map();
      let replayGhostMaterial = null;
      let enemyRigTemplate = null;
      let enemyRigAnimations = [];
      let warnedMissingHandSocket = false;
      let remoteModel = null;
      let weaponAnchor = null;
      let muzzleLight = null;
      let weaponModels = [];
      let weaponMuzzles = [];
      let weaponSights = [];
      let networkPeer = null, networkConnection = null, networkRole = "";
      let networkStateTimer = 0, remotePlayer = null, roomCode = "";
      let roomConfiguration = null;
      const raycaster = new THREE.Raycaster();
      const aimRaycaster = new THREE.Raycaster();
      const cameraRaycaster = new THREE.Raycaster();
      const transientEffects = [];
      const pendingTimeouts = new Set();
      let grenadeAim = false;
      let grenadeArc = null;
      const overlay = document.querySelector("#overlay");
      const startButton = document.querySelector("#start-button");
      const returnMenuButton = document.querySelector("#return-menu-button");
      const hitMarker = document.querySelector("#hit-marker");
      const profileScreen = document.querySelector("#profile-screen");
      const mainMenu = document.querySelector("#main-menu");
      const multiplayerMenu = document.querySelector("#multiplayer-menu");
      const serversMenu = document.querySelector("#servers-menu");
      const profileModal = document.querySelector("#profile-modal");
      const settingsScreen = document.querySelector("#settings-screen");
      const menuScreens = [profileScreen, mainMenu, multiplayerMenu, serversMenu, profileModal, settingsScreen];
      const originalArena = [
        "1111111111111111",
        "1000000000000001",
        "1000110001100001",
        "1000110001100001",
        "1000000000000001",
        "1011000110001101",
        "1000000000000001",
        "1000110001100001",
        "1000110001100001",
        "1000000000000001",
        "1011000110001101",
        "1000000000000001",
        "1000110001100001",
        "1000110001100001",
        "1000000000000001",
        "1111111111111111"
      ];
      function createMapGrid(size) {
        return Array.from({ length: size }, (_, y) =>
          Array.from({ length: size }, (_, x) => x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "1" : "0"));
      }
      function createBattlefield() {
        const grid = createMapGrid(36);
        for (let x = 5; x < 31; x++) {
          if (x < 11 || x > 14) grid[8][x] = "1";
          if (x < 21 || x > 24) grid[27][x] = "1";
        }
        for (let y = 5; y < 31; y++) {
          if (y < 13 || y > 16) grid[y][12] = "1";
          if (y < 20 || y > 23) grid[y][23] = "1";
        }
        [[6, 6], [7, 6], [28, 6], [29, 6], [6, 29], [7, 29], [28, 29], [29, 29],
          [17, 5], [18, 5], [17, 30], [18, 30], [5, 18], [30, 18]].forEach(([x, y]) => { grid[y][x] = "1"; });
        return grid.map(row => row.join(""));
      }
      function createPoolRooms() {
        const grid = createMapGrid(32);
        for (let x = 3; x < 29; x++) {
          if (x !== 7 && x !== 8 && x !== 21 && x !== 22) grid[6][x] = "1";
          if (x !== 13 && x !== 14 && x !== 25 && x !== 26) grid[13][x] = "1";
          if (x !== 5 && x !== 6 && x !== 18 && x !== 19) grid[21][x] = "1";
          if (x !== 10 && x !== 11 && x !== 24 && x !== 25) grid[27][x] = "1";
        }
        for (let y = 3; y < 29; y++) {
          if (y !== 10 && y !== 11 && y !== 23 && y !== 24) grid[y][9] = "1";
          if (y !== 4 && y !== 5 && y !== 17 && y !== 18) grid[y][17] = "1";
          if (y !== 8 && y !== 9 && y !== 25 && y !== 26) grid[y][24] = "1";
        }
        grid[16][16] = "0";
        return grid.map(row => row.join(""));
      }
      const mapDefinitions = {
        arena: {
          name: "Tactical Arena", grid: originalArena, spawn: { x: 7.5, y: 7.5 },
          enemySpawns: [
            new THREE.Vector3(2.5, 0, -2.5), new THREE.Vector3(13.5, 0, -2.5),
            new THREE.Vector3(2.5, 0, -13.5), new THREE.Vector3(13.5, 0, -13.5),
            new THREE.Vector3(7.5, 0, -2.5), new THREE.Vector3(7.5, 0, -13.5)
          ],
          outdoor: false, floor: "#30372f", floorLine: "#41483e", wall: "#555d50", wallLine: "#424a3f",
          ceiling: "#353c34", fog: "#202920", background: "#111a17", ambient: "#bac7aa", ambientPower: 1.15,
          sun: "#f0e5c4", sunPower: 2.2, floorRoughness: .8, wallRoughness: .88, lightColor: "#d3dbac"
        },
        battlefield: {
          name: "Battlefield", grid: createBattlefield(), spawn: { x: 18.5, y: 18.5 },
          enemySpawns: [
            new THREE.Vector3(4.5, 0, -4.5), new THREE.Vector3(31.5, 0, -4.5),
            new THREE.Vector3(4.5, 0, -31.5), new THREE.Vector3(31.5, 0, -31.5),
            new THREE.Vector3(7.5, 0, -18.5), new THREE.Vector3(28.5, 0, -18.5)
          ],
          outdoor: true, floor: "#51483a", floorLine: "#675943", wall: "#716552", wallLine: "#443f36",
          ceiling: "#252a29", fog: "#756d60", background: "#526b78", ambient: "#91a7a5", ambientPower: .8,
          sun: "#ffd29a", sunPower: 2.7, floorRoughness: .96, wallRoughness: .93, lightColor: "#ffb979"
        },
        pool: {
          name: "The Pool Rooms", grid: createPoolRooms(), spawn: { x: 15.5, y: 15.5 },
          enemySpawns: [
            new THREE.Vector3(2.5, 0, -2.5), new THREE.Vector3(29.5, 0, -2.5),
            new THREE.Vector3(2.5, 0, -29.5), new THREE.Vector3(29.5, 0, -29.5),
            new THREE.Vector3(5.5, 0, -15.5), new THREE.Vector3(26.5, 0, -15.5)
          ],
          outdoor: false, floor: "#397f80", floorLine: "#1d5d62", wall: "#abd8d0", wallLine: "#5daaa5",
          ceiling: "#397a79", fog: "#397c7f", background: "#16464e", ambient: "#9ce9e5", ambientPower: .82,
          sun: "#8df5f0", sunPower: .62, floorRoughness: .14, wallRoughness: .34, lightColor: "#56e9ef"
        }
      };
      let activeMapId = "arena";
      let selectedMapId = "arena";
      let map = mapDefinitions[activeMapId].grid;
      let mapGroup = null;
      let mapWalls = null;
      let dynamicMapLights = [];
      let animatedMapProps = [];
      let playerPitch = 0;
      function cachedMaterial(key, color, options = {}) {
        if (!staticMaterials.has(key)) {
          staticMaterials.set(key, new THREE.MeshStandardMaterial({
            color, roughness: options.roughness ?? .82, metalness: options.metalness ?? 0,
            map: options.map || null, normalMap: options.normalMap || null,
            normalScale: options.normalScale || new THREE.Vector2(.22, .22),
            roughnessMap: options.roughnessMap || null, emissive: options.emissive || "#000000",
            emissiveIntensity: options.emissiveIntensity || 0,
            depthTest: true, depthWrite: true
          }));
        }
        return staticMaterials.get(key);
      }

      function ensureGeometryBounds(geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        return geometry;
      }

      function cachedBoxGeometry(width, height, depth) {
        const key = `${width}:${height}:${depth}`;
        if (!staticGeometries.has(key)) staticGeometries.set(key, ensureGeometryBounds(new THREE.BoxGeometry(width, height, depth)));
        return staticGeometries.get(key);
      }

      function cachedCylinderGeometry(topRadius, bottomRadius, height, segments) {
        const key = `cylinder:${topRadius}:${bottomRadius}:${height}:${segments}`;
        if (!staticGeometries.has(key)) {
          staticGeometries.set(key, ensureGeometryBounds(new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments)));
        }
        return staticGeometries.get(key);
      }

      function cachedPlaneGeometry(width, height) {
        const key = `plane:${width}:${height}`;
        if (!staticGeometries.has(key)) staticGeometries.set(key, ensureGeometryBounds(new THREE.PlaneGeometry(width, height)));
        return staticGeometries.get(key);
      }

      function cachedArenaTexture(key, baseColor, lineColor, repeatX, repeatY) {
        if (!arenaTextures.has(key)) {
          arenaTextures.set(key, createArenaTextures(baseColor, lineColor, repeatX, repeatY));
        }
        return arenaTextures.get(key);
      }

      function createArenaTextures(baseColor, lineColor, repeatX, repeatY) {
        const textureCanvas = document.createElement("canvas");
        textureCanvas.width = 256;
        textureCanvas.height = 256;
        const textureContext = textureCanvas.getContext("2d");
        textureContext.fillStyle = baseColor;
        textureContext.fillRect(0, 0, 256, 256);
        textureContext.strokeStyle = lineColor;
        textureContext.lineWidth = 2;
        for (let offset = 0; offset <= 256; offset += 64) {
          textureContext.beginPath();
          textureContext.moveTo(offset, 0);
          textureContext.lineTo(offset, 256);
          textureContext.moveTo(0, offset);
          textureContext.lineTo(256, offset);
          textureContext.stroke();
        }
        for (let i = 0; i < 180; i++) {
          const x = (i * 73) % 256;
          const y = (i * 131) % 256;
          textureContext.fillStyle = i % 2 ? "#ffffff0b" : "#00000012";
          textureContext.fillRect(x, y, 2 + i % 5, 2);
        }
        const normalCanvas = document.createElement("canvas");
        normalCanvas.width = normalCanvas.height = 256;
        const normalContext = normalCanvas.getContext("2d");
        const normalImage = normalContext.createImageData(256, 256);
        const heights = new Uint8Array(256 * 256);
        for (let y = 0; y < 256; y++) {
          for (let x = 0; x < 256; x++) {
            const edge = x % 64 < 2 || y % 64 < 2;
            heights[y * 256 + x] = edge ? 64 : 116 + ((x * 73 + y * 151 + x * y) % 32);
          }
        }
        for (let y = 0; y < 256; y++) {
          for (let x = 0; x < 256; x++) {
            const index = (y * 256 + x) * 4;
            const dx = heights[y * 256 + Math.min(255, x + 1)] - heights[y * 256 + Math.max(0, x - 1)];
            const dy = heights[Math.min(255, y + 1) * 256 + x] - heights[Math.max(0, y - 1) * 256 + x];
            const nx = -dx / 255, ny = -dy / 255, nz = 1;
            const length = Math.hypot(nx, ny, nz);
            normalImage.data[index] = Math.round((nx / length * .5 + .5) * 255);
            normalImage.data[index + 1] = Math.round((ny / length * .5 + .5) * 255);
            normalImage.data[index + 2] = Math.round((nz / length * .5 + .5) * 255);
            normalImage.data[index + 3] = 255;
          }
        }
        normalContext.putImageData(normalImage, 0, 0);

        const roughnessCanvas = document.createElement("canvas");
        roughnessCanvas.width = roughnessCanvas.height = 256;
        const roughnessContext = roughnessCanvas.getContext("2d");
        const roughnessImage = roughnessContext.createImageData(256, 256);
        for (let y = 0; y < 256; y++) {
          for (let x = 0; x < 256; x++) {
            const index = (y * 256 + x) * 4;
            const value = x % 64 < 2 || y % 64 < 2 ? 236 : 178 + ((x * 31 + y * 47 + x * y) % 56);
            roughnessImage.data[index] = roughnessImage.data[index + 1] = roughnessImage.data[index + 2] = value;
            roughnessImage.data[index + 3] = 255;
          }
        }
        roughnessContext.putImageData(roughnessImage, 0, 0);

        const makeTexture = (canvas, srgb = false) => {
          const texture = new THREE.CanvasTexture(canvas);
          if (srgb) texture.encoding = THREE.sRGBEncoding;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeatX, repeatY);
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          return texture;
        };
        return {
          map: makeTexture(textureCanvas, true),
          normalMap: makeTexture(normalCanvas),
          roughnessMap: makeTexture(roughnessCanvas)
        };
      }

      function buildArena(mapId) {
        const definition = mapDefinitions[mapId];
        audioManager.setEnvironment(mapId);
        const width = map[0].length, depth = map.length;
        animatedMapProps = [];
        dynamicMapLights = [];
        const floorTextures = cachedArenaTexture(`${mapId}-floor`, definition.floor, definition.floorLine, width, depth);
        const wallTextures = cachedArenaTexture(`${mapId}-wall`, definition.wall, definition.wallLine, 2, 2);
        const floorMaterial = cachedMaterial(`${mapId}-floor`, "#ffffff", {
          ...floorTextures, roughness: definition.floorRoughness,
          metalness: mapId === "pool" ? .16 : 0,
          normalScale: new THREE.Vector2(.28, .28)
        });
        const wallMaterial = cachedMaterial(`${mapId}-wall`, "#ffffff", {
          ...wallTextures, roughness: definition.wallRoughness,
          metalness: mapId === "battlefield" ? .18 : 0,
          normalScale: new THREE.Vector2(.2, .2)
        });
        const floor = new THREE.Mesh(cachedBoxGeometry(width, .08, depth), floorMaterial);
        floor.position.set(width / 2, -.06, -depth / 2);
        floor.receiveShadow = true;
        mapGroup.add(floor);

        if (!definition.outdoor) {
          const ceiling = new THREE.Mesh(cachedBoxGeometry(width, .08, depth),
            cachedMaterial(`${mapId}-ceiling`, definition.ceiling, { roughness: .92 }));
          ceiling.position.set(width / 2, 4.04, -depth / 2);
          ceiling.frustumCulled = true;
          mapGroup.add(ceiling);
        }

        const wallCount = map.reduce((total, row) => total + [...row].filter(cell => cell === "1").length, 0);
        const walls = new THREE.InstancedMesh(cachedBoxGeometry(1, 1, 1), wallMaterial, wallCount);
        walls.name = "arena-walls";
        walls.castShadow = true;
        walls.receiveShadow = true;
        walls.frustumCulled = false;
        const transform = new THREE.Object3D();
        let wallIndex = 0;
        map.forEach((row, mapY) => [...row].forEach((cell, mapX) => {
          if (cell !== "1") return;
          const edge = mapX === 0 || mapY === 0 || mapX === width - 1 || mapY === depth - 1;
          const height = definition.outdoor ? (edge ? 3.2 : .95 + ((mapX * 7 + mapY * 3) % 4) * .22) : 4;
          transform.position.set(mapX + .5, height / 2, -mapY - .5);
          transform.scale.set(1, height, 1);
          transform.updateMatrix();
          walls.setMatrixAt(wallIndex++, transform.matrix);
        }));
        walls.instanceMatrix.needsUpdate = true;
        mapWalls = walls;
        mapGroup.add(walls);

        if (mapId === "battlefield") {
          const debrisMaterial = cachedMaterial("battlefield-debris", "#b08b5e", { roughness: .97, metalness: .08 });
          const debris = new THREE.InstancedMesh(cachedBoxGeometry(.44, .24, .38), debrisMaterial, 32);
          debris.frustumCulled = false;
          let debrisIndex = 0;
          for (let y = 3; y < depth - 3 && debrisIndex < 32; y += 4) {
            for (let x = 3; x < width - 3 && debrisIndex < 32; x += 5) {
              if (wallAt(x + .5, y + .5)) continue;
              transform.position.set(x + .5, .08, -y - .5);
              transform.rotation.set(0, ((x * 13 + y * 5) % 8) * Math.PI / 16, 0);
              transform.scale.set(1 + (x % 3) * .35, 1, 1 + (y % 2) * .3);
              transform.updateMatrix();
              debris.setMatrixAt(debrisIndex++, transform.matrix);
            }
          }
          debris.count = debrisIndex;
          debris.instanceMatrix.needsUpdate = true;
          debris.frustumCulled = true;
          mapGroup.add(debris);
          [[4, 14], [30, 14], [4, 21], [30, 21], [20, 4], [25, 31]].forEach(([x, y], index) => {
            if (wallAt(x + .5, y + .5)) return;
            const fragment = new THREE.Mesh(cachedBoxGeometry(.48, .16, .32), debrisMaterial);
            fragment.position.set(x + .5, .28 + (index % 2) * .12, -y - .5);
            fragment.rotation.set(index * .17, index * .43, index * .11);
            fragment.userData.baseY = fragment.position.y;
            fragment.userData.phase = index * 1.7;
            fragment.frustumCulled = true;
            mapGroup.add(fragment);
            animatedMapProps.push(fragment);
          });
        }

        if (mapId === "pool") {
          if (!poolWaterMaterial) {
            poolWaterMaterial = new THREE.MeshStandardMaterial({
              color: "#3ce5dc", roughness: .16, metalness: .18, transparent: true, opacity: .76,
              emissive: "#087f88", emissiveIntensity: .34
            });
          }
          [[4, 3], [12, 8], [20, 15], [4, 23], [25, 24]].forEach(([x, y]) => {
            const water = new THREE.Mesh(cachedPlaneGeometry(3.2, 2.4), poolWaterMaterial);
            water.rotation.x = -Math.PI / 2;
            water.position.set(x + 1.6, .015, -(y + 1.2));
            water.frustumCulled = true;
            mapGroup.add(water);
          });
        }

        const fixtureMaterial = cachedMaterial(`${mapId}-fixture`, definition.outdoor ? "#45443b" : "#242a23", {
          metalness: .48, roughness: .42
        });
        const glowMaterial = cachedMaterial(`${mapId}-glow`, definition.lightColor, {
          emissive: definition.lightColor, emissiveIntensity: mapId === "pool" ? 1.7 : 1.2
        });
        let lightIndex = 0;
        const step = mapId === "arena" ? 3 : 7;
        for (let y = 2; y < depth - 1 && lightIndex < 10; y += step) {
          for (let x = 2; x < width - 1 && lightIndex < 10; x += step) {
            const height = definition.outdoor ? 2.6 : 3.92;
            const fixture = new THREE.Mesh(cachedBoxGeometry(.9, .08, .28), fixtureMaterial);
            fixture.position.set(x + .5, height, -y - .5);
            mapGroup.add(fixture);
            const diffuser = new THREE.Mesh(cachedBoxGeometry(.72, .035, .17), glowMaterial);
            diffuser.position.set(x + .5, height - .06, -y - .5);
            mapGroup.add(diffuser);
            const light = new THREE.PointLight(definition.lightColor,
              mapId === "arena" && lightIndex === 0 ? 2.2 : mapId === "pool" ? 1.05 : 1.25,
              mapId === "battlefield" ? 10 : 8, 2);
            light.position.set(x + .5, height - .35, -y - .5);
            light.userData.flicker = mapId === "pool" || mapId === "battlefield";
            light.userData.baseIntensity = light.intensity;
            mapGroup.add(light);
            if (light.userData.flicker) dynamicMapLights.push(light);
            lightIndex++;
          }
        }
        if (mapId !== "arena") {
          [[width * .28, mapId === "pool" ? "#42e8ef" : "#ffd08b"],
            [width * .72, mapId === "pool" ? "#70baff" : "#ff885b"]].forEach(([x, color], index) => {
            const spot = new THREE.SpotLight(color, mapId === "pool" ? 1.15 : 2.2, 24, .52, .45, 1.4);
            spot.position.set(x, definition.outdoor ? 7 : 3.8, -depth * (index ? .72 : .28));
            spot.target.position.set(x + (index ? -3 : 3), 0, -depth / 2);
            spot.castShadow = false;
            mapGroup.add(spot, spot.target);
          });
        }
      }

      function loadMap(mapId) {
        if (!mapDefinitions[mapId]) return;
        vfxSystem.clearDecals();
        activeMapId = mapId;
        map = mapDefinitions[mapId].grid;
        if (mapGroup) scene.remove(mapGroup);
        mapWalls = null;
        mapGroup = new THREE.Group();
        mapGroup.name = `map-${mapId}`;
        scene.add(mapGroup);
        const definition = mapDefinitions[mapId];
        scene.background = new THREE.Color(definition.background);
        scene.fog = new THREE.Fog(definition.fog, 12, mapId === "battlefield" ? 42 : 34);
        sunLight.target.position.set(map[0].length / 2, 0, -map.length / 2);
        sunLight.position.set(map[0].length / 2 - 5, 12, -map.length / 2 + 7);
        sunLight.shadow.camera.left = -map[0].length * .65;
        sunLight.shadow.camera.right = map[0].length * .65;
        sunLight.shadow.camera.top = map.length * .65;
        sunLight.shadow.camera.bottom = -map.length * .65;
        sunLight.shadow.camera.far = Math.max(35, map.length * 2);
        sunLight.shadow.camera.updateProjectionMatrix();
        ambientLight.color.set(definition.ambient);
        ambientLight.intensity = definition.ambientPower;
        sunLight.color.set(definition.sun);
        sunLight.intensity = definition.sunPower;
        const sectorName = document.querySelector("#sector-name");
        if (sectorName) sectorName.textContent = `${definition.name.toUpperCase()} / NIGHTFALL`;
        buildArena(mapId);
      }

      loadMap(activeMapId);

      const weaponManager = new WeaponManager();
      const weapons = weaponManager.weapons;
      let loadoutWeaponIndex = 0;
      const weaponAssetLoader = new WeaponAssetLoader(THREE, GLTFLoader);

      function applyWeaponAttachments(index) {
        const model = weaponModels[index];
        if (!model) return;
        const attachmentNames = {
          optic: /optic|scope|sight/i,
          suppressor: /suppressor|silencer/i,
          foregrip: /foregrip|vertical[_ -]?grip/i
        };
        model.traverse(object => {
          for (const [name, pattern] of Object.entries(attachmentNames)) {
            if (pattern.test(object.name)) object.visible = Boolean(weapons[index].attachments[name]);
          }
        });
      }

      function updateLoadoutControls() {
        document.querySelectorAll("[data-attachment]").forEach(input => {
          input.checked = Boolean(weapons[loadoutWeaponIndex].attachments[input.dataset.attachment]);
        });
      }

      function initializeWeapons() {
        weaponAnchor = new THREE.Group();
        weaponAnchor.position.set(.32, -.3, -.48);
        camera.add(weaponAnchor);
        muzzleLight = new THREE.PointLight("#ffc76b", 0, 3, 2);
        muzzleLight.position.set(.32, -.25, -1.25);
        camera.add(muzzleLight);
        weaponModels = weapons.map((weapon, index) => {
          const holder = new THREE.Group();
          holder.name = `${weapon.short.toLowerCase()}-weapon-holder`;
          holder.visible = index === player.weaponIndex;
          weaponAnchor.add(holder);
          return holder;
        });
        weaponAssetLoader.loadAll().then(() => {
          weaponModels.forEach((holder, index) => {
            const model = weaponAssetLoader.createInstance(index);
            if (!model) return;
            holder.add(model);
            weaponMuzzles[index] = weaponAssetLoader.getMuzzle(model, index);
            weaponSights[index] = weaponAssetLoader.getSight(model, index);
            applyWeaponAttachments(index);
          });
        });
      }
      const player = new Player(mapDefinitions[activeMapId].spawn);
      initializeWeapons();
      const weaponWeight = [1, 1.9, 1.45, .78, .5];
      const keys = new Set();
      let enemies = [];
      let explosions = [];
      let nextEnemyId = 0, killStreak = 0;
      let resultSubmitted = false;
      const replayGhosts = new Map();
      let running = false, locallyPaused = false, gameOver = false, pointerLockUnavailable = false, wave = 0, lastTime = 0;
      let fireCooldown = 0, reloadTimer = 0, hurtFlash = 0, muzzleFlash = 0;
      let hitMarkerTimeout = 0, hitConfirmationTimeout = 0;
      let reloadDuration = 0;
      let firing = false, aiming = false, toastTimeout = 0, knifeSwing = 0, movementBob = 0;
      let weaponRecoil = 0, recoilPitch = 0, recoilYaw = 0, weaponLagX = 0, dashTimer = 0, dashCooldown = 0;
      let dashDirectionX = 0, dashDirectionY = 0;
      const dashDuration = .38;
      let touchMovementX = 0, touchMovementY = 0, lookPointerId = null, lastLookX = 0, lastLookY = 0;
      let touchStickPointerId = null;
      let grenadeCooldown = 0, flashbangCooldown = 0, grenadeAnimation = 0, flashbangAnimation = 0;
      let grenades = 2, flashbangs = 1;
      let grenadeFlash = 0, damageMessageTimer = 0, footstepsTimer = 0;
      const controlSettings = { mouseSensitivity: 1, scopeSensitivity: .25, fieldOfView: 82, masterVolume: .7 };
      let settingsReturnToPause = false;
      let reloadKind = "";
      let lastEscapePress = 0;
      let pointerLockPauseAt = 0;
      let escapeRunningBeforeFirst = false;
      let suppressPointerLockPauseUntil = 0;
      let operatorName = "", selectedMode = "ffa-waves", gameMode = "waves";
      let roomMessageTimeout = 0, profileReturnScreen = mainMenu;

      try {
        operatorName = localStorage.getItem("blacksite.operator") || "";
      } catch (error) {
        console.warn("Local profile storage is unavailable.", error);
      }

      try {
        const savedSettings = JSON.parse(localStorage.getItem("blacksite.settings") || "{}");
        if (Number.isFinite(savedSettings.mouseSensitivity)) {
          controlSettings.mouseSensitivity = Math.min(3, Math.max(.2, savedSettings.mouseSensitivity));
        }
        if (Number.isFinite(savedSettings.scopeSensitivity)) {
          controlSettings.scopeSensitivity = Math.min(1, Math.max(.1, savedSettings.scopeSensitivity));
        }
        if (Number.isFinite(savedSettings.fieldOfView)) {
          controlSettings.fieldOfView = Math.min(110, Math.max(65, savedSettings.fieldOfView));
        }
        if (Number.isFinite(savedSettings.masterVolume)) {
          controlSettings.masterVolume = Math.min(1, Math.max(0, savedSettings.masterVolume));
        }
      } catch (error) {
        console.warn("Saved control settings could not be loaded.", error);
      }

      function syncSettingsControls() {
        const sensitivity = document.querySelector("#sensitivity-setting");
        const scopeSensitivity = document.querySelector("#scope-sensitivity-setting");
        const fieldOfView = document.querySelector("#fov-setting");
        const masterVolume = document.querySelector("#volume-setting");
        sensitivity.value = controlSettings.mouseSensitivity;
        scopeSensitivity.value = controlSettings.scopeSensitivity;
        fieldOfView.value = controlSettings.fieldOfView;
        masterVolume.value = controlSettings.masterVolume;
        document.querySelector("#sensitivity-value").value = `${controlSettings.mouseSensitivity.toFixed(2)}x`;
        document.querySelector("#scope-sensitivity-value").value = `${controlSettings.scopeSensitivity.toFixed(2)}x`;
        document.querySelector("#fov-value").value = `${controlSettings.fieldOfView}°`;
        document.querySelector("#volume-value").value = `${Math.round(controlSettings.masterVolume * 100)}%`;
        audioManager.setMasterVolume(controlSettings.masterVolume);
      }

      function saveControlSettings() {
        try {
          localStorage.setItem("blacksite.settings", JSON.stringify(controlSettings));
        } catch (error) {
          console.warn("Control settings could not be saved.", error);
          setCombatMessage("SETTINGS COULD NOT BE SAVED", 1800);
        }
      }

      function openSettings(fromPause = false) {
        settingsReturnToPause = fromPause;
        showMenu(settingsScreen);
      }

      async function toggleFullscreen() {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          } else {
            await document.querySelector(".game-shell").requestFullscreen();
          }
        } catch (error) {
          console.error("Could not change fullscreen mode.", error);
          setCombatMessage("FULLSCREEN IS NOT AVAILABLE", 1800);
        }
      }

      function syncFullscreenButton() {
        const fullscreen = Boolean(document.fullscreenElement);
        const button = document.querySelector("#fullscreen-button");
        button.textContent = fullscreen ? "Exit fullscreen" : "Fullscreen";
        button.setAttribute("aria-label", fullscreen ? "Exit fullscreen" : "Enter fullscreen");
        requestAnimationFrame(resize);
      }

      function closeSettings() {
        if (settingsReturnToPause) {
          menuScreens.forEach(menu => { menu.hidden = true; });
          settingsScreen.hidden = true;
          overlay.hidden = false;
          document.querySelector("#pause-button").disabled = false;
          document.querySelector("#pause-settings-button").hidden = false;
          settingsReturnToPause = false;
          return;
        }
        showMenu(mainMenu);
      }

      function disconnectPeer() {
        const connection = networkConnection;
        networkConnection = null;
        if (connection?.open) connection.close();
        if (networkPeer) {
          networkPeer.destroy();
          networkPeer = null;
        }
        if (networkStateTimer) clearInterval(networkStateTimer);
        networkStateTimer = 0;
        networkRole = "";
        roomCode = "";
        roomConfiguration = null;
        removeRemoteModel();
        networkManager.reset();
        updateRoomConfigurationControls();
      }

      function teardownMatch(disconnect = false) {
        running = false;
        locallyPaused = false;
        gameOver = false;
        firing = false;
        aiming = false;
        grenadeAim = false;
        keys.clear();
        resetTouchControls();
        if (networkStateTimer) clearInterval(networkStateTimer);
        networkStateTimer = 0;
        clearScheduledTimeouts();
        transientEffects.forEach(effect => {
          scene.remove(effect.object);
        });
        transientEffects.length = 0;
        if (grenadeArc) {
          scene.remove(grenadeArc);
          grenadeArc.geometry.dispose();
          grenadeArc.material.dispose();
          grenadeArc = null;
        }
        explosions.length = 0;
        enemies.length = 0;
        for (const model of enemyModels.values()) scene.remove(model);
        enemyModels.clear();
        for (const ghost of replayGhosts.values()) {
          scene.remove(ghost);
          ghost.traverse(object => object.geometry?.dispose());
        }
        replayGhosts.clear();
        replayBuffer.reset();
        replayPlayback = false;
        document.querySelector("#replay-indicator").hidden = true;
        document.querySelector(".stage").classList.remove("is-replaying");
        vfxSystem.clearTransient();
        if (disconnect) disconnectPeer();
        player.reset(getPlayerSpawnPosition(""));
        player.spawnInvulnerability = 0;
        weaponManager.resetAmmo();
        weaponManager.select(0);
        player.weaponIndex = 0;
        player.score = 0;
        wave = 0;
        killStreak = 0;
        updateWeaponHud();
        document.querySelector("#health").textContent = "100";
        document.querySelector("#health-fill").style.width = "100%";
        document.querySelector("#score").textContent = "0000";
        grenades = 2;
        flashbangs = 1;
        document.querySelector("#grenade-count").textContent = grenades;
        document.querySelector("#flash-count").textContent = flashbangs;
        document.querySelector("#spawn-shield-overlay").classList.remove("active");
        document.querySelector("#damage-overlay").classList.remove("visible", "flashbang");
        document.querySelector("#hit-marker").classList.remove("visible");
        document.querySelector("#hit-confirmation").classList.remove("visible");
        document.querySelector("#weapon-toast").classList.remove("visible");
        document.querySelector("#pause-button").textContent = "Pause";
        document.querySelector("#pause-button").disabled = true;
        audioManager.setCombatIntensity(0);
      }

      if (operatorName) {
        profileScreen.hidden = true;
        mainMenu.hidden = false;
        document.querySelector("#menu-username").textContent = operatorName;
      }

      function showMenu(screen) {
        profileReturnScreen = screen === profileModal ? menuScreens.find(menu => menu !== profileModal && !menu.hidden) || mainMenu : screen;
        if ((running || gameOver) && screen !== settingsScreen) teardownMatch(true);
        menuScreens.forEach(menu => { menu.hidden = menu !== screen; });
        overlay.hidden = true;
        const keepMultiplayerSimulation = screen === settingsScreen && networkConnection?.open && running;
        if (!keepMultiplayerSimulation) {
          running = false;
          locallyPaused = false;
        }
        firing = false;
        aiming = false;
        keys.clear();
        document.querySelector("#pause-button").disabled = true;
        updateAimHud();
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }

      function ensureAudio() {
        audioManager.unlock();
      }

      function scheduleTimeout(callback, delay) {
        let timer = 0;
        timer = window.setTimeout(() => {
          pendingTimeouts.delete(timer);
          callback();
        }, delay);
        pendingTimeouts.add(timer);
        return timer;
      }

      function clearScheduledTimeouts() {
        for (const timer of pendingTimeouts) window.clearTimeout(timer);
        pendingTimeouts.clear();
      }

      function cancelScheduledTimeout(timer) {
        window.clearTimeout(timer);
        pendingTimeouts.delete(timer);
      }

      function playSound(type, position = new THREE.Vector3(player.x, 1, -player.y), options = {}) {
        audioManager.play(type, position, options);
      }

      function setCombatMessage(message, duration = 1400) {
        const element = document.querySelector("#combat-message");
        element.textContent = message;
        cancelScheduledTimeout(roomMessageTimeout);
        roomMessageTimeout = scheduleTimeout(() => { element.textContent = ""; }, duration);
      }

      function showHitConfirmation(label, noScope = false) {
        const confirmation = document.querySelector("#hit-confirmation");
        confirmation.classList.toggle("no-scope", noScope);
        confirmation.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a8.6 8.6 0 0 0-5.2 15.45V22l5.2-2.2 5.2 2.2v-4.05A8.6 8.6 0 0 0 12 2.5Zm-2.6 7.1a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm5.2 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM9 15h6l-3 2.2L9 15Z"/></svg>${label}`;
        confirmation.classList.remove("visible");
        void confirmation.offsetWidth;
        confirmation.classList.add("visible");
        cancelScheduledTimeout(hitConfirmationTimeout);
        hitConfirmationTimeout = scheduleTimeout(() => confirmation.classList.remove("visible"), 1000);
      }

      function showHitMarker() {
        hitMarker.classList.remove("visible");
        void hitMarker.offsetWidth;
        hitMarker.classList.add("visible");
        cancelScheduledTimeout(hitMarkerTimeout);
        hitMarkerTimeout = scheduleTimeout(() => hitMarker.classList.remove("visible"), 1000);
      }

      function awardKillstreak() {
        killStreak++;
        if (killStreak === 3) {
          enemies.forEach(enemy => { enemy.uavRevealTimer = 7; });
          setCombatMessage("UAV ACTIVE / HOSTILES REVEALED", 2200);
          playSound("hit", undefined, { volume: .8 });
        } else if (killStreak === 5) {
          const targets = enemies.slice(0, 2);
          targets.forEach(enemy => {
            const position = new THREE.Vector3(enemy.x, .2, -enemy.y);
            vfxSystem.spawnExplosion(position, "#d4a65e");
            enemy.health -= 70;
            if (enemy.health <= 0) eliminateEnemy(enemy);
          });
          setCombatMessage("AIRSTRIKE INBOUND", 1800);
        }
      }

      function openProfile(name, detail) {
        const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
        document.querySelector("#profile-card-name").textContent = name;
        document.querySelector("#profile-avatar").textContent = initials || "OP";
        document.querySelector("#profile-card-info").textContent = detail;
        showMenu(profileModal);
      }

      const leaderboardApi = window.BLACKSITE_API_URL || "http://127.0.0.1:8765/api";

      async function submitMatchResult() {
        if (resultSubmitted) return;
        resultSubmitted = true;
        const status = document.querySelector("#leaderboard-status");
        status.textContent = "Saving match result…";
        try {
          const response = await fetch(`${leaderboardApi}/leaderboard`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: operatorName, score: player.score, mode: gameMode })
          });
          if (!response.ok) throw new Error(`Leaderboard API returned ${response.status}`);
        } catch (error) {
          console.warn("The match result could not be submitted.", error);
          status.textContent = "Leaderboard unavailable. Start the optional local leaderboard server to save scores.";
          return;
        }
        try {
          await loadLeaderboard();
        } catch (error) {
          console.warn("The leaderboard could not be loaded after saving the match.", error);
          status.textContent = "Match result saved, but the leaderboard could not be loaded.";
        }
      }

      async function loadLeaderboard() {
        const response = await fetch(`${leaderboardApi}/leaderboard?mode=${encodeURIComponent(gameMode)}`);
        if (!response.ok) throw new Error(`Leaderboard API returned ${response.status}`);
        const rows = await response.json();
        const list = document.querySelector("#leaderboard-list");
        list.replaceChildren();
        rows.forEach(row => {
          const item = document.createElement("li");
          item.append(document.createTextNode(row.name));
          const score = document.createElement("span");
          score.textContent = String(row.score);
          item.append(score);
          list.append(item);
        });
        document.querySelector("#leaderboard-status").textContent =
          rows.length ? `${rows.length} best ${gameMode.toUpperCase()} scores` : "No scores recorded yet.";
      }

      function playMatchReplay() {
        if (!replayBuffer.startPlayback(performance.now())) {
          document.querySelector("#leaderboard-status").textContent = "Replay unavailable: not enough recorded match history.";
          return;
        }
        replayPlayback = true;
        overlay.hidden = true;
        document.querySelector("#replay-indicator").hidden = false;
      }

      function setRoomMessage(message, isError = false) {
        const status = document.querySelector("#room-message");
        status.textContent = message;
        status.style.color = isError ? "#ef9b7c" : "";
      }

      function makeRoomCode() {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const random = new Uint8Array(8);
        window.crypto.getRandomValues(random);
        return `bs-${Array.from(random, value => alphabet[value % alphabet.length]).join("").toLowerCase()}`;
      }

      function updateRoomPanel(message = "Create a room or enter a host's invite code to connect.") {
        const list = document.querySelector("#room-list");
        const details = document.querySelector("#room-details");
        list.replaceChildren();
        details.replaceChildren();
        const heading = document.createElement("div");
        heading.className = "kicker";
        heading.textContent = networkRole ? `PEER ROOM / ${roomCode}` : "DIRECT WEBRTC ROOM";
        const description = document.createElement("p");
        description.textContent = message;
        details.append(heading, description);
        const disconnectButton = document.querySelector("#join-room-button");
        disconnectButton.disabled = !networkPeer && !networkConnection;
        document.querySelector("#servers-kicker").textContent = "PEER-TO-PEER / PRIVATE ROOM";
        document.querySelector("#servers-title").textContent = "PRIVATE LOBBY";
        updateRoomConfigurationControls();
      }

      function canConfigureCurrentRoom() {
        return networkRole === "host" && Boolean(networkPeer?.open) &&
          Boolean(roomConfiguration) && !networkConnection?.open;
      }

      function updateRoomConfigurationControls() {
        const configureButton = document.querySelector("#configure-room-button");
        const panel = document.querySelector("#room-config-panel");
        const canConfigure = canConfigureCurrentRoom();
        configureButton.disabled = !canConfigure;
        if (!canConfigure) panel.hidden = true;
      }

      function toggleRoomConfiguration() {
        if (!canConfigureCurrentRoom()) {
          setRoomMessage("Create an active room before changing its settings.", true);
          return;
        }
        const panel = document.querySelector("#room-config-panel");
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
          document.querySelector("#room-mode-setting").value = roomConfiguration.mode;
          document.querySelector("#room-map-setting").value = roomConfiguration.mapId;
        }
      }

      function applyRoomConfiguration() {
        if (!canConfigureCurrentRoom()) {
          setRoomMessage("Room settings can only be applied to an active host room.", true);
          return;
        }
        const mode = document.querySelector("#room-mode-setting").value;
        const mapId = document.querySelector("#room-map-setting").value;
        if (!["ffa-waves", "duel", "ffa", "tdm"].includes(mode) || !mapDefinitions[mapId]) {
          setRoomMessage("Choose a supported match mode and map.", true);
          return;
        }
        roomConfiguration = { mode, mapId };
        document.querySelector("#room-config-panel").hidden = true;
        setRoomMessage(`Room settings saved: ${mode.toUpperCase()} on ${mapDefinitions[mapId].name}.`);
      }

      function sendPeerMessage(message) {
        if (networkConnection?.open) networkConnection.send(message);
      }

      function sendPlayerState() {
        if (!networkConnection?.open) return;
        const horizontalLook = Math.cos(playerPitch);
        sendPeerMessage(networkManager.createSnapshot({
          type: "state",
          x: player.x,
          y: player.y,
          position: { x: player.x, y: 1.65 - (dashTimer > 0 ? .22 : 0), z: -player.y },
          angle: player.angle,
          pitch: playerPitch,
          cameraDirection: {
            x: Math.cos(player.angle) * horizontalLook,
            y: Math.sin(playerPitch),
            z: -Math.sin(player.angle) * horizontalLook
          },
          health: player.health,
          spawnShielded: player.spawnInvulnerability > 0,
          weapon: player.weaponIndex,
          mapId: activeMapId,
          firing
        }));
      }

      function removeRemoteModel() {
        if (remoteModel) {
          scene.remove(remoteModel);
          for (const resource of remoteModel.userData.disposableResources || []) resource.dispose();
        }
        remoteModel = null;
        remotePlayer = null;
        networkManager.reset();
      }

      function applyRemoteShot(angle, pitch, weaponIndex) {
        if (!running || gameOver || player.spawnInvulnerability > 0 || gameMode === "coop" ||
          player.health <= 0 || !remotePlayer) return;
        const weapon = weapons[weaponIndex];
        const dx = player.x - remotePlayer.x;
        const dy = player.y - remotePlayer.y;
        const along = dx * Math.cos(angle) + dy * Math.sin(angle);
        const perpendicular = Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle));
        const shotHeight = 1.25 + Math.tan(pitch) * along;
        if (along <= 0 || along > (weapon.range || 1.8) || perpendicular > .34 ||
          Math.abs(shotHeight - 1.05) > .85 ||
          castRayFrom(remotePlayer.x, remotePlayer.y, angle).distance < along - .2) return;
        player.health = Math.max(0, player.health - weapon.damage);
        document.querySelector("#health").textContent = player.health;
        const fill = document.querySelector("#health-fill");
        fill.style.width = `${player.health}%`;
        fill.style.background = player.health < 35 ? "#dd6d58" : "#c1e16d";
        document.querySelector("#damage-overlay").classList.add("visible");
        scheduleTimeout(() => document.querySelector("#damage-overlay").classList.remove("visible"), 300);
        setCombatMessage(`HIT BY ${weapon.short}`);
        sendPlayerState();
        if (player.health === 0) {
          sendPeerMessage({ type: "match-end" });
          endGame({ replay: true });
        }
      }

      function handlePeerData(data) {
        if (!data || typeof data !== "object") return;
        if (data.type === "match-end" && networkConnection?.open && !gameOver) {
          endGame({ won: true });
          return;
        }
        if (data.type === "room-config" && networkRole !== "host" &&
          ["ffa-waves", "duel", "ffa", "tdm"].includes(data.mode) &&
          typeof data.mapId === "string" && mapDefinitions[data.mapId]) {
          selectedMode = data.mode;
          selectedMapId = data.mapId;
          gameMode = data.mode === "ffa-waves" ? "coop" : data.mode;
          if (activeMapId !== data.mapId) loadMap(data.mapId);
          if (running) startGame(gameMode, true, { acquirePointerLock: false });
          return;
        }
        if (data.type === "ack" && networkRole !== "host" &&
          Number.isInteger(data.sequence) && data.position &&
          Number.isFinite(data.position.x) && Number.isFinite(data.position.z)) {
          networkManager.reconcile(data);
          return;
        }
        if (data.type === "state" && Number.isFinite(data.x) && Number.isFinite(data.y) &&
          Number.isFinite(data.angle) && Number.isFinite(data.health) && Number.isInteger(data.weapon) &&
          data.position && Number.isFinite(data.position.x) && Number.isFinite(data.position.y) &&
          Number.isFinite(data.position.z) && data.cameraDirection &&
          Number.isFinite(data.cameraDirection.x) && Number.isFinite(data.cameraDirection.y) &&
          Number.isFinite(data.cameraDirection.z) &&
          typeof data.mapId === "string" && mapDefinitions[data.mapId] &&
          Number.isFinite(data.pitch) && typeof data.firing === "boolean" &&
          (data.spawnShielded === undefined || typeof data.spawnShielded === "boolean") &&
          data.health >= 0 && data.health <= 100 && data.weapon >= 0 && data.weapon < weapons.length) {
          if (networkRole === "host" && data.mapId !== activeMapId) {
            sendPlayerState();
            return;
          }
          if (networkRole !== "host" && activeMapId !== data.mapId) {
            loadMap(data.mapId);
            selectedMapId = data.mapId;
            const spawn = getPlayerSpawnPosition();
            player.x = spawn.x;
            player.y = spawn.y;
          }
          if (data.mapId !== activeMapId) return;
          const accepted = networkManager.pushSnapshot(data, {
            maxSpeed: 10,
            canOccupy: (x, y) => canOccupyOnMap(mapDefinitions[data.mapId].grid, x, y, .24)
          });
          if (!accepted) {
            if (networkRole === "host" && Number.isInteger(data.sequence) && networkManager.lastAuthoritative) {
              sendPeerMessage({
                type: "ack", sequence: data.sequence,
                position: networkManager.lastAuthoritative, mapId: activeMapId
              });
            }
            return;
          }
          if (networkRole === "host") {
            sendPeerMessage({
              type: "ack", sequence: accepted.sequence,
              position: accepted.position, mapId: activeMapId
            });
          }
          if (accepted.health === 0 && running && !gameOver) endGame({ won: true });
          return;
        }
        if (data.type === "shot" && Number.isFinite(data.angle) && Number.isFinite(data.pitch) &&
          Number.isInteger(data.weapon) && data.weapon >= 0 && data.weapon < weapons.length) {
          if (remotePlayer) {
            const soundType = ["rifle", "sniper", "shotgun", "smg", "knife"][data.weapon];
            playSound(soundType, new THREE.Vector3(remotePlayer.x, 1, -remotePlayer.y));
            const origin = new THREE.Vector3(remotePlayer.x, 1.25, -remotePlayer.y);
            const direction = new THREE.Vector3(
              Math.cos(data.angle) * Math.cos(data.pitch),
              Math.sin(data.pitch),
              -Math.sin(data.angle) * Math.cos(data.pitch)
            );
            addTracer(origin, origin.clone().addScaledVector(direction, 5), "#f4d57a");
          }
          applyRemoteShot(data.angle, data.pitch, data.weapon);
        }
      }

      function attachPeerConnection(connection) {
        if (networkConnection && networkConnection.open) {
          connection.close();
          return;
        }
        networkConnection = connection;
        connection.on("open", () => {
          document.querySelector("#join-room-button").disabled = false;
          document.querySelector("#room-code-input").value = roomCode;
          const roomMode = networkRole === "host" && roomConfiguration ? roomConfiguration.mode : selectedMode;
          const roomMap = networkRole === "host" && roomConfiguration ? roomConfiguration.mapId : selectedMapId;
          updateRoomPanel(`Connected to ${connection.peer}. Starting ${roomMode.toUpperCase()}...`);
          selectedMapId = roomMap;
          gameMode = roomMode === "ffa-waves" ? "coop" : roomMode;
          startGame(gameMode, true, { acquirePointerLock: false });
          if (networkRole === "host" && roomConfiguration) {
            sendPeerMessage({ type: "room-config", mode: roomConfiguration.mode, mapId: roomConfiguration.mapId });
          }
          updateRoomConfigurationControls();
          sendPlayerState();
          if (networkStateTimer) clearInterval(networkStateTimer);
          networkStateTimer = window.setInterval(sendPlayerState, 50);
        });
        connection.on("data", handlePeerData);
        connection.on("close", () => {
          if (networkConnection !== connection) return;
          networkConnection = null;
          networkManager.reset();
          if (networkStateTimer) clearInterval(networkStateTimer);
          networkStateTimer = 0;
          removeRemoteModel();
          setRoomMessage("The peer connection closed.");
          updateRoomPanel("The peer connection closed.");
          updateRoomConfigurationControls();
        });
        connection.on("error", error => {
          console.error("Peer connection error.", error);
          setRoomMessage("The peer connection failed. Check the invite code and try again.", true);
        });
      }

      function createPrivateRoom() {
        if (!window.Peer) {
          setRoomMessage("PeerJS failed to load. Check your internet connection and reload.", true);
          return;
        }
        disconnectPeer();
        roomConfiguration = null;
        networkRole = "host";
        roomCode = makeRoomCode();
        updateRoomConfigurationControls();
        document.querySelector("#room-code-input").value = roomCode;
        setRoomMessage("Connecting to the PeerJS signaling service...");
        networkPeer = new Peer(roomCode, { debug: 1 });
        networkPeer.on("open", id => {
          roomCode = id;
          if (!roomConfiguration) roomConfiguration = { mode: selectedMode, mapId: selectedMapId };
          document.querySelector("#room-code-input").value = id;
          setRoomMessage(`Room is ready. Share this invite code: ${id}`);
          updateRoomPanel(`Waiting for one player to connect to ${id}.`);
        });
        networkPeer.on("connection", connection => attachPeerConnection(connection));
        networkPeer.on("error", error => {
          console.error("Peer room error.", error);
          roomConfiguration = null;
          updateRoomConfigurationControls();
          setRoomMessage(`Could not create the room (${error.type || "network error"}). Try again.`, true);
        });
        networkPeer.on("disconnected", () => {
          setRoomMessage("PeerJS signaling disconnected. Reconnect or create a new room.", true);
          updateRoomConfigurationControls();
          networkPeer?.reconnect();
        });
      }

      function connectToRoom() {
        if (!window.Peer) {
          setRoomMessage("PeerJS failed to load. Check your internet connection and reload.", true);
          return;
        }
        const code = document.querySelector("#room-code-input").value.trim().toLowerCase();
        if (!/^bs-[a-z0-9]{8}$/.test(code)) {
          setRoomMessage("Enter a valid 8-character room code starting with bs-.", true);
          return;
        }
        disconnectPeer();
        roomConfiguration = null;
        roomCode = code;
        networkRole = "guest";
        updateRoomConfigurationControls();
        setRoomMessage(`Connecting to ${code}...`);
        networkPeer = new Peer(undefined, { debug: 1 });
        networkPeer.on("open", () => {
          attachPeerConnection(networkPeer.connect(code, { reliable: true }));
        });
        networkPeer.on("error", error => {
          console.error("Peer join error.", error);
          setRoomMessage(`Could not connect (${error.type || "network error"}). Verify the room code and try again.`, true);
        });
      }

      function openServerBrowser() {
        updateRoomPanel();
        setRoomMessage("");
        showMenu(serversMenu);
      }

      function joinSelectedRoom() {
        if (running || gameOver) teardownMatch(true);
        else disconnectPeer();
        updateRoomPanel();
        setRoomMessage("Disconnected from the peer room.");
      }

      function addGrenade(flash = false) {
        if (!running || locallyPaused) return;
        if (flash ? flashbangs <= 0 : grenades <= 0) {
          setCombatMessage(flash ? "NO FLASHBANGS" : "NO FRAG GRENADES", 700);
          return;
        }
        if (flash ? flashbangCooldown > 0 : grenadeCooldown > 0) return;
        if (flash) {
          flashbangCooldown = 3.5;
          flashbangs--;
          document.querySelector("#flash-count").textContent = flashbangs;
        } else {
          grenadeCooldown = 3.5;
          grenades--;
          document.querySelector("#grenade-count").textContent = grenades;
        }
        if (flash) flashbangAnimation = .7;
        else grenadeAnimation = .7;
        const distance = 3.3;
        const targetX = player.x + Math.cos(player.angle) * distance;
        const targetY = player.y + Math.sin(player.angle) * distance;
        let impactX = player.x, impactY = player.y;
        for (let step = 1; step <= 20; step++) {
          const t = step / 20;
          const x = player.x + (targetX - player.x) * t;
          const y = player.y + (targetY - player.y) * t;
          if (wallAt(x, y)) break;
          impactX = x; impactY = y;
        }
        const projectile = new THREE.Group();
        const bodyMaterial = cachedMaterial("grenade-body", flash ? "#a99e78" : "#59634d", { roughness: .7, metalness: .18 });
        const bandMaterial = cachedMaterial("grenade-band", flash ? "#e4d8ad" : "#252b25", { roughness: .5, metalness: .55 });
        const body = new THREE.Mesh(cachedCylinderGeometry(.095, .105, .2, 12), bodyMaterial);
        const cap = new THREE.Mesh(cachedCylinderGeometry(.045, .045, .045, 10), bandMaterial);
        const lever = new THREE.Mesh(cachedBoxGeometry(.16, .018, .035), bandMaterial);
        const travelTime = 340;
        body.castShadow = cap.castShadow = lever.castShadow = true;
        cap.position.y = .115;
        lever.position.set(.03, .14, 0);
        projectile.add(body, cap, lever);
        projectile.position.set(player.x, .95, -player.y);
        scene.add(projectile);
        const projectileFlight = { model: projectile, age: 0, duration: travelTime / 1000, startX: player.x, startY: player.y, impactX, impactY };
        transientEffects.push({ object: projectile, age: 0, duration: travelTime / 1000, type: "ordnance", flight: projectileFlight });
        scheduleTimeout(() => {
          if (!flash) {
            playSound("grenade", new THREE.Vector3(impactX, .15, -impactY), { refDistance: 4, rolloffFactor: .9 });
            grenadeFlash = .2;
            explosions.push({ x: impactX, y: impactY, age: 0, duration: 1.1 });
            addBlastEffect(new THREE.Vector3(impactX, .45, -impactY));
            for (const enemy of [...enemies]) {
              if (gameMode === "tdm" && enemy.team !== 1) continue;
              const distanceToBlast = Math.hypot(enemy.x - impactX, enemy.y - impactY);
              if (distanceToBlast > 3.8) continue;
              enemy.health -= 160 * (1 - distanceToBlast / 4.5);
              if (enemy.health <= 0) eliminateEnemy(enemy, { weaponIndex: player.weaponIndex });
            }
            setCombatMessage("FRAG DETONATED");
            if (gameMode === "tdm" ? !enemies.some(enemy => enemy.team === 1) :
              !isWaveMode() && enemies.length === 0) endGame();
          } else {
            playSound("flash", new THREE.Vector3(impactX, .15, -impactY), { refDistance: 3, rolloffFactor: 1.1 });
            grenadeFlash = 1.2;
            addImpactParticles(new THREE.Vector3(impactX, .35, -impactY), "#fff4ce");
            enemies.forEach(enemy => {
              const distanceToBlast = Math.hypot(enemy.x - impactX, enemy.y - impactY);
              const towardBlastX = impactX - enemy.x, towardBlastY = impactY - enemy.y;
              const facingDot = (enemy.facingX || 0) * towardBlastX + (enemy.facingY || 0) * towardBlastY;
              const lineOfSight = castRayFrom(enemy.x, enemy.y, Math.atan2(towardBlastY, towardBlastX)).distance;
              if (distanceToBlast <= 8 && facingDot > 0 && lineOfSight >= distanceToBlast - .25) enemy.stunned = 2.2;
            });
            const playerDistance = Math.hypot(player.x - impactX, player.y - impactY);
            const towardBlastX = impactX - player.x, towardBlastY = impactY - player.y;
            const playerFacingDot = Math.cos(player.angle) * towardBlastX + Math.sin(player.angle) * towardBlastY;
            const playerLineOfSight = castRayFrom(player.x, player.y, Math.atan2(towardBlastY, towardBlastX)).distance;
            if (playerDistance <= 8 && playerFacingDot > 0 && playerLineOfSight >= playerDistance - .25) {
              document.querySelector("#damage-overlay").classList.add("flashbang");
              scheduleTimeout(() => document.querySelector("#damage-overlay").classList.remove("flashbang"), 950);
            }
            setCombatMessage("FLASHBANG OUT");
          }
        }, travelTime);
      }

      function currentWeapon() {
        return weaponManager.current(player.weaponIndex);
      }

      function lookSensitivityMultiplier() {
        return aiming ? currentWeapon().scoped ? controlSettings.scopeSensitivity : .66 : 1;
      }

      function alignWeaponSight() {
        const sight = weaponSights[player.weaponIndex];
        if (!sight) return;
        camera.updateMatrixWorld(true);
        weaponAnchor.updateWorldMatrix(true, true);
        const sightInCamera = camera.worldToLocal(sight.getWorldPosition(new THREE.Vector3()));
        weaponAnchor.position.x -= sightInCamera.x;
        weaponAnchor.position.y -= sightInCamera.y;
        weaponAnchor.updateWorldMatrix(true, true);
      }

      function getMuzzleWorldPosition() {
        const muzzle = weaponMuzzles[player.weaponIndex];
        if (muzzle) {
          muzzle.updateWorldMatrix(true, false);
          return muzzle.getWorldPosition(new THREE.Vector3());
        }
        return camera.position.clone();
      }

      function isWaveMode() {
        return gameMode === "waves" || gameMode === "coop";
      }

      function getPlayerSpawnPosition(role = networkRole) {
        const definition = mapDefinitions[activeMapId];
        const grid = mapDefinitions[activeMapId].grid;
        const positions = [];
        const positionKeys = new Set();
        const addCandidate = position => {
          if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
          const worldPosition = new THREE.Vector3(position.x, 0, -position.y);
          if (!Number.isFinite(worldPosition.x) || !Number.isFinite(worldPosition.y) ||
            !Number.isFinite(worldPosition.z) || !canOccupyOnMap(grid, worldPosition.x, -worldPosition.z, .24)) return;
          const key = `${worldPosition.x}:${worldPosition.z}`;
          if (!positionKeys.has(key)) {
            positionKeys.add(key);
            positions.push({ x: worldPosition.x, y: -worldPosition.z });
          }
        };
        addCandidate(definition.spawn);
        for (const point of definition.enemySpawns || []) addCandidate({ x: point.x, y: -point.z });
        for (let row = 1; row < grid.length - 1; row++) {
          for (let column = 1; column < grid[row].length - 1; column++) {
            addCandidate({ x: column + .5, y: row + .5 });
          }
        }
        if (!positions.length) throw new Error(`Map "${activeMapId}" has no valid player spawn positions.`);
        const defaultSpawn = positions.find(position =>
          position.x === definition.spawn.x && position.y === definition.spawn.y
        ) || positions[0];
        if (role !== "guest" || !networkConnection?.open) return { ...defaultSpawn };
        const opponentSpawn = networkRole === "guest" && remotePlayer
          ? { x: remotePlayer.x, y: remotePlayer.y }
          : definition.spawn;
        const available = positions.filter(position =>
          Math.hypot(position.x - opponentSpawn.x, position.y - opponentSpawn.y) >= 4 &&
          !botAI.hasLineOfSight(grid, opponentSpawn, position)
        );
        const candidates = available.length ? available : positions;
        return candidates.reduce((farthest, position) =>
          Math.hypot(position.x - opponentSpawn.x, position.y - opponentSpawn.y) >
          Math.hypot(farthest.x - opponentSpawn.x, farthest.y - opponentSpawn.y) ? position : farthest,
        defaultSpawn);
      }

      function updateAimHud() {
        const scoped = aiming && currentWeapon().scoped;
        document.querySelector("#scope-overlay").hidden = !scoped;
        document.querySelector("#crosshair").hidden = scoped;
        document.querySelector(".stage").classList.toggle("is-aiming", aiming);
      }

      function updateWeaponHud() {
        const weapon = currentWeapon();
        document.querySelector("#weapon-label").textContent = weapon.name;
        document.querySelector("#ammo").textContent = weapon.melee ? "--" : weapon.ammo;
        document.querySelector("#magazine").textContent = weapon.melee ? "--" : weapon.magazine;
        document.querySelector("#reserve").textContent = weapon.melee ? "--" : String(weapon.reserve).padStart(3, "0");
        document.querySelectorAll(".weapon-slot").forEach((slot, index) => {
          slot.classList.toggle("active", index === player.weaponIndex);
          slot.setAttribute("aria-pressed", String(index === player.weaponIndex));
        });
        weaponModels.forEach((model, index) => {
          model.visible = index === player.weaponIndex && !(aiming && weapon.scoped);
        });
      }

      function selectWeapon(index) {
        if (!Number.isInteger(index) || index < 0 || index >= weapons.length || index === player.weaponIndex) return;
        if (!weaponManager.select(index)) return;
        player.weaponIndex = index;
        reloadTimer = 0;
        aiming = false;
        fireCooldown = 0;
        updateAimHud();
        updateWeaponHud();
        const toast = document.querySelector("#weapon-toast");
        toast.textContent = currentWeapon().name;
        toast.classList.add("visible");
        cancelScheduledTimeout(toastTimeout);
        toastTimeout = scheduleTimeout(() => toast.classList.remove("visible"), 900);
      }

      function resize() {
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(bounds.width, bounds.height, false);
        camera.aspect = bounds.width / Math.max(1, bounds.height);
        camera.updateProjectionMatrix();
      }

      function wallAt(x, y) {
        const mx = Math.floor(x), my = Math.floor(y);
        return my < 0 || mx < 0 || my >= map.length || mx >= map[my].length || map[my][mx] === "1";
      }

      function canOccupy(x, y, radius) {
        return !wallAt(x - radius, y - radius) && !wallAt(x + radius, y - radius) &&
          !wallAt(x - radius, y + radius) && !wallAt(x + radius, y + radius);
      }

      function movePlayer(dx, dy) {
        player.move(dx, dy, canOccupy);
      }

      function canOccupyOnMap(grid, x, y, radius) {
        const wall = (px, py) => {
          const mx = Math.floor(px), my = Math.floor(py);
          return my < 0 || mx < 0 || my >= grid.length || mx >= grid[my].length || grid[my][mx] !== "0";
        };
        return !wall(x - radius, y - radius) && !wall(x + radius, y - radius) &&
          !wall(x - radius, y + radius) && !wall(x + radius, y + radius);
      }

      function isInBattlefieldTrench() {
        if (activeMapId !== "battlefield") return false;
        let nearbyCover = 0;
        for (let offset = -1; offset <= 1; offset++) {
          if (offset === 0) continue;
          if (wallAt(player.x + offset, player.y) || wallAt(player.x, player.y + offset)) nearbyCover++;
        }
        return nearbyCover >= 2;
      }

      function movementInput() {
        const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) - touchMovementY;
        const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + touchMovementX;
        const length = Math.hypot(forward, strafe);
        if (length > 1) return { forward: forward / length, strafe: strafe / length };
        return { forward, strafe };
      }

      function isSprinting() {
        return keys.has("ShiftLeft") || keys.has("ShiftRight");
      }

      function resetTouchControls() {
        touchMovementX = 0;
        touchMovementY = 0;
        touchStickPointerId = null;
        lookPointerId = null;
        document.querySelector("#touch-stick-knob").style.transform = "translate(-50%, -50%)";
        document.querySelectorAll(".touch-action").forEach(button => button.classList.remove("active"));
        keys.delete("ShiftLeft");
        firing = false;
        aiming = false;
      }

      function createEnemyModel(enemy) {
        if (enemyRigTemplate) {
          const riggedModel = createRiggedEnemyModel(enemy);
          if (riggedModel) return riggedModel;
        }
        const group = new THREE.Group();
        const teamColor = enemy.type === "brute" ? "#46483f" :
          gameMode === "tdm" && enemy.team === 0 ? "#52747a" : "#59634d";
        const uniform = cachedMaterial(`enemy-uniform-${teamColor}`, teamColor, { roughness: .88 });
        const armor = cachedMaterial("enemy-armor", "#272e29", { metalness: .16, roughness: .74 });
        const visor = cachedMaterial("enemy-visor", "#c1e16d", { emissive: "#677d36", emissiveIntensity: .35 });
        const skin = cachedMaterial("enemy-skin", "#7d8069", { roughness: .94 });
        const hitboxMaterial = cachedMaterial("enemy-hitbox", "#ffffff", { transparent: true });
        hitboxMaterial.opacity = 0;
        hitboxMaterial.colorWrite = false;
        hitboxMaterial.depthWrite = false;
        const addPart = (geometry, material, position, name) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(...position);
          mesh.name = name;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = true;
          mesh.userData.enemyRef = enemy;
          group.add(mesh);
          return mesh;
        };
        const box = (size, material, position, name) =>
          addPart(cachedBoxGeometry(...size), material, position, name);
        const sphere = (radius, material, position, name) => {
          const key = `sphere:${radius}`;
          if (!staticGeometries.has(key)) staticGeometries.set(key, new THREE.SphereGeometry(radius, 12, 8));
          return addPart(staticGeometries.get(key), material, position, name);
        };
        const limb = (parent, x, y, length, radius, material, name) => {
          const pivot = new THREE.Group();
          pivot.position.set(x, y, 0);
          pivot.name = name;
          const geometryKey = `limb:${length}:${radius}`;
          if (!staticGeometries.has(geometryKey)) {
            staticGeometries.set(geometryKey, new THREE.CylinderGeometry(radius * .8, radius, length, 10));
          }
          const segment = new THREE.Mesh(staticGeometries.get(geometryKey), material);
          segment.name = name;
          segment.position.y = -length / 2;
          segment.castShadow = true;
          segment.userData.enemyRef = enemy;
          pivot.add(segment);
          parent.add(pivot);
          return pivot;
        };
        box([.48, .7, .28], uniform, [0, 1.05, 0], "torso");
        box([.54, .24, .33], armor, [0, 1.22, -.015], "vest");
        sphere(.19, skin, [0, 1.62, 0], "head");
        sphere(.205, armor, [0, 1.73, -.005], "helmet");
        box([.24, .045, .12], visor, [0, 1.63, -.175], "visor");
        box([.11, .13, .17], armor, [-.14, 1.12, -.18], "left-pouch");
        box([.11, .13, .17], armor, [.14, 1.12, -.18], "right-pouch");
        const leftLeg = limb(group, -.14, .72, .36, .095, uniform, "left-leg");
        const rightLeg = limb(group, .14, .72, .36, .095, uniform, "right-leg");
        const leftKnee = limb(leftLeg, 0, -.34, .34, .075, armor, "left-lower-leg");
        const rightKnee = limb(rightLeg, 0, -.34, .34, .075, armor, "right-lower-leg");
        const leftArm = limb(group, -.32, 1.34, .31, .073, uniform, "left-arm");
        const rightArm = limb(group, .32, 1.34, .31, .073, uniform, "right-arm");
        const leftElbow = limb(leftArm, 0, -.29, .3, .06, armor, "left-forearm");
        const rightElbow = limb(rightArm, 0, -.29, .3, .06, armor, "right-forearm");
        leftArm.rotation.x = rightArm.rotation.x = .62;
        leftElbow.rotation.x = rightElbow.rotation.x = -.3;
        box([.18, .1, .32], armor, [-.14, .08, -.04], "left-boot");
        box([.18, .1, .32], armor, [.14, .08, -.04], "right-boot");
        const botWeapons = new THREE.Group();
        botWeapons.position.set(0, 1.14, -.28);
        const botWeaponMaterials = [
          cachedMaterial("bot-rifle", "#343a31", { metalness: .55 }),
          cachedMaterial("bot-sniper", "#292f2c", { metalness: .7 }),
          cachedMaterial("bot-shotgun", "#554b39", { metalness: .45 }),
          cachedMaterial("bot-smg", "#303932", { metalness: .6 })
        ];
        for (let index = 0; index < 4; index++) {
          const weaponMesh = new THREE.Group();
          const length = [.4, .58, .48, .3][index];
          const receiver = new THREE.Mesh(cachedBoxGeometry(.11, .1, .2), botWeaponMaterials[index]);
          receiver.position.z = .02;
          const barrel = new THREE.Mesh(cachedBoxGeometry(.045, .045, length), botWeaponMaterials[index]);
          receiver.name = "bot-weapon-receiver";
          barrel.name = "bot-weapon-barrel";
          barrel.position.z = -.13 - length / 2;
          receiver.castShadow = barrel.castShadow = true;
          weaponMesh.add(receiver, barrel);
          botWeapons.add(weaponMesh);
          weaponMesh.visible = index === enemy.weaponIndex;
        }
        botWeapons.traverse(object => { if (object.isMesh) object.userData.isWeapon = true; });
        group.add(botWeapons);
        const hitboxes = new THREE.Group();
        const addHitbox = (geometry, position, hitZone) => {
          const hitbox = new THREE.Mesh(ensureGeometryBounds(geometry), hitboxMaterial);
          hitbox.position.set(...position);
          hitbox.userData.enemyRef = enemy;
          hitbox.userData.hitZone = hitZone;
          hitbox.userData.isHitbox = true;
          hitboxes.add(hitbox);
        };
        addHitbox(new THREE.SphereGeometry(.22, 10, 8), [0, 1.65, 0], "head");
        addHitbox(cachedBoxGeometry(.5, .66, .34), [0, 1.1, 0], "chest");
        addHitbox(cachedBoxGeometry(.23, .72, .24), [-.14, .39, 0], "limb");
        addHitbox(cachedBoxGeometry(.23, .72, .24), [.14, .39, 0], "limb");
        addHitbox(cachedBoxGeometry(.18, .62, .2), [-.35, 1.03, -.06], "limb");
        addHitbox(cachedBoxGeometry(.18, .62, .2), [.35, 1.03, -.06], "limb");
        group.add(hitboxes);
        group.userData.hitboxes = hitboxes;
        group.userData.leftLeg = leftLeg;
        group.userData.rightLeg = rightLeg;
        group.userData.leftArm = leftArm;
        group.userData.rightArm = rightArm;
        group.userData.leftKnee = leftKnee;
        group.userData.rightKnee = rightKnee;
        group.userData.leftElbow = leftElbow;
        group.userData.rightElbow = rightElbow;
        group.userData.weapons = botWeapons;
        group.traverse(object => {
          if (!object.isMesh || object.userData.isWeapon || object.userData.enemyRef) return;
          object.userData.enemyRef = enemy;
          if (!object.userData.hitZone) {
            object.userData.hitZone = /head|helmet|visor/i.test(object.name)
              ? "head"
              : /torso|vest|pouch/i.test(object.name) ? "chest" : "limb";
          }
        });
        group.scale.setScalar(enemy.type === "brute" ? 1.28 : 1);
        scene.add(group);
        enemyModels.set(enemy, group);
        return group;
      }

      function createRiggedEnemyModel(enemy) {
        const model = cloneSkeleton(enemyRigTemplate);
        const bones = [];
        model.traverse(object => {
          if (object.isBone) bones.push(object);
        });
        const findBone = pattern => bones.find(bone => pattern.test(bone.name));
        const handSocket = findBone(/^Hand_R$/i) ||
          findBone(/^(?:hand_r|mixamorigrightHand|right[_ -]?hand)$/i);
        if (!handSocket) {
          if (!warnedMissingHandSocket) {
            warnedMissingHandSocket = true;
            console.warn("The optional enemy rig has no Hand_R/right-hand bone; using the procedural bot.");
          }
          return null;
        }
        model.scale.setScalar(enemy.type === "brute" ? 1.15 : .9);
        const teamMaterial = cachedMaterial("rigged-enemy-uniform", "#59634d", { roughness: .88 });
        model.traverse(object => {
          if (!object.isMesh) return;
          ensureGeometryBounds(object.geometry);
          object.castShadow = true;
          object.receiveShadow = true;
          object.userData.enemyRef = enemy;
          object.userData.hitZone = /head|helmet/i.test(object.name)
            ? "head"
            : /spine|chest|torso/i.test(object.name) ? "chest" : "limb";
          if (!object.material) object.material = teamMaterial;
        });
        const hitboxMaterial = cachedMaterial("rigged-enemy-hitbox", "#ffffff", { transparent: true });
        hitboxMaterial.opacity = 0;
        hitboxMaterial.colorWrite = false;
        hitboxMaterial.depthWrite = false;
        const addBoneHitbox = (bone, zone, radius) => {
          if (!bone) return;
          const hitbox = new THREE.Mesh(ensureGeometryBounds(new THREE.SphereGeometry(radius, 10, 8)), hitboxMaterial);
          hitbox.userData.enemyRef = enemy;
          hitbox.userData.hitZone = zone;
          hitbox.userData.isHitbox = true;
          bone.add(hitbox);
        };
        addBoneHitbox(findBone(/head/i), "head", .2);
        addBoneHitbox(findBone(/chest|spine2|spine_02/i), "chest", .28);
        addBoneHitbox(findBone(/leftarm|rightarm|arm_[lr]/i), "limb", .13);
        addBoneHitbox(findBone(/leftupleg|rightupleg|thigh_[lr]/i), "limb", .14);

        const animationMixer = new THREE.AnimationMixer(model);
        const movementClip = enemyRigAnimations.find(clip => /run|walk|move/i.test(clip.name)) || enemyRigAnimations[0];
        if (movementClip) animationMixer.clipAction(movementClip).play();
        model.userData.rigged = true;
        model.userData.mixer = animationMixer;
        model.userData.weaponHand = handSocket;
        model.userData.weaponIndex = -1;
        scene.add(model);
        enemyModels.set(enemy, model);
        return model;
      }

      function updateRiggedWeapon(model, enemy) {
        if (model.userData.weaponIndex === enemy.weaponIndex) return;
        model.userData.weaponModel?.parent?.remove(model.userData.weaponModel);
        const weapon = weaponAssetLoader.createInstance(enemy.weaponIndex);
        model.userData.weaponModel = weapon;
        model.userData.weaponIndex = weapon ? enemy.weaponIndex : -1;
        if (!weapon) return;
        const handTransform = weaponAssetLoader.getHandOffset(enemy.weaponIndex);
        weapon.position.set(...handTransform.position);
        weapon.rotation.set(...handTransform.rotation);
        weapon.scale.multiplyScalar(handTransform.scale);
        weapon.userData.isWeapon = true;
        model.userData.weaponHand.add(weapon);
      }

      function loadEnemyRig() {
        const source = new URL("assets/characters/soldier.glb", document.baseURI).href;
        new GLTFLoader().load(source, gltf => {
          enemyRigTemplate = gltf.scene;
          enemyRigAnimations = gltf.animations || [];
          for (const [enemy, model] of enemyModels) {
            scene.remove(model);
            enemyModels.delete(enemy);
          }
        }, undefined, error => {
          if (error?.target?.status !== 404) console.warn(`Could not load optional enemy rig ${source}; using procedural bots.`, error);
        });
      }

      function updateEnemyModels(dt = 0) {
        const liveEnemies = new Set(enemies);
        for (const [enemy, model] of enemyModels) {
          if (liveEnemies.has(enemy)) continue;
          scene.remove(model);
          enemyModels.delete(enemy);
        }
        for (const enemy of enemies) {
          const model = enemyModels.get(enemy) || createEnemyModel(enemy);
          model.position.set(enemy.x, 0, -enemy.y);
          if (!model.userData.uavMarker) {
            const marker = new THREE.Mesh(
              new THREE.TorusGeometry(.24, .025, 6, 16),
              new THREE.MeshBasicMaterial({ color: "#e8503f" })
            );
            marker.rotation.x = Math.PI / 2;
            marker.position.y = 2.15;
            model.add(marker);
            model.userData.uavMarker = marker;
          }
          model.userData.uavMarker.visible = enemy.uavRevealTimer > 0;
          const faceAngle = Number.isFinite(enemy.faceAngle) ? enemy.faceAngle : Math.atan2(player.y - enemy.y, player.x - enemy.x);
          model.rotation.y = faceAngle - Math.PI / 2;
          if (model.userData.rigged) {
            model.userData.mixer.update(dt);
            updateRiggedWeapon(model, enemy);
            model.visible = enemy.health > 0;
            continue;
          }
          const gait = enemy.stunned > 0 ? 0 : Math.sin(enemy.phase) * .55;
          model.userData.leftLeg.rotation.x = gait;
          model.userData.rightLeg.rotation.x = -gait;
          model.userData.leftKnee.rotation.x = Math.max(0, -gait) * .8;
          model.userData.rightKnee.rotation.x = Math.max(0, gait) * .8;
          model.userData.leftArm.rotation.x = -gait * .55;
          model.userData.rightArm.rotation.x = gait * .55;
          model.userData.leftElbow.rotation.x = -.3 + Math.max(0, gait) * .35;
          model.userData.rightElbow.rotation.x = -.3 - Math.max(0, gait) * .35;
          model.userData.weapons.children.forEach((weapon, index) => { weapon.visible = index === enemy.weaponIndex; });
          model.visible = enemy.health > 0;
        }
      }

      loadEnemyRig();

      function createRemoteModel() {
        if (remoteModel) return remoteModel;
        remoteModel = new THREE.Group();
        remoteModel.userData.disposableResources = [];
        const uniform = cachedMaterial("remote-uniform", "#425d72", { roughness: .82 });
        const armor = cachedMaterial("remote-armor", "#1f2b34", { metalness: .18 });
        const marker = cachedMaterial("remote-marker", "#74d8ef", { emissive: "#338ba0", emissiveIntensity: .65 });
        const addPart = (geometry, material, position) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(...position);
          mesh.castShadow = true;
          mesh.frustumCulled = true;
          remoteModel.add(mesh);
          return mesh;
        };
        addPart(new THREE.CylinderGeometry(.19, .27, .7, 12), uniform, [0, 1.05, 0]);
        const headGeometryKey = "remote-head";
        if (!staticGeometries.has(headGeometryKey)) staticGeometries.set(headGeometryKey, new THREE.SphereGeometry(.2, 12, 8));
        addPart(staticGeometries.get(headGeometryKey), armor, [0, 1.62, 0]);
        addPart(cachedBoxGeometry(.54, .22, .34), armor, [0, 1.22, 0]);
        addPart(cachedBoxGeometry(.3, .035, .035), marker, [0, 1.64, -.18]);
        const createRemoteLimb = (x, y, length, radius, material) => {
          const pivot = new THREE.Group();
          pivot.position.set(x, y, 0);
          const geometry = new THREE.CylinderGeometry(radius * .8, radius, length, 10);
          remoteModel.userData.disposableResources.push(geometry);
          const segment = new THREE.Mesh(geometry, material);
          segment.position.y = -length / 2;
          segment.castShadow = true;
          pivot.add(segment);
          remoteModel.add(pivot);
          return pivot;
        };
        const leftLeg = createRemoteLimb(-.14, .72, .62, .09, armor);
        const rightLeg = createRemoteLimb(.14, .72, .62, .09, armor);
        const leftArm = createRemoteLimb(-.32, 1.35, .58, .07, uniform);
        const rightArm = createRemoteLimb(.32, 1.35, .58, .07, uniform);
        const weaponMaterial = cachedMaterial("remote-weapon", "#202522", { metalness: .72, roughness: .38 });
        addPart(cachedBoxGeometry(.12, .12, .52), weaponMaterial, [.3, 1.12, -.3]);
        const muzzle = new THREE.PointLight("#ffb65c", 0, 2.5, 2);
        muzzle.position.set(.3, 1.12, -.62);
        remoteModel.add(muzzle);
        const shieldGeometry = new THREE.SphereGeometry(.72, 16, 12);
        const shieldMaterial = new THREE.MeshBasicMaterial({
          color: "#77dfff",
          transparent: true,
          opacity: .16,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        remoteModel.userData.disposableResources.push(shieldGeometry, shieldMaterial);
        const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
        shield.position.y = .95;
        shield.visible = false;
        remoteModel.add(shield);
        remoteModel.userData.muzzleLight = muzzle;
        remoteModel.userData.spawnShield = shield;
        remoteModel.userData.leftLeg = leftLeg;
        remoteModel.userData.rightLeg = rightLeg;
        remoteModel.userData.leftArm = leftArm;
        remoteModel.userData.rightArm = rightArm;
        remoteModel.userData.phase = 0;
        remoteModel.userData.lastPosition = null;
        scene.add(remoteModel);
        return remoteModel;
      }

      function updateRemoteModel() {
        const interpolated = networkManager.sampleRemote();
        if (interpolated) remotePlayer = interpolated;
        if (!remotePlayer || !networkConnection?.open) {
          if (remoteModel) remoteModel.visible = false;
          return;
        }
        const model = createRemoteModel();
        model.visible = true;
        const last = model.userData.lastPosition;
        const distance = last ? Math.hypot(remotePlayer.x - last.x, remotePlayer.y - last.y) : 0;
        model.userData.phase += distance * 10;
        const gait = Math.sin(model.userData.phase) * Math.min(.55, distance * 18);
        model.userData.leftLeg.rotation.x = gait;
        model.userData.rightLeg.rotation.x = -gait;
        model.userData.leftArm.rotation.x = -.35 - gait * .5;
        model.userData.rightArm.rotation.x = -.35 + gait * .5;
        model.userData.lastPosition = { x: remotePlayer.x, y: remotePlayer.y };
        model.position.set(remotePlayer.x, 0, -remotePlayer.y);
        model.rotation.y = remotePlayer.angle - Math.PI / 2;
        model.userData.muzzleLight.intensity = remotePlayer.firing ? .75 : 0;
        model.userData.spawnShield.visible = Boolean(remotePlayer.spawnShielded);
        model.visible = remotePlayer.health > 0;
      }

      function getEnemySpawnPosition() {
        const definition = mapDefinitions[activeMapId];
        const isSafe = position => Number.isFinite(position.x) && Number.isFinite(position.y) &&
          canOccupyOnMap(map, position.x, position.y, .24);
        const authoredSpawns = (definition.enemySpawns || [])
          .map(point => new THREE.Vector3(point.x, 0, point.z))
          .filter(position => isSafe({ x: position.x, y: -position.z }))
          .map(position => ({ x: position.x, y: -position.z }));
        const openTiles = [];
        for (let row = 1; row < map.length - 1; row++) {
          for (let column = 1; column < map[row].length - 1; column++) {
            const worldPosition = new THREE.Vector3(column + .5, 0, -(row + .5));
            const position = { x: worldPosition.x, y: -worldPosition.z };
            if (isSafe(position)) openTiles.push(position);
          }
        }
        const safeFromPlayer = positions => positions.filter(position =>
          Math.hypot(position.x - player.x, position.y - player.y) >= 4 &&
          !botAI.hasLineOfSight(map, player, position)
        );
        const preferred = safeFromPlayer(authoredSpawns);
        const fallback = safeFromPlayer(openTiles);
        const candidates = preferred.length ? preferred : fallback.length ? fallback : authoredSpawns.length ? authoredSpawns : openTiles;
        if (!candidates.length) throw new Error(`Map "${activeMapId}" has no valid enemy spawn tiles.`);
        let farthestDistance = 0;
        for (const position of candidates) {
          farthestDistance = Math.max(farthestDistance, Math.hypot(
            position.x - player.x,
            position.y - player.y
          ));
        }
        const safest = candidates.filter(position =>
          Math.hypot(position.x - player.x, position.y - player.y) >= Math.max(4, farthestDistance - 2)
        );
        return safest[Math.floor(Math.random() * safest.length)];
      }

      function eliminateEnemy(enemy, { weaponIndex = player.weaponIndex, headshot = false, noScope = false } = {}) {
        const enemyIndex = enemies.indexOf(enemy);
        if (enemyIndex < 0) return false;
        const model = enemyModels.get(enemy);
        if (model) model.visible = false;
        vfxSystem.spawnBlood(new THREE.Vector3(enemy.x, .95, -enemy.y));
        enemies.splice(enemyIndex, 1);
        player.score += 100;
        awardKillstreak();
        replayBuffer.recordEvent(performance.now(), {
          type: "kill", weapon: weaponIndex, headshot, noScope, x: enemy.x, y: enemy.y
        });
        document.querySelector("#score").textContent = String(player.score).padStart(4, "0");
        return true;
      }

      function spawnWave() {
        wave++;
        const peerMatch = Boolean(networkConnection?.open);
        const count = peerMatch ? 0 : isWaveMode() ? Math.min(3 + wave * 2, 15) :
          gameMode === "duel" ? 1 : gameMode === "tdm" ? 4 : 5;
        const bruteIndex = gameMode === "duel" || (isWaveMode() ? wave < 2 : Math.random() >= .2)
          ? -1
          : count - 1;
        for (let i = 0; i < count; i++) {
          const spawn = getEnemySpawnPosition();
          const isBrute = i === bruteIndex;
          const weaponIndex = isBrute
            ? [1, 2][Math.floor(Math.random() * 2)]
            : [0, 0, 1, 2, 3][Math.floor(Math.random() * 5)];
          enemies.push({
            id: `enemy-${nextEnemyId++}`,
            x: spawn.x, y: spawn.y, type: isBrute ? "brute" : "soldier",
            health: isBrute ? 300 : 100, maxHealth: isBrute ? 300 : 100,
            movementMultiplier: isBrute ? .68 : 1, attack: Math.random() * 1.5,
            strafe: Math.random() < .5 ? 1 : -1, phase: Math.random() * Math.PI * 2,
            footstepTimer: Math.random() * .25, sprinting: false,
            team: gameMode === "tdm" ? (i < 2 ? 0 : 1) : 1,
            weaponIndex, state: "seek", stateTimer: 1 + Math.random() * 2, cover: null
          });
        }
        document.querySelector("#wave").textContent = isWaveMode()
          ? `WAVE ${String(wave).padStart(2, "0")}`
          : `MATCH ${String(wave).padStart(2, "0")}`;
        const modeTitle = { waves: "hostiles in the area", coop: "hostiles in the area", duel: "training opponent", ffa: "training opponents", tdm: "training opponents" }[gameMode];
        document.querySelector("#objective").textContent = peerMatch
          ? gameMode === "coop" ? "Peer co-op / no training bots in private rooms" : "Find and eliminate the opposing operator"
          : `${count} ${modeTitle}`;
      }

      function castRay(angle) {
        return castRayFrom(player.x, player.y, angle);
      }

      function castRayFrom(originX, originY, angle) {
        const rayX = Math.cos(angle), rayY = Math.sin(angle);
        let mapX = Math.floor(originX), mapY = Math.floor(originY);
        const deltaX = Math.abs(1 / (rayX || 1e-9)), deltaY = Math.abs(1 / (rayY || 1e-9));
        const stepX = rayX < 0 ? -1 : 1, stepY = rayY < 0 ? -1 : 1;
        let sideX = rayX < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
        let sideY = rayY < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;
        let side = 0;
        for (let i = 0; i < 40; i++) {
          if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
          else { sideY += deltaY; mapY += stepY; side = 1; }
          if (mapY < 0 || mapX < 0 || mapY >= map.length || mapX >= map[0].length || map[mapY][mapX] === "1") {
            const distance = Math.max(.001, side === 0 ? sideX - deltaX : sideY - deltaY);
            const hitPosition = side === 0 ? originY + distance * rayY : originX + distance * rayX;
            return { distance, side, mapX, mapY, rayX, rayY, wallU: hitPosition - Math.floor(hitPosition) };
          }
        }
        return { distance: 20, side: 0, mapX, mapY, rayX, rayY, wallU: 0 };
      }

      function addTracer(start, end, color = "#f3d58c") {
        vfxSystem.addTracer(start, end, color);
      }

      function addImpactParticles(position, color = "#d8c184") {
        vfxSystem.addImpactParticles(position, color);
      }

      function addBlastEffect(position) {
        vfxSystem.spawnExplosion(position);
      }

      function updateTransientEffects(dt) {
        vfxSystem.update(dt);
        for (let index = transientEffects.length - 1; index >= 0; index--) {
          const effect = transientEffects[index];
          effect.age += dt;
          if (effect.type === "ordnance") {
            const flight = effect.flight;
            const t = Math.min(1, effect.age / effect.duration);
            flight.model.position.set(
              THREE.MathUtils.lerp(flight.startX, flight.impactX, t),
              .95 + Math.sin(Math.PI * t) * 1.15,
              -THREE.MathUtils.lerp(flight.startY, flight.impactY, t)
            );
            flight.model.rotation.x += dt * 13;
            flight.model.rotation.z += dt * 9;
          } else if (effect.type === "particle") {
            effect.object.position.addScaledVector(effect.velocity, dt);
            effect.velocity.y -= 2.8 * dt;
            effect.object.material.opacity = 1 - effect.age / effect.duration;
          } else if (effect.type === "tracer") {
            effect.object.material.opacity = 1 - effect.age / effect.duration;
          } else if (effect.type === "blast") {
            const progress = effect.age / effect.duration;
            effect.object.scale.setScalar(.12 + progress * 2.8);
            effect.object.material.opacity = .8 * (1 - progress);
          }
          if (effect.age < effect.duration) continue;
          scene.remove(effect.object);
          transientEffects.splice(index, 1);
        }
      }

      function updateGrenadeArc() {
        const points = [];
        for (let step = 0; step <= 16; step++) {
          const t = step / 16;
          const distance = 3.3 * t;
          const x = player.x + Math.cos(player.angle) * distance;
          const y = player.y + Math.sin(player.angle) * distance;
          points.push(new THREE.Vector3(x, 1.05 + Math.sin(Math.PI * t) * 1.15, -y));
          if (wallAt(x, y)) break;
        }
        if (!grenadeArc) {
          grenadeArc = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineDashedMaterial({ color: "#c1e16d", dashSize: .12, gapSize: .08, transparent: true, opacity: .8 })
          );
          scene.add(grenadeArc);
        }
        grenadeArc.geometry.dispose();
        grenadeArc.geometry = new THREE.BufferGeometry().setFromPoints(points);
        grenadeArc.computeLineDistances();
        grenadeArc.visible = true;
      }

      function updateReplayGhosts(sample) {
        enemyModels.forEach(model => { model.visible = !sample; });
        for (const [id, ghost] of replayGhosts) {
          if (sample?.enemies.some(enemy => enemy.id === id)) continue;
          scene.remove(ghost);
          ghost.traverse(object => object.geometry?.dispose());
          replayGhosts.delete(id);
        }
        if (!sample) return;
        if (!replayGhostMaterial) {
          replayGhostMaterial = new THREE.MeshBasicMaterial({ color: "#b9d690", transparent: true, opacity: .48 });
        }
        for (const enemy of sample.enemies) {
          let ghost = replayGhosts.get(enemy.id);
          if (!ghost) {
            ghost = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.BoxGeometry(.48, .72, .28), replayGhostMaterial);
            torso.position.y = 1.08;
            const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 8), replayGhostMaterial);
            head.position.y = 1.62;
            const legs = new THREE.Mesh(new THREE.BoxGeometry(.34, .68, .2), replayGhostMaterial);
            legs.position.y = .39;
            ghost.add(torso, head, legs);
            scene.add(ghost);
            replayGhosts.set(enemy.id, ghost);
          }
          ghost.position.set(enemy.x, 0, -enemy.y);
          ghost.rotation.y = (enemy.angle || 0) - Math.PI / 2;
        }
      }

      function render(playbackSample = null) {
        updateEnemyModels();
        updateRemoteModel();
        updateReplayGhosts(playbackSample);
        const eyePosition = new THREE.Vector3(player.x, 1.65 - (dashTimer > 0 ? .22 : 0), -player.y);
        const viewDirection = new THREE.Vector3(
          Math.cos(player.angle) * Math.cos(playerPitch),
          Math.sin(playerPitch),
          -Math.sin(player.angle) * Math.cos(playerPitch)
        ).normalize();
        if (playbackSample) {
          const subject = playbackSample.player;
          const angle = subject.angle;
          camera.position.set(
            subject.x - Math.cos(angle) * 3.2 + Math.sin(angle) * .45,
            2.35 + Math.max(0, subject.pitch || 0) * .15,
            -subject.y + Math.sin(angle) * 3.2 - Math.cos(angle) * .45
          );
          const replayTarget = new THREE.Vector3(subject.x, 1.1, -subject.y);
          const cameraOffset = camera.position.clone().sub(replayTarget);
          cameraRaycaster.set(replayTarget, cameraOffset.clone().normalize());
          cameraRaycaster.near = 0;
          cameraRaycaster.far = cameraOffset.length();
          const replayObstruction = mapWalls ? cameraRaycaster.intersectObject(mapWalls, false)[0] : null;
          if (replayObstruction) {
            camera.position.copy(replayTarget).addScaledVector(
              cameraOffset.normalize(),
              Math.max(.45, replayObstruction.distance - .2)
            );
          }
          camera.lookAt(replayTarget);
          document.querySelector("#replay-indicator").hidden = false;
          document.querySelector(".stage").classList.add("is-replaying");
        } else {
          document.querySelector(".stage").classList.remove("is-replaying");
          const cameraOffset = viewDirection.clone().multiplyScalar(-.12);
          camera.position.copy(eyePosition).add(cameraOffset);
          cameraRaycaster.set(eyePosition, cameraOffset.clone().normalize());
          cameraRaycaster.near = 0;
          cameraRaycaster.far = cameraOffset.length();
          const cameraObstruction = mapGroup ? cameraRaycaster.intersectObject(mapGroup, true)[0] : null;
          if (cameraObstruction) {
            camera.position.copy(eyePosition).addScaledVector(
              cameraOffset.clone().normalize(),
              Math.max(0, cameraObstruction.distance - camera.near * 1.25)
            );
          }
          camera.rotation.set(playerPitch, player.angle - Math.PI / 2, 0);
        }
        if (remoteModel) remoteModel.visible = !playbackSample &&
          Boolean(remotePlayer?.health > 0 && networkConnection?.open);
        audioManager.setEnvironment(activeMapId, isInBattlefieldTrench());
        const flickerTime = performance.now() * .004;
        dynamicMapLights.forEach((light, index) => {
          light.intensity = light.userData.baseIntensity * (.82 + Math.sin(flickerTime + index * 2.1) * .18);
        });
        animatedMapProps.forEach((prop, index) => {
          prop.rotation.y += .004 * (index % 2 ? -1 : 1);
          prop.position.y = prop.userData.baseY + Math.sin(flickerTime * .25 + prop.userData.phase) * .05;
        });
        if (grenadeAim) updateGrenadeArc();
        else if (grenadeArc) grenadeArc.visible = false;
        camera.fov = aiming
          ? currentWeapon().scoped ? 22 : Math.max(60, controlSettings.fieldOfView - (currentWeapon().attachments.optic ? 24 : 12))
          : controlSettings.fieldOfView;
        camera.updateProjectionMatrix();
        const aimWallDistance = castRay(player.angle).distance;
        aimRaycaster.set(camera.position, viewDirection);
        aimRaycaster.near = 0;
        aimRaycaster.far = Math.min(currentWeapon().range || 18, aimWallDistance - .04);
        const aimTargets = Array.from(enemyModels, ([enemy, model]) => enemy.health > 0 ? model : null).filter(Boolean);
        const hasAimTarget = aimRaycaster.far > 0 && aimRaycaster.intersectObjects(aimTargets, true).length > 0;
        document.querySelector("#crosshair").classList.toggle("targeting", hasAimTarget && !currentWeapon().scoped);
        document.querySelector("#scope-overlay").classList.toggle("targeting", hasAimTarget && currentWeapon().scoped);
        if (weaponAnchor) {
          weaponAnchor.visible = !playbackSample;
          const moving = movementInput().forward !== 0 || movementInput().strafe !== 0;
          const sprinting = moving && isSprinting();
          const aimOffset = aiming && !currentWeapon().scoped;
          const targetWeaponPosition = new THREE.Vector3(
            aimOffset ? .015 : .32,
            (aimOffset ? -.17 : -.3) + Math.sin(movementBob) * (sprinting ? .012 : .006) -
            weaponRecoil * .0008 - (dashTimer > 0 ? .06 : 0));
          targetWeaponPosition.z = -.48 + (aimOffset ? .12 : 0);
          targetWeaponPosition.x += Math.sin(performance.now() * .0018) * (moving ? .008 : .003) -
            weaponLagX * .00045;
          weaponAnchor.position.lerp(targetWeaponPosition, .22);
          const meleeArc = currentWeapon().melee ? Math.sin((1 - knifeSwing) * Math.PI) : 0;
          weaponAnchor.rotation.x = (dashTimer > 0 ? -.16 : 0) + weaponRecoil * .004 - meleeArc * .72;
          weaponAnchor.rotation.y = meleeArc * .62;
          weaponAnchor.rotation.z = dashTimer > 0 ? -.08 : currentWeapon().melee ? -knifeSwing * .32 : 0;
          if (aiming && !currentWeapon().scoped) alignWeaponSight();
          muzzleLight.intensity = muzzleFlash > 0 ? 3.5 : 0;
          weaponModels.forEach((model, index) => {
            model.visible = index === player.weaponIndex && !(aiming && currentWeapon().scoped);
          });
        }
        renderer.render(scene, camera);
      }

      function reload() {
        const weapon = currentWeapon();
        if (!running || locallyPaused || weapon.melee || reloadTimer > 0 || weapon.ammo === weapon.magazine || weapon.reserve <= 0) return;
        reloadTimer = weapon.reloadTime;
        reloadDuration = weapon.reloadTime;
        reloadKind = "reload";
        playSound("reload");
        document.querySelector("#objective").textContent = `Reloading ${weapon.short.toLowerCase()}...`;
      }

      function shoot() {
        if (!running || locallyPaused || fireCooldown > 0 || reloadTimer > 0) return;
        const weapon = currentWeapon();
        if (!weapon.melee && weapon.ammo <= 0) { reload(); return; }
        ensureAudio();
        const muzzlePosition = getMuzzleWorldPosition();
        const recoilScale = (aiming ? .3 : 1) * (weapon.attachments.suppressor ? .7 : 1);
        if (!weapon.melee) {
          weapon.ammo--;
          muzzleFlash = weapon.scoped ? .18 : .1;
          updateWeaponHud();
          const soundType = player.weaponIndex === 0 ? "rifle"
            : player.weaponIndex === 1 ? "sniper"
              : player.weaponIndex === 2 ? "shotgun" : "smg";
          const suppressed = weapon.attachments.suppressor;
          playSound(suppressed ? "suppressed" : soundType, muzzlePosition, {
            volume: suppressed ? .48 : 1,
            refDistance: suppressed ? 1.25 : 3.2,
            rolloffFactor: suppressed ? 2.2 : 1.35
          });
          vfxSystem.spawnMuzzleFlash(muzzlePosition);
          weaponRecoil = Math.max(weaponRecoil, (weapon.recoil || 7) * recoilScale);
        } else {
          knifeSwing = 1;
          playSound("knife");
        }
        fireCooldown = weapon.interval;
        const recoilStrength = weapon.recoil || 7;
        const pitchKick = recoilStrength * Math.PI / 180 * .075 * recoilScale;
        const yawKick = (Math.random() - .5) * recoilStrength * Math.PI / 180 * .09 * recoilScale;
        recoilPitch = Math.min(.18, recoilPitch + pitchKick);
        recoilYaw = Math.max(-.12, Math.min(.12, recoilYaw + yawKick));
        playerPitch = Math.max(-1.35, Math.min(1.35, playerPitch + pitchKick));
        player.angle += yawKick;
        if (weapon.chamberTime) {
          reloadTimer = weapon.chamberTime;
          reloadDuration = weapon.chamberTime;
          reloadKind = "chamber";
        }
        sendPeerMessage({ type: "shot", weapon: player.weaponIndex, angle: player.angle, pitch: playerPitch });
        const pelletCount = weapon.melee ? 1 : weapon.pellets || 1;
        const hits = new Map();
        for (let pellet = 0; pellet < pelletCount; pellet++) {
          const spread = weapon.melee ? .52 :
            weapon.spread * (aiming ? .45 : 1) * (weapon.attachments.foregrip ? .78 : 1);
          const shotAngle = player.angle + (pelletCount === 1 ? 0 : (Math.random() - .5) * spread);
          const maxDistance = weapon.melee ? 1.8 : weapon.range || 18;
          const targets = enemies
            .filter(enemy => gameMode !== "tdm" || enemy.team === 1)
            .map(enemy => enemyModels.get(enemy) || createEnemyModel(enemy));
          raycaster.set(
            camera.position,
            new THREE.Vector3(
              Math.cos(shotAngle) * Math.cos(playerPitch),
              Math.sin(playerPitch),
              -Math.sin(shotAngle) * Math.cos(playerPitch)
            ).normalize()
          );
          raycaster.near = 0;
          raycaster.far = maxDistance;
          const wallIntersection = mapWalls
            ? raycaster.intersectObject(mapWalls, false)[0]
            : null;
          const intersection = raycaster.intersectObjects(targets, true)
            .find(hit => hit.object.userData.isHitbox);
          const target = intersection?.object.userData.enemyRef &&
            (!wallIntersection || intersection.distance < wallIntersection.distance - .015)
            ? {
              enemy: intersection.object.userData.enemyRef,
              distance: intersection.distance,
              hitZone: intersection.object.userData.hitZone || "chest",
              point: intersection.point.clone()
            }
            : null;
          const tracerEnd = target
            ? target.point
            : wallIntersection
              ? wallIntersection.point
              : raycaster.ray.at(maxDistance, new THREE.Vector3());
          vfxSystem.spawnBullet(muzzlePosition, tracerEnd, { color: target ? "#f5e8b0" : "#dfb96e" });
          if (target) {
            addImpactParticles(tracerEnd, target.hitZone === "head" ? "#bcab7e" : "#f5d992");
          } else if (wallIntersection && wallIntersection.distance <= maxDistance) {
            const wallHit = castRay(shotAngle);
            const normal = wallHit.side === 0
              ? new THREE.Vector3(wallHit.rayX > 0 ? -1 : 1, 0, 0)
              : new THREE.Vector3(0, 0, wallHit.rayY > 0 ? 1 : -1);
            const wallNormal = wallIntersection.face?.normal?.clone()
              .transformDirection(wallIntersection.object.matrixWorld) || normal;
            vfxSystem.spawnImpact(wallIntersection.point, wallNormal, "#3b382e");
          }
          if (target) {
            const previous = hits.get(target.enemy);
            hits.set(target.enemy, {
              ...target,
              distance: target.distance,
              pellets: (previous?.pellets || 0) + 1,
              hitZone: target.hitZone === "head" ? "head" : previous?.hitZone || target.hitZone
            });
          }
        }
        if (hits.size) {
          playSound("hit");
          showHitMarker();
          for (const { enemy, distance, pellets: hitPellets, hitZone } of hits.values()) {
            const rangeScale = player.weaponIndex === 2 ? .35 + .65 * Math.max(0, 1 - distance / 10) : 1;
            const behindBot = (enemy.facingX || 0) * (player.x - enemy.x) +
              (enemy.facingY || 0) * (player.y - enemy.y) < -distance * .35;
            const backstab = weapon.melee && behindBot;
            const damageScale = weapon.melee
              ? hitZone === "head" || backstab ? enemy.health / weapon.damage : 1
              : hitZone === "head" ? 3 : hitZone === "limb" ? .5 : 1;
            enemy.health -= weapon.damage * damageScale * (hitPellets / pelletCount) * rangeScale;
            enemy.underFire = true;
            enemy.state = "dodge";
            const noScope = weapon.scoped && !aiming;
            if (hitZone === "head" || backstab || noScope) {
              showHitConfirmation(noScope ? "NO-SCOPE" : backstab ? "BACKSTAB" : "HEADSHOT", noScope);
            }
            if (enemy.health > 0) continue;
            eliminateEnemy(enemy, {
              weaponIndex: player.weaponIndex,
              headshot: hitZone === "head",
              noScope
            });
            setCombatMessage("TARGET ELIMINATED", 650);
            if (gameMode === "tdm" ? !enemies.some(enemy => enemy.team === 1) :
              !isWaveMode() && enemies.length === 0) endGame();
          }
        }
      }

      function startDash() {
        const { forward, strafe } = movementInput();
        const length = Math.hypot(forward, strafe);
        if (!running || locallyPaused || aiming || dashTimer > 0 || dashCooldown > 0 || length === 0) return;
        dashDirectionX = (Math.cos(player.angle) * forward + Math.cos(player.angle - Math.PI / 2) * strafe) / length;
        dashDirectionY = (Math.sin(player.angle) * forward + Math.sin(player.angle - Math.PI / 2) * strafe) / length;
        dashTimer = dashDuration;
        dashCooldown = .9;
        setCombatMessage("DASH", 500);
      }

      function update(dt) {
        updateTransientEffects(dt);
        player.spawnInvulnerability = Math.max(0, player.spawnInvulnerability - dt);
        document.querySelector("#spawn-shield-overlay").classList.toggle("active", player.spawnInvulnerability > 0);
        const recoilReturn = 1 - Math.exp(-dt * 12);
        playerPitch = Math.max(-1.35, Math.min(1.35, playerPitch - recoilPitch * recoilReturn));
        player.angle -= recoilYaw * recoilReturn;
        recoilPitch *= 1 - recoilReturn;
        recoilYaw *= 1 - recoilReturn;
        let nearbyThreats = 0;
        for (const enemy of enemies) {
          if (Math.hypot(enemy.x - player.x, enemy.y - player.y) < 12) nearbyThreats++;
        }
        audioManager.setCombatIntensity(Math.min(1, nearbyThreats / 4));
        fireCooldown = Math.max(0, fireCooldown - dt);
        muzzleFlash = Math.max(0, muzzleFlash - dt);
        knifeSwing = Math.max(0, knifeSwing - dt * 4);
        weaponRecoil = Math.max(0, weaponRecoil - dt * 40);
        weaponLagX *= Math.max(0, 1 - dt * (5 / weaponWeight[player.weaponIndex]));
        dashTimer = Math.max(0, dashTimer - dt);
        dashCooldown = Math.max(0, dashCooldown - dt);
        hurtFlash = Math.max(0, hurtFlash - dt * 1.4);
        grenadeFlash = Math.max(0, grenadeFlash - dt * 2.8);
        grenadeCooldown = Math.max(0, grenadeCooldown - dt);
        flashbangCooldown = Math.max(0, flashbangCooldown - dt);
        grenadeAnimation = Math.max(0, grenadeAnimation - dt * 1.4);
        flashbangAnimation = Math.max(0, flashbangAnimation - dt * 1.4);
        for (let index = explosions.length - 1; index >= 0; index--) {
          const explosion = explosions[index];
          explosion.age += dt;
          if (explosion.age >= explosion.duration) explosions.splice(index, 1);
        }
        if (firing && currentWeapon().auto) shoot();
        if (reloadTimer > 0) {
          reloadTimer -= dt;
          if (reloadTimer <= 0) {
            const weapon = currentWeapon();
            if (reloadKind === "reload") {
              const loaded = Math.min(weapon.magazine - weapon.ammo, weapon.reserve);
              weapon.ammo += loaded; weapon.reserve -= loaded;
              updateWeaponHud();
              playSound("reload");
              document.querySelector("#objective").textContent = `${enemies.length} hostiles in the area`;
            }
            reloadKind = "";
          }
        }

        const { forward, strafe } = movementInput();
        const length = Math.hypot(forward, strafe) || 1;
        const moving = forward !== 0 || strafe !== 0 || dashTimer > 0;
        const sprinting = !aiming && dashTimer === 0 && isSprinting() && (forward !== 0 || strafe !== 0);
        if (moving) {
          movementBob += dt * (dashTimer > 0 ? 24 : sprinting ? 15 : aiming ? 7 : 11);
          footstepsTimer -= dt;
          if (footstepsTimer <= 0) {
            playSound("footstep");
            footstepsTimer = dashTimer > 0 ? .2 : sprinting ? .36 : aiming ? .58 : .38;
          }
        } else {
          movementBob *= Math.max(0, 1 - dt * 5);
        }
        if (dashTimer > 0) {
          const dashSpeed = 9 * currentWeapon().movementSpeed * (.35 + .65 * dashTimer / dashDuration);
          movePlayer(dashDirectionX * dashSpeed * dt, dashDirectionY * dashSpeed * dt);
        } else {
          const speed = (aiming ? 2 : sprinting ? 4.2 : 3.2) * currentWeapon().movementSpeed * dt;
          movePlayer((Math.cos(player.angle) * forward + Math.cos(player.angle - Math.PI / 2) * strafe) / length * speed,
            (Math.sin(player.angle) * forward + Math.sin(player.angle - Math.PI / 2) * strafe) / length * speed);
        }
        const correction = networkManager.consumeCorrection(dt);
        if (correction.x || correction.y) movePlayer(correction.x, correction.y);

        for (const enemy of enemies) {
          const weapon = weapons[enemy.weaponIndex] || weapons[0];
          enemy.stunned = Math.max(0, (enemy.stunned || 0) - dt);
          enemy.footstepTimer = Math.max(0, enemy.footstepTimer - dt);
          enemy.uavRevealTimer = Math.max(0, (enemy.uavRevealTimer || 0) - dt);
          if (enemy.stunned > 0) continue;
          const action = botAI.update(enemy, player, dt, map, weapon);
          const distance = action.distance;
          enemy.sprinting = action.sprinting;
          enemy.phase += dt * (distance > 1.15 ? (enemy.sprinting ? 11 : 7) : 2);
          enemy.faceAngle = action.state === "attack" || action.state === "cover"
            ? Math.atan2(player.y - enemy.y, player.x - enemy.x)
            : action.moveX || action.moveY
            ? Math.atan2(action.moveY, action.moveX)
            : Math.atan2(player.y - enemy.y, player.x - enemy.x);
          enemy.facingX = Math.cos(enemy.faceAngle);
          enemy.facingY = Math.sin(enemy.faceAngle);
          if (action.moveX || action.moveY) {
            const speed = (enemy.sprinting ? 2.4 : action.state === "cover" || action.state === "dodge" ? 1.55 : 1.25) *
              (enemy.movementMultiplier || 1);
            const vx = action.moveX * speed * dt;
            const vy = action.moveY * speed * dt;
            if (canOccupyOnMap(map, enemy.x + vx, enemy.y, .2)) enemy.x += vx;
            if (canOccupyOnMap(map, enemy.x, enemy.y + vy, .2)) enemy.y += vy;
            if (enemy.footstepTimer <= 0) {
              playSound("footstep", new THREE.Vector3(enemy.x, .1, -enemy.y), {
                volume: enemy.sprinting ? 1.15 : .72, refDistance: 1.8, rolloffFactor: 1.6
              });
              enemy.footstepTimer = enemy.sprinting ? .28 : .42;
            }
          }
          if (!action.fire) continue;
          enemy.attack = Math.max(1.2, weapon.interval * 7) + Math.random() * .45;
          const closeAttack = distance <= 1.15;
          if (!closeAttack && Math.random() >= .58) continue;
          const damage = closeAttack ? 6 : Math.max(3, weapon.damage * (enemy.weaponIndex === 1 ? .075 : .045));
          if (player.spawnInvulnerability > 0) continue;
          player.applyDamage(Math.round(damage));
          hurtFlash = .8;
          damageMessageTimer = .3;
          const muzzle = new THREE.Vector3(enemy.x, 1.2, -enemy.y);
          const playerChest = new THREE.Vector3(player.x, 1.25, -player.y);
          playSound(closeAttack ? "damage" : enemy.weaponIndex === 1 ? "sniper" : "rifle",
            muzzle, { volume: .45, refDistance: 3 });
          if (!closeAttack) {
            vfxSystem.spawnBullet(muzzle, playerChest, { color: "#ff9b72", speed: 80 });
            addTracer(muzzle, playerChest, "#ff9b72");
          }
          document.querySelector("#damage-overlay").classList.add("visible");
          scheduleTimeout(() => document.querySelector("#damage-overlay").classList.remove("visible"), 300);
          document.querySelector("#health").textContent = player.health;
          const fill = document.querySelector("#health-fill");
          fill.style.width = `${player.health}%`;
          fill.style.background = player.health < 35 ? "#dd6d58" : "#c1e16d";
          if (player.health === 0) {
            playSound("death");
            endGame();
            break;
          }
        }
        if (enemies.length === 0 && running && isWaveMode() && !networkConnection?.open) {
          document.querySelector("#objective").textContent = "Sector clear - next wave inbound";
          spawnWave();
        }
        const replayEnemies = enemies.map(enemy => ({ id: enemy.id, x: enemy.x, y: enemy.y, angle: enemy.faceAngle || 0 }));
        if (remotePlayer && networkConnection?.open) {
          replayEnemies.push({
            id: "opponent",
            x: remotePlayer.x,
            y: remotePlayer.y,
            angle: remotePlayer.angle || 0
          });
        }
        replayBuffer.record(performance.now(), {
          player: { x: player.x, y: player.y, angle: player.angle, pitch: playerPitch },
          enemies: replayEnemies
        });
        damageMessageTimer = Math.max(0, damageMessageTimer - dt);
      }

      function frame(time) {
        const dt = Math.min((time - lastTime) / 1000 || 0, .05);
        lastTime = time;
        vfxSystem.updateDecals(time);
        if (running) update(dt);
        let playbackSample = null;
        if (replayPlayback) {
          playbackSample = replayBuffer.sample(time);
          if (!playbackSample || playbackSample.finished) {
            replayPlayback = false;
            playbackSample = null;
            document.querySelector("#replay-indicator").hidden = true;
            overlay.hidden = false;
          }
        }
        render(playbackSample);
        requestAnimationFrame(frame);
      }

      function startGame(requestedMode = gameMode, fresh = gameOver, { acquirePointerLock = true } = {}) {
        if (fresh || gameOver) {
          teardownMatch(false);
          if (requestedMode === "waves" && (networkConnection || networkPeer)) disconnectPeer();
          gameMode = requestedMode;
          if (activeMapId !== selectedMapId) loadMap(selectedMapId);
          const spawn = getPlayerSpawnPosition();
          player.reset(spawn);
          if (networkConnection?.open) {
            const opponentSpawn = getPlayerSpawnPosition(networkRole === "guest" ? "host" : "guest");
            player.angle = Math.atan2(opponentSpawn.y - spawn.y, opponentSpawn.x - spawn.x);
          }
          playerPitch = 0;
          weaponManager.resetAmmo();
          weaponManager.select(0);
          reloadTimer = 0;
          reloadDuration = 0;
          reloadKind = "";
          grenadeCooldown = 0;
          flashbangCooldown = 0;
          grenadeFlash = 0;
          explosions = [];
          dashTimer = 0;
          dashCooldown = 0;
          weaponRecoil = 0;
          recoilPitch = 0;
          recoilYaw = 0;
          weaponLagX = 0;
          replayBuffer.reset();
          replayPlayback = false;
          killStreak = 0;
          resultSubmitted = false;
          document.querySelector("#leaderboard-panel").hidden = true;
          document.querySelector("#replay-indicator").hidden = true;
          wave = 0; enemies.length = 0; gameOver = false;
          grenades = 2;
          flashbangs = 1;
          document.querySelector("#grenade-count").textContent = grenades;
          document.querySelector("#flash-count").textContent = flashbangs;
          document.querySelector("#health").textContent = "100";
          document.querySelector("#health-fill").style.width = "100%";
          document.querySelector("#health-fill").style.background = "#c1e16d";
          document.querySelector("#wave").textContent = "WAVE 01";
          document.querySelector("#score").textContent = "0000";
          updateWeaponHud();
        }
        ensureAudio();
        firing = false;
        aiming = false;
        locallyPaused = false;
        running = true;
        menuScreens.forEach(menu => { menu.hidden = true; });
        overlay.hidden = true;
        updateAimHud();
        document.querySelector("#overlay-kicker").textContent = gameMode === "waves"
          ? "SINGLE-PLAYER / SURVIVAL"
          : `${networkConnection?.open ? "PEER MATCH" : "BOT MATCH"} / ${gameMode.toUpperCase()}`;
        document.querySelector("#overlay-title").innerHTML = gameMode === "waves" ? "HOLD THE<br>PERIMETER" : "MATCH<br>IN PROGRESS";
        document.querySelector("#overlay-copy").textContent = gameMode === "waves"
          ? "Survive escalating hostile waves. Use WASD or the touch controls to move, aim and fire, and dash clear of danger."
          : networkConnection?.open
            ? "Two-player peer match: positions, health, weapons, and shots sync directly. Training bots are disabled in connected rooms."
            : "Eliminate the training opponent. Create or join a private peer room to play against another operator.";
        startButton.textContent = "Deploy";
        document.querySelector("#pause-button").textContent = "Pause";
        document.querySelector("#pause-button").disabled = false;
        document.querySelector("#pause-settings-button").hidden = true;
        returnMenuButton.hidden = true;
        if (wave === 0) spawnWave();
        if (networkConnection?.open && !networkStateTimer) {
          networkStateTimer = window.setInterval(sendPlayerState, 50);
        }
        if (!acquirePointerLock) {
          pointerLockUnavailable = true;
        } else if (!window.matchMedia("(any-pointer: coarse)").matches) {
          const pointerLockRequest = canvas.requestPointerLock?.();
          if (pointerLockRequest && typeof pointerLockRequest.catch === "function") {
            pointerLockRequest.catch(() => { pointerLockUnavailable = true; });
          }
        }
      }

      function pauseGame() {
        if (!running || locallyPaused || gameOver) return;
        const multiplayerPause = Boolean(networkConnection?.open);
        if (multiplayerPause) locallyPaused = true;
        else running = false;
        if (!multiplayerPause) audioManager.setCombatIntensity(0);
        firing = false;
        aiming = false;
        grenadeAim = false;
        dashTimer = 0;
        resetTouchControls();
        keys.clear();
        overlay.hidden = false;
        updateAimHud();
        document.querySelector("#pause-settings-button").hidden = false;
        document.querySelector("#overlay-kicker").textContent = multiplayerPause ? "LOCAL CONTROLS PAUSED" : "SIMULATION PAUSED";
        document.querySelector("#overlay-title").innerHTML = "REGROUP<br>AND REDEPLOY";
        document.querySelector("#overlay-copy").textContent = multiplayerPause
          ? "Your local controls are paused. The peer match continues while this overlay is open."
          : "The perimeter is waiting. Resume when you are ready.";
        startButton.textContent = "Resume";
        returnMenuButton.hidden = false;
        document.querySelector("#pause-button").textContent = "Resume";
        document.querySelector("#pause-button").disabled = false;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }

      function endGame({ won = false, replay = false } = {}) {
        if (gameOver) return;
        running = false; locallyPaused = false; gameOver = true;
        audioManager.setCombatIntensity(0);
        firing = false;
        aiming = false;
        updateAimHud();
        overlay.hidden = false;
        document.querySelector("#pause-settings-button").hidden = true;
        const leaderboardPanel = document.querySelector("#leaderboard-panel");
        const leaderboardList = document.querySelector("#leaderboard-list");
        const leaderboardStatus = document.querySelector("#leaderboard-status");
        const replayButton = document.querySelector("#replay-button");
        leaderboardPanel.hidden = isWaveMode();
        leaderboardList.replaceChildren();
        leaderboardStatus.textContent = "";
        replayButton.hidden = replayBuffer.frames.length < 2;
        replayButton.disabled = replayButton.hidden;
        const leaderboardReady = isWaveMode() ? Promise.resolve() : submitMatchResult();
        document.querySelector("#overlay-kicker").textContent = `${won ? "VICTORY" : isWaveMode() ? "MISSION ENDED" : "MATCH ENDED"} / SCORE ${player.score}`;
        document.querySelector("#overlay-title").innerHTML = isWaveMode()
          ? "PERIMETER<br>BREACHED"
          : won ? "MATCH<br>WON" : "MATCH<br>COMPLETE";
        document.querySelector("#overlay-copy").textContent = isWaveMode()
          ? `You held for ${wave} wave${wave === 1 ? "" : "s"}. Reset and try again.`
          : networkConnection?.open
            ? won
              ? "The opposing operator was eliminated."
              : "You were eliminated. Watch the final moments again or redeploy."
            : `${operatorName} finished the ${gameMode.toUpperCase()} match.`;
        startButton.textContent = "Try again";
        returnMenuButton.hidden = false;
        document.querySelector("#pause-button").textContent = "Mission over";
        document.querySelector("#pause-button").disabled = true;
        if (replay && replayBuffer.frames.length >= 2) {
          leaderboardReady.then(() => {
            scheduleTimeout(() => {
              if (gameOver && !replayPlayback) playMatchReplay();
            }, 800);
          });
        }
        if (document.pointerLockElement === canvas) document.exitPointerLock();
      }

      document.querySelector("#profile-name-form").addEventListener("submit", event => {
        event.preventDefault();
        const input = document.querySelector("#profile-name");
        const name = input.value.trim().replace(/\s+/g, " ");
        const error = document.querySelector("#profile-error");
        if (!/^[A-Za-z0-9 _-]{2,16}$/.test(name)) {
          error.textContent = "Use 2-16 letters, numbers, spaces, underscores, or hyphens.";
          input.focus();
          return;
        }
        operatorName = name;
        try {
          localStorage.setItem("blacksite.operator", operatorName);
          error.textContent = "";
        } catch (storageError) {
          console.warn("The operator profile could not be saved.", storageError);
          error.textContent = "Profile created, but browser storage is unavailable.";
        }
        document.querySelector("#menu-username").textContent = operatorName;
        showMenu(mainMenu);
      });
      document.querySelector("#solo-button").addEventListener("click", () => startGame("waves", true));
      document.querySelector("#multiplayer-button").addEventListener("click", () => showMenu(multiplayerMenu));
      document.querySelector("#settings-button").addEventListener("click", () => openSettings());
      document.querySelector("#pause-settings-button").addEventListener("click", () => openSettings(true));
      document.querySelector("#settings-back-button").addEventListener("click", closeSettings);
      document.querySelector("#replay-button").addEventListener("click", playMatchReplay);
      document.querySelector("#sensitivity-setting").addEventListener("input", event => {
        controlSettings.mouseSensitivity = Number(event.currentTarget.value);
        syncSettingsControls();
        saveControlSettings();
      });
      document.querySelector("#scope-sensitivity-setting").addEventListener("input", event => {
        controlSettings.scopeSensitivity = Number(event.currentTarget.value);
        syncSettingsControls();
        saveControlSettings();
      });
      document.querySelector("#fov-setting").addEventListener("input", event => {
        controlSettings.fieldOfView = Number(event.currentTarget.value);
        syncSettingsControls();
        saveControlSettings();
      });
      document.querySelector("#volume-setting").addEventListener("input", event => {
        controlSettings.masterVolume = Number(event.currentTarget.value);
        syncSettingsControls();
        saveControlSettings();
      });
      document.querySelector("#profile-button").addEventListener("click", () => openProfile(operatorName, "Your local operator profile"));
      document.querySelectorAll(".mode-card").forEach(button => {
        button.addEventListener("click", () => {
          selectedMode = button.dataset.mode;
          document.querySelectorAll(".mode-card").forEach(card => card.classList.toggle("selected", card === button));
        });
      });
      document.querySelectorAll(".map-card").forEach(button => {
        button.addEventListener("click", () => {
          selectedMapId = button.dataset.map;
          document.querySelectorAll(".map-card").forEach(card => {
            const selected = card === button;
            card.classList.toggle("selected", selected);
            card.setAttribute("aria-pressed", String(selected));
          });
        });
      });
      document.querySelector("#public-servers-button").addEventListener("click", openServerBrowser);
      document.querySelector("#private-servers-button").addEventListener("click", openServerBrowser);
      document.querySelector("#create-room-button").addEventListener("click", createPrivateRoom);
      document.querySelector("#configure-room-button").addEventListener("click", toggleRoomConfiguration);
      document.querySelector("#apply-room-config-button").addEventListener("click", applyRoomConfiguration);
      document.querySelector("#connect-room-button").addEventListener("click", connectToRoom);
      document.querySelector("#room-code-input").addEventListener("keydown", event => {
        if (event.code === "Enter") connectToRoom();
      });
      document.querySelector("#join-room-button").addEventListener("click", joinSelectedRoom);
      document.querySelector("#back-to-modes").addEventListener("click", () => showMenu(multiplayerMenu));
      document.querySelectorAll("[data-back='main-menu']").forEach(button => button.addEventListener("click", () => showMenu(mainMenu)));
      document.querySelector("#close-profile-modal").addEventListener("click", () => showMenu(profileReturnScreen));
      document.querySelector("#profile-card-close").addEventListener("click", () => showMenu(profileReturnScreen));
      returnMenuButton.addEventListener("click", () => {
        teardownMatch(true);
        showMenu(mainMenu);
      });
      document.querySelector("#quit-button").addEventListener("click", event => {
        teardownMatch(true);
        showMenu(mainMenu);
        window.close();
        event.currentTarget.textContent = "Session reset - close this tab to quit";
      });
      startButton.addEventListener("click", () => startGame(gameMode, gameOver));
      document.querySelector("#pause-button").addEventListener("click", () => {
        if (running && locallyPaused) startGame(gameMode, false);
        else if (running) pauseGame();
        else if (!gameOver && overlay.hidden === false) startGame(gameMode, false);
      });
      document.querySelector("#fullscreen-button").addEventListener("click", toggleFullscreen);
      document.addEventListener("fullscreenchange", syncFullscreenButton);
      document.querySelectorAll(".weapon-slot").forEach(button => {
        button.addEventListener("click", () => {
          if (running) selectWeapon(Number(button.dataset.weapon));
        });
      });
      document.querySelector("#loadout-weapon").addEventListener("change", event => {
        loadoutWeaponIndex = Number(event.currentTarget.value);
        updateLoadoutControls();
      });
      document.querySelectorAll("[data-attachment]").forEach(input => {
        input.addEventListener("change", event => {
          const attachment = event.currentTarget.dataset.attachment;
          weaponManager.setAttachment(loadoutWeaponIndex, attachment, event.currentTarget.checked);
          applyWeaponAttachments(loadoutWeaponIndex);
          if (loadoutWeaponIndex === player.weaponIndex && aiming) updateAimHud();
        });
      });
      window.addEventListener("resize", resize);
      window.addEventListener("keydown", event => {
        if (running && !locallyPaused) keys.add(event.code);
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
        if (event.code === "Escape" && event.repeat) return;
        if (event.altKey && event.code === "Enter") {
          event.preventDefault();
          toggleFullscreen();
          return;
        }
        if (event.code === "Escape") {
          event.preventDefault();
          if (locallyPaused) {
            startGame(gameMode, false);
            return;
          }
          const now = performance.now();
          if (lastEscapePress > 0 && now - lastEscapePress <= 2000) {
            lastEscapePress = 0;
            const shouldBeRunning = escapeRunningBeforeFirst;
            escapeRunningBeforeFirst = false;
            suppressPointerLockPauseUntil = now + 500;
            if (document.fullscreenElement) toggleFullscreen();
            if (shouldBeRunning && !running && !gameOver) startGame(gameMode, false);
            else if (!shouldBeRunning && running) pauseGame();
            return;
          }
          const pointerLockWasJustLost = now - pointerLockPauseAt <= 120;
          escapeRunningBeforeFirst = running || pointerLockWasJustLost;
          lastEscapePress = now;
          if (running) pauseGame();
          else if (pointerLockWasJustLost) return;
          else if (!gameOver && !overlay.hidden) startGame(gameMode, false);
          return;
        }
        if (!running || locallyPaused || event.repeat) return;
        if (event.code === "KeyR") reload();
        if (event.code === "KeyG") {
          grenadeAim = true;
          return;
        }
        if (event.code === "KeyF") addGrenade(true);
        if (event.code === "KeyC") startDash();
        if (event.code.startsWith("Digit")) {
          const index = Number(event.code.slice(5)) - 1;
          selectWeapon(index);
        }
      });
      window.addEventListener("keyup", event => {
        keys.delete(event.code);
        if (event.code === "KeyG" && grenadeAim) {
          grenadeAim = false;
          addGrenade(false);
        }
      });
      const touchStick = document.querySelector("#touch-stick");
      const touchStickKnob = document.querySelector("#touch-stick-knob");
      touchStick.addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        touchStickPointerId = event.pointerId;
        touchStick.setPointerCapture(event.pointerId);
        updateTouchStick(event);
      });
      touchStick.addEventListener("pointermove", event => {
        if (event.pointerId === touchStickPointerId) updateTouchStick(event);
      });
      function updateTouchStick(event) {
        const bounds = touchStick.getBoundingClientRect();
        const radius = bounds.width * .34;
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const distance = Math.hypot(dx, dy);
        const scale = distance > radius ? radius / distance : 1;
        const x = dx * scale, y = dy * scale;
        touchMovementX = x / radius;
        touchMovementY = y / radius;
        touchStickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      }
      function releaseTouchStick(event) {
        if (event.pointerId !== touchStickPointerId) return;
        touchStickPointerId = null;
        touchMovementX = 0;
        touchMovementY = 0;
        touchStickKnob.style.transform = "translate(-50%, -50%)";
      }
      touchStick.addEventListener("pointerup", releaseTouchStick);
      touchStick.addEventListener("pointercancel", releaseTouchStick);

      function bindTouchHold(button, onStart, onEnd) {
        button.addEventListener("pointerdown", event => {
            if (!running || locallyPaused) return;
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          button.classList.add("active");
          onStart();
        });
        const release = () => {
          button.classList.remove("active");
          onEnd();
        };
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("lostpointercapture", release);
      }
      bindTouchHold(document.querySelector("#touch-fire"), () => {
        firing = true;
        shoot();
      }, () => { firing = false; });
      bindTouchHold(document.querySelector("#touch-aim"), () => {
        aiming = true;
        updateAimHud();
      }, () => {
        aiming = false;
        updateAimHud();
      });
      bindTouchHold(document.querySelector("#touch-sprint"), () => keys.add("ShiftLeft"), () => keys.delete("ShiftLeft"));
      document.querySelector("#touch-dash").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        startDash();
      });
      document.querySelector("#touch-reload").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        reload();
      });
      document.querySelector("#touch-swap").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        selectWeapon((player.weaponIndex + 1) % weapons.length);
      });
      document.querySelector("#touch-frag").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        addGrenade(false);
      });
      document.querySelector("#touch-flash").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        addGrenade(true);
      });
      canvas.addEventListener("pointerdown", event => {
        if (!running || locallyPaused || event.pointerType === "mouse") return;
        event.preventDefault();
        lookPointerId = event.pointerId;
        lastLookX = event.clientX;
        lastLookY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", event => {
        if (event.pointerId !== lookPointerId) return;
        const deltaX = event.clientX - lastLookX;
        const deltaY = event.clientY - lastLookY;
        lastLookX = event.clientX;
        lastLookY = event.clientY;
        const sensitivity = .006 * controlSettings.mouseSensitivity * lookSensitivityMultiplier();
        player.angle -= deltaX * sensitivity;
        playerPitch = Math.max(-1.35, Math.min(1.35, playerPitch - deltaY * sensitivity));
        weaponLagX = Math.max(-18, Math.min(18, weaponLagX + deltaX * .12));
      });
      const releaseLook = event => {
        if (event.pointerId === lookPointerId) lookPointerId = null;
      };
      canvas.addEventListener("pointerup", releaseLook);
      canvas.addEventListener("pointercancel", releaseLook);
      canvas.addEventListener("mousedown", event => {
        if (!running || locallyPaused) return;
        if (event.button === 2) {
          event.preventDefault();
          aiming = true;
          updateAimHud();
          return;
        }
        if (event.button === 0) {
          firing = true;
          shoot();
        }
      });
      window.addEventListener("mouseup", event => {
        if (event.button === 0) firing = false;
        if (event.button === 2) {
          aiming = false;
          updateAimHud();
        }
      });
      canvas.addEventListener("contextmenu", event => event.preventDefault());
      window.addEventListener("wheel", event => {
        if (!running || locallyPaused || event.deltaY === 0) return;
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        selectWeapon((player.weaponIndex + direction + weapons.length) % weapons.length);
      }, { passive: false });
      window.addEventListener("blur", () => {
        firing = false;
        aiming = false;
        grenadeAim = false;
        updateAimHud();
        keys.clear();
        resetTouchControls();
      });
      window.addEventListener("mousemove", event => {
        if (running && !locallyPaused && (document.pointerLockElement === canvas || pointerLockUnavailable)) {
          const sensitivity = .0025 * controlSettings.mouseSensitivity * lookSensitivityMultiplier();
          player.angle -= event.movementX * sensitivity;
          playerPitch = Math.max(-1.35, Math.min(1.35, playerPitch - event.movementY * sensitivity));
          weaponLagX = Math.max(-18, Math.min(18, weaponLagX + event.movementX * .12));
        }
      });
      document.addEventListener("pointerlockchange", () => {
        if (document.pointerLockElement !== canvas && running) {
          if (performance.now() <= suppressPointerLockPauseUntil) {
            suppressPointerLockPauseUntil = 0;
            return;
          }
          pointerLockPauseAt = performance.now();
          pauseGame();
        }
      });
      document.addEventListener("pointerlockerror", () => { pointerLockUnavailable = true; });

      document.querySelector("#overlay").hidden = true;
      document.querySelector("#pause-button").disabled = true;
      document.querySelector("#grenade-count").textContent = grenades;
      document.querySelector("#flash-count").textContent = flashbangs;
      syncSettingsControls();
      updateLoadoutControls();
      resize();
      if ("ResizeObserver" in window) {
        new ResizeObserver(resize).observe(document.querySelector(".stage"));
      }
      requestAnimationFrame(frame);
    })();
