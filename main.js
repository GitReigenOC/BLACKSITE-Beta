import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { AudioManager } from "./AudioManager.js";
import { NetworkManager } from "./NetworkManager.js";
import { Player } from "./Player.js";
import { WeaponManager, collectPenetratingHits } from "./WeaponManager.js";
import { BotAI } from "./BotAI.js";
import { VFXSystem } from "./VFX.js";
import { ReplayBuffer } from "./ReplayBuffer.js";
import { WeaponAssetLoader } from "./WeaponAssetLoader.js";

(() => {
      "use strict";

      const canvas = document.querySelector("#game");
      const staminaFill = document.querySelector("#stamina-fill");
      const staminaValue = document.querySelector("#stamina-value");
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
      const referenceViewModelFov = 82;
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
      let replayPerspective = "local";
      let matchReplayPerspective = "local";
      let respawnCountdown = 0;
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
      let enemyRigTemplate = null;
      let enemyRigAnimations = [];
      let playerRigModel = null;
      let playerRigActor = null;
      let firstPersonHandPose = null;
      let warnedMissingHandSocket = false;
      let remoteModel = null;
      let replayPlayerModel = null;
      let replayPlayerActor = null;
      let weaponAnchor = null;
      let muzzleLight = null;
      let parryShield = null;
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
      const shopScreen = document.querySelector("#shop-screen");
      const loadoutScreen = document.querySelector("#loadout-screen");
      const menuScreens = [profileScreen, mainMenu, multiplayerMenu, serversMenu, profileModal, settingsScreen, shopScreen, loadoutScreen];
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

      let pendingPlayerFlash = null;
      function applyFlashToPlayer(blastX, blastY) {
        if (!running || gameOver) return;
        pendingPlayerFlash = { x: blastX, y: blastY, delay: .45 };
      }

      function updateFlashEffect(dt) {
        if (pendingPlayerFlash) {
          pendingPlayerFlash.delay -= dt;
          if (pendingPlayerFlash.delay <= 0) {
            const { x, y } = pendingPlayerFlash;
            pendingPlayerFlash = null;
            const towardBlastX = x - player.x, towardBlastY = y - player.y;
            const distance = Math.hypot(towardBlastX, towardBlastY);
            const facing = (Math.cos(player.angle) * towardBlastX +
              Math.sin(player.angle) * towardBlastY) / Math.max(distance, .001);
            const distanceToWall = castRayFrom(player.x, player.y, Math.atan2(towardBlastY, towardBlastX)).distance;
            if (distance <= 8 && facing > .15 && distanceToWall >= distance - .25) {
              const exposure = THREE.MathUtils.clamp((facing - .15) / .85, 0, 1);
              const distanceScale = THREE.MathUtils.clamp(1 - distance / 10, .2, 1);
              playerFlashTimer = Math.max(playerFlashTimer, 5 * exposure * distanceScale);
              playerFlashOpacity = exposure * distanceScale;
              playerFlashFadeIn = 0;
              playerFlashFadeTimer = .5;
            }
          }
        }
        if (playerFlashTimer > 0) playerFlashFadeIn += dt;
        playerFlashTimer = Math.max(0, playerFlashTimer - dt);
        if (playerFlashTimer === 0 && playerFlashFadeTimer > 0) {
          playerFlashFadeTimer = Math.max(0, playerFlashFadeTimer - dt);
        }
        const flashOverlay = document.querySelector("#damage-overlay");
        const flashVisible = playerFlashTimer > 0 || playerFlashFadeTimer > 0;
        flashOverlay.classList.toggle("flashbang", flashVisible);
        if (flashVisible) {
          const opacity = playerFlashTimer > 0
            ? playerFlashOpacity * THREE.MathUtils.clamp(playerFlashFadeIn / .18, 0, 1)
            : playerFlashOpacity * playerFlashFadeTimer / .5;
          flashOverlay.style.setProperty("--flashbang-opacity", String(opacity));
        } else {
          flashOverlay.style.removeProperty("--flashbang-opacity");
        }
      }
      function createOpenFieldGrid() {
        const grid = createMapGrid(32);
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
          spawnPoints: [
            new THREE.Vector3(7.5, 0, -7.5), new THREE.Vector3(2.5, 0, -2.5),
            new THREE.Vector3(13.5, 0, -2.5), new THREE.Vector3(2.5, 0, -13.5),
            new THREE.Vector3(13.5, 0, -13.5), new THREE.Vector3(7.5, 0, -2.5),
            new THREE.Vector3(7.5, 0, -13.5)
          ],
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
          name: "Battlefield", grid: createOpenFieldGrid(), spawn: { x: 16.5, y: 16.5 },
          spawnPoints: [
            new THREE.Vector3(16.5, 0, -16.5), new THREE.Vector3(4.5, 0, -4.5),
            new THREE.Vector3(27.5, 0, -4.5), new THREE.Vector3(4.5, 0, -27.5),
            new THREE.Vector3(27.5, 0, -27.5), new THREE.Vector3(7.5, 0, -16.5),
            new THREE.Vector3(24.5, 0, -16.5)
          ],
          enemySpawns: [
            new THREE.Vector3(4.5, 0, -4.5), new THREE.Vector3(27.5, 0, -4.5),
            new THREE.Vector3(4.5, 0, -27.5), new THREE.Vector3(27.5, 0, -27.5),
            new THREE.Vector3(7.5, 0, -16.5), new THREE.Vector3(24.5, 0, -16.5)
          ],
          dimensions: { width: 32, depth: 32 }, collisionBoxes: [], hazards: [], elevationZones: [],
          outdoor: true, floor: "#51483a", floorLine: "#675943", wall: "#716552", wallLine: "#443f36",
          ceiling: "#252a29", fog: "#756d60", background: "#526b78", ambient: "#91a7a5", ambientPower: .8,
          sun: "#ffd29a", sunPower: 2.7, floorRoughness: .96, wallRoughness: .93, lightColor: "#ffb979",
          fogNear: 34, fogFar: 72
        },
        pool: {
          name: "The Pool Rooms", grid: createPoolRooms(), spawn: { x: 15.5, y: 15.5 },
          spawnPoints: [
            new THREE.Vector3(15.5, 0, -15.5), new THREE.Vector3(2.5, 0, -2.5),
            new THREE.Vector3(29.5, 0, -2.5), new THREE.Vector3(2.5, 0, -29.5),
            new THREE.Vector3(29.5, 0, -29.5), new THREE.Vector3(5.5, 0, -15.5),
            new THREE.Vector3(26.5, 0, -15.5)
          ],
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
      function createFoundryGrid() {
        const grid = createMapGrid(30);
        for (let x = 3; x < 27; x++) {
          if (x < 10 || x > 13) grid[8][x] = "1";
          if (x < 16 || x > 19) grid[20][x] = "1";
        }
        for (let y = 3; y < 27; y++) {
          if (y < 10 || y > 13) grid[y][9] = "1";
          if (y < 15 || y > 18) grid[y][20] = "1";
        }
        [[5, 5], [6, 5], [23, 5], [24, 5], [5, 23], [6, 23], [23, 23], [24, 23]]
          .forEach(([x, y]) => { grid[y][x] = "1"; });
        return grid.map(row => row.join(""));
      }
      function createRooftopGrid() {
        const grid = createMapGrid(24);
        for (let x = 0; x < 24; x++) {
          grid[0][x] = "0";
          grid[23][x] = "0";
        }
        for (let y = 0; y < 24; y++) {
          grid[y][0] = "0";
          grid[y][23] = "0";
        }
        for (let x = 4; x < 20; x++) {
          if (x < 9 || x > 12) grid[7][x] = "1";
          if (x < 12 || x > 15) grid[16][x] = "1";
        }
        for (let y = 4; y < 20; y++) {
          if (y < 9 || y > 12) grid[y][7] = "1";
          if (y < 12 || y > 15) grid[y][16] = "1";
        }
        [[10, 10], [11, 10], [12, 10], [10, 11], [11, 11], [12, 11]]
          .forEach(([x, y]) => { grid[y][x] = "1"; });
        return grid.map(row => row.join(""));
      }
      function createOutpostGrid() {
        const grid = createMapGrid(28);
        for (let x = 3; x < 25; x++) {
          if (x < 12 || x > 15) grid[7][x] = "1";
          if (x < 9 || x > 12) grid[20][x] = "1";
        }
        for (let y = 3; y < 25; y++) {
          if (y < 10 || y > 13) grid[y][8] = "1";
          if (y < 6 || y > 9) grid[y][19] = "1";
        }
        [[4, 4], [5, 4], [22, 4], [23, 4], [4, 23], [5, 23], [22, 23], [23, 23]]
          .forEach(([x, y]) => { grid[y][x] = "1"; });
        return grid.map(row => row.join(""));
      }
      function createSubwayGrid() {
        const grid = createMapGrid(30);
        for (let x = 2; x < 28; x++) {
          if (x < 10 || x > 19) grid[7][x] = "1";
          if (x < 10 || x > 19) grid[22][x] = "1";
        }
        for (let y = 2; y < 28; y++) {
          if (y < 10 || y > 19) grid[y][9] = "1";
          if (y < 10 || y > 19) grid[y][20] = "1";
        }
        [[4, 4], [5, 4], [24, 4], [25, 4], [4, 25], [5, 25], [24, 25], [25, 25]]
          .forEach(([x, y]) => { grid[y][x] = "1"; });
        return grid.map(row => row.join(""));
      }
      const createAuthoredMap = (name, grid, spawn, palette, extras = {}) => {
        const point = (x, y) => new THREE.Vector3(x, 0, -y);
        const offsets = [[4, 4], [-4, 4], [4, -4], [-4, -4], [0, 6], [0, -6]];
        const isSafeSpawn = (x, y) => {
          if (x < .24 || y < .24 || x > grid[0].length - .24 || y > grid.length - .24) return false;
          for (const [offsetX, offsetY] of [[-.24, -.24], [.24, -.24], [-.24, .24], [.24, .24]]) {
            if (grid[Math.floor(y + offsetY)]?.[Math.floor(x + offsetX)] !== "0") return false;
          }
          if ((extras.collisionBoxes || []).some(box =>
            x + .24 > box.minX && x - .24 < box.maxX &&
            y + .24 > box.minY && y - .24 < box.maxY
          )) return false;
          return !(extras.hazards || []).some(area =>
            x + .24 >= area.minX && x - .24 <= area.maxX &&
            y + .24 >= area.minY && y - .24 <= area.maxY
          );
        };
        const spawnPoints = [
          point(spawn.x, spawn.y),
          ...offsets.map(([x, y]) => point(spawn.x + x, spawn.y + y))
        ].filter(position => isSafeSpawn(position.x, -position.z));
        const enemySpawns = offsets
          .map(([x, y]) => point(spawn.x + x, spawn.y + y))
          .filter(position => isSafeSpawn(position.x, -position.z));
        return {
          name, grid, spawn, spawnPoints, enemySpawns, outdoor: true,
          dimensions: { width: grid[0].length, depth: grid.length },
          collisionBoxes: [], hazards: [], elevationZones: [],
          floor: palette.floor, floorLine: palette.floorLine, wall: palette.wall, wallLine: palette.wallLine,
          ceiling: "#29302b", fog: palette.fog, background: palette.background,
          ambient: palette.ambient, ambientPower: .92, sun: palette.sun, sunPower: 2.4,
          floorRoughness: .88, wallRoughness: .82, lightColor: palette.sun, ...extras
        };
      };
      mapDefinitions.iron_foundry = createAuthoredMap("Iron Foundry", createFoundryGrid(), { x: 14.5, y: 12.5 }, {
        floor: "#55493b", floorLine: "#756146", wall: "#77614b", wallLine: "#4b3b2e",
        fog: "#66534a", background: "#362a20", ambient: "#c5a17c", sun: "#ffb36b"
      }, {
        outdoor: false,
        collisionBoxes: [
          { minX: 11, maxX: 13, minY: 11, maxY: 13, minHeight: 0, maxHeight: 1.4, kind: "vat" },
          { minX: 16, maxX: 18, minY: 16, maxY: 18, minHeight: 0, maxHeight: 1.4, kind: "vat" },
          { minX: 5, maxX: 7, minY: 5, maxY: 7, minHeight: 0, maxHeight: 2.8, kind: "pillar" },
          { minX: 23, maxX: 25, minY: 5, maxY: 7, minHeight: 0, maxHeight: 2.8, kind: "pillar" },
          { minX: 5, maxX: 7, minY: 21, maxY: 23, minHeight: 0, maxHeight: 2.8, kind: "pillar" },
          { minX: 23, maxX: 25, minY: 23, maxY: 25, minHeight: 0, maxHeight: 2.8, kind: "pillar" },
          { minX: 4, maxX: 6, minY: 11.5, maxY: 14.5, minHeight: 0, maxHeight: 3.4, kind: "furnace" },
          { minX: 24, maxX: 26, minY: 11.5, maxY: 14.5, minHeight: 0, maxHeight: 3.4, kind: "furnace" }
        ],
        hazards: [
          { minX: 10.25, maxX: 13.75, minY: 10.25, maxY: 13.75, damagePerSecond: 22 },
          { minX: 15.25, maxX: 18.75, minY: 15.25, maxY: 18.75, damagePerSecond: 22 }
        ],
        elevationZones: [
          { minX: 3, maxX: 9, minY: 13.5, maxY: 15.5, height: 2 },
          { minX: 20, maxX: 27, minY: 13.5, maxY: 15.5, height: 2 },
          { minX: 11, maxX: 15, minY: 3, maxY: 6, height: 2 }
        ],
        fogNear: 5, fogFar: 24, ambientPower: .35, sunPower: 1.6
      });
      mapDefinitions.rooftop = createAuthoredMap("Rooftop", createRooftopGrid(), { x: 14.5, y: 13.5 }, {
        floor: "#46545a", floorLine: "#60747b", wall: "#66777a", wallLine: "#354348",
        fog: "#647d8e", background: "#324b5a", ambient: "#b1c8cc", sun: "#f7d9a1"
      }, {
        collisionBoxes: [
          { minX: 10, maxX: 13, minY: 10, maxY: 12, minHeight: 0, maxHeight: 1.7, kind: "hvac" }
        ],
        hazards: [],
        elevationZones: [],
        fogNear: 10, fogFar: 30, ambientPower: .65, sunPower: 3.4
      });
      mapDefinitions.desert_outpost = createAuthoredMap("Desert Outpost", createOutpostGrid(), { x: 14.5, y: 13.5 }, {
        floor: "#81704d", floorLine: "#b09362", wall: "#725b3c", wallLine: "#493c2d",
        fog: "#b78b58", background: "#86694d", ambient: "#e1c18b", sun: "#ffe0a2"
      }, {
        collisionBoxes: [
          { minX: 11, maxX: 15, minY: 4, maxY: 6, minHeight: 0, maxHeight: 1.25, kind: "sandbags" },
          { minX: 13, maxX: 17, minY: 21, maxY: 23, minHeight: 0, maxHeight: 1.25, kind: "sandbags" },
          { minX: 22, maxX: 25, minY: 11, maxY: 13, minHeight: 0, maxHeight: 2.4, kind: "watchtower" }
        ],
        hazards: [],
        elevationZones: [],
        fogNear: 26, fogFar: 58, ambientPower: .68, sunPower: 3.6
      });
      mapDefinitions.subway_terminal = createAuthoredMap("Subway Terminal", createSubwayGrid(), { x: 13.5, y: 13.5 }, {
        floor: "#3d4948", floorLine: "#697271", wall: "#56615f", wallLine: "#303938",
        fog: "#454e4e", background: "#242d2d", ambient: "#91a5a1", sun: "#c5d0c9"
      }, {
        outdoor: false,
        collisionBoxes: [
          { minX: 10, maxX: 11.5, minY: 10, maxY: 19, minHeight: 0, maxHeight: 2.2, kind: "platform-pillar" },
          { minX: 18.5, maxX: 20, minY: 10, maxY: 19, minHeight: 0, maxHeight: 2.2, kind: "platform-pillar" },
          { minX: 3, maxX: 7, minY: 12.5, maxY: 14.5, minHeight: 0, maxHeight: .8, kind: "bench" },
          { minX: 22, maxX: 26, minY: 15.5, maxY: 17.5, minHeight: 0, maxHeight: .8, kind: "bench" },
          { minX: 11.8, maxX: 16.2, minY: 22.3, maxY: 28.7, minHeight: 0, maxHeight: 2.2, kind: "train" }
        ],
        hazards: [],
        elevationZones: [],
        fogNear: 8, fogFar: 30, ambientPower: .42, sunPower: .8,
        ceiling: "#202827", floorRoughness: .48, wallRoughness: .62
      });
      mapDefinitions.foundry = mapDefinitions.iron_foundry;
      let activeMapId = "arena";
      let selectedMapId = "arena";
      let map = mapDefinitions[activeMapId].grid;
      let mapGroup = null;
      let mapWalls = null;
      let mapObstacleMeshes = [];
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
        mapObstacleMeshes = [];
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

        if (mapId === "rooftop") {
          const ledgeMaterial = cachedMaterial("rooftop-ledge", "#89969a", {
            roughness: .62, metalness: .18
          });
          const ledgeSegments = [[4, 7], [9, 13], [15, 19], [21, 24]];
          for (const [start, end] of ledgeSegments) {
            for (const [x, z, length, depth] of [
              [(start + end) / 2, -.12, end - start, .24],
              [(start + end) / 2, -map.length + .12, end - start, .24]
            ]) {
              const rail = new THREE.Mesh(cachedBoxGeometry(length, .32, depth), ledgeMaterial);
              rail.position.set(x, .12, z);
              rail.castShadow = true;
              mapGroup.add(rail);
            }
            for (const [x, z, depth, length] of [
              [.12, -(start + end) / 2, .24, end - start],
              [width - .12, -(start + end) / 2, .24, end - start]
            ]) {
              const rail = new THREE.Mesh(cachedBoxGeometry(depth, .32, length), ledgeMaterial);
              rail.position.set(x, .12, z);
              rail.castShadow = true;
              mapGroup.add(rail);
            }
          }
          const hvac = new THREE.Mesh(
            cachedBoxGeometry(3, 1.6, 2),
            cachedMaterial("rooftop-hvac", "#515c60", { roughness: .7, metalness: .38 })
          );
          hvac.position.set(11.5, .8, -11);
          hvac.castShadow = true;
          hvac.receiveShadow = true;
          mapGroup.add(hvac);
          mapObstacleMeshes.push(hvac);
          const helipad = new THREE.Mesh(
            cachedPlaneGeometry(6, 6),
            cachedMaterial("rooftop-helipad", "#283437", { roughness: .8 })
          );
          helipad.rotation.x = -Math.PI / 2;
          helipad.position.set(width * .72, .003, -depth * .72);
          mapGroup.add(helipad);
          const helipadMark = new THREE.Mesh(
            new THREE.RingGeometry(1.7, 1.82, 48),
            new THREE.MeshBasicMaterial({ color: "#d9c894", side: THREE.DoubleSide })
          );
          helipadMark.rotation.x = -Math.PI / 2;
          helipadMark.position.copy(helipad.position).y += .01;
          mapGroup.add(helipadMark);
          const waterTankMaterial = cachedMaterial("rooftop-water-tank", "#536469", {
            roughness: .55, metalness: .42
          });
          for (const [x, y] of [[4, 17], [20, 5], [19, 20]]) {
            const tank = new THREE.Mesh(cachedCylinderGeometry(.72, .82, 1.9, 12), waterTankMaterial);
            tank.position.set(x, .95, -y);
            tank.castShadow = true;
            tank.receiveShadow = true;
            mapGroup.add(tank);
            mapObstacleMeshes.push(tank);
            const vent = new THREE.Mesh(cachedCylinderGeometry(.12, .12, .6, 8), waterTankMaterial);
            vent.position.set(x, 2.2, -y);
            mapGroup.add(vent);
          }
        }

        if (mapId === "iron_foundry") {
          const vatMaterial = cachedMaterial("foundry-molten", "#b94c1e", {
            roughness: .28, metalness: .35, emissive: "#ff4a08", emissiveIntensity: 2.2
          });
          const vatLocations = [[12, 12], [17, 17]];
          for (const [x, y] of vatLocations) {
            const vat = new THREE.Mesh(
              cachedBoxGeometry(2.4, .72, 2.4),
              cachedMaterial("foundry-vat-rim", "#534b43", { roughness: .5, metalness: .62 })
            );
            vat.position.set(x, .36, -y);
            vat.castShadow = true;
            vat.receiveShadow = true;
            const molten = new THREE.Mesh(
              cachedBoxGeometry(1.9, .06, 1.9),
              vatMaterial
            );
            molten.position.set(x, .76, -y);
            mapGroup.add(vat, molten);
            mapObstacleMeshes.push(vat, molten);
            const light = new THREE.PointLight("#ff5a16", 4.5, 9, 2);
            light.position.set(x, 1.1, -y);
            mapGroup.add(light);
            dynamicMapLights.push(light);
            light.userData.baseIntensity = 4.5;
          }
          const furnaceMaterial = cachedMaterial("foundry-furnace-steel", "#343b39", {
            roughness: .48, metalness: .72
          });
          const furnaceGlow = cachedMaterial("foundry-furnace-glow", "#ed632d", {
            roughness: .34, emissive: "#ff3b0b", emissiveIntensity: 1.4
          });
          for (const x of [5, 25]) {
            const furnace = new THREE.Group();
            const body = new THREE.Mesh(cachedBoxGeometry(1.7, 2.6, 2.2), furnaceMaterial);
            body.position.y = 1.3;
            body.castShadow = true;
            body.receiveShadow = true;
            const mouth = new THREE.Mesh(cachedBoxGeometry(.92, 1.1, .08), furnaceGlow);
            mouth.position.set(0, 1.25, 1.14);
            const stack = new THREE.Mesh(cachedBoxGeometry(.72, 1.25, .72), furnaceMaterial);
            stack.position.set(0, 3.2, -.24);
            stack.castShadow = true;
            furnace.add(body, mouth, stack);
            furnace.position.set(x, 0, -13);
            mapGroup.add(furnace);
            mapObstacleMeshes.push(body, mouth, stack);
            const furnaceLight = new THREE.PointLight("#ff5a20", 2.6, 7, 2);
            furnaceLight.position.set(x, 1.5, -11.8);
            mapGroup.add(furnaceLight);
            dynamicMapLights.push(furnaceLight);
            furnaceLight.userData.baseIntensity = 2.6;
          }
          const catwalkMaterial = cachedMaterial("foundry-catwalk", "#62594c", {
            roughness: .68, metalness: .48
          });
          for (const [x, y, length, depth] of [
            [6, 15, 6, 1.4], [23, 15, 6, 1.4], [14.5, 4.5, 1.4, 5]
          ]) {
            const catwalk = new THREE.Mesh(cachedBoxGeometry(length, .18, depth), catwalkMaterial);
            catwalk.position.set(x, 2, -y);
            catwalk.castShadow = true;
            catwalk.receiveShadow = true;
            mapGroup.add(catwalk);
            mapObstacleMeshes.push(catwalk);
            for (const supportX of [x - length * .35, x + length * .35]) {
              if (length <= depth) continue;
              const support = new THREE.Mesh(cachedBoxGeometry(.22, 1.9, .22), catwalkMaterial);
              support.position.set(supportX, .95, -y);
              mapGroup.add(support);
            }
          }
        }

        if (mapId === "desert_outpost") {
            const sandbagMaterial = cachedMaterial("outpost-sandbags", "#9b8052", { roughness: .98 });
            for (const [x, y, width, depth] of [[13, 5, 4, 2], [15, 22, 4, 2]]) {
              const barricade = new THREE.Mesh(cachedBoxGeometry(width, 1.1, depth), sandbagMaterial);
              barricade.position.set(x, .55, -y);
              barricade.castShadow = true;
              barricade.receiveShadow = true;
              mapGroup.add(barricade);
              mapObstacleMeshes.push(barricade);
            }
            const watchtowerMaterial = cachedMaterial("outpost-watchtower", "#4d483b", {
              roughness: .78, metalness: .28
            });
            const tower = new THREE.Group();
            const platform = new THREE.Mesh(cachedBoxGeometry(3.2, .28, 3.2), watchtowerMaterial);
            platform.position.y = 2.15;
            const cabin = new THREE.Mesh(cachedBoxGeometry(2.4, 1.2, 2.4), watchtowerMaterial);
            cabin.position.y = 3;
            tower.add(platform, cabin);
            for (const x of [-1.25, 1.25]) for (const z of [-1.25, 1.25]) {
              const post = new THREE.Mesh(cachedBoxGeometry(.18, 2.2, .18), watchtowerMaterial);
              post.position.set(x, 1.1, z);
              tower.add(post);
            }
            tower.position.set(23.5, 0, -12);
            tower.traverse(object => { if (object.isMesh) object.castShadow = true; });
            mapGroup.add(tower);
            mapObstacleMeshes.push(tower.children[0], tower.children[1]);
            const crateMaterial = cachedMaterial("outpost-crates", "#64513a", { roughness: .9 });
            for (const [x, y, rotation] of [[4, 14, .2], [23, 16, -.35], [5, 18, .5]]) {
              const crate = new THREE.Mesh(cachedBoxGeometry(1.2, .9, 1.1), crateMaterial);
              crate.position.set(x, .45, -y);
              crate.rotation.y = rotation;
              crate.castShadow = true;
              mapGroup.add(crate);
              mapObstacleMeshes.push(crate);
            }
            [[6, 5], [22, 22]].forEach(([x, y], index) => {
              const light = new THREE.PointLight(index ? "#ff9d58" : "#ffd58a", 1.5, 8, 2);
              light.position.set(x, 2.8, -y);
              mapGroup.add(light);
              dynamicMapLights.push(light);
              light.userData.baseIntensity = 1.5;
            });
        }

        if (mapId === "subway_terminal") {
            const pillarMaterial = cachedMaterial("subway-pillar", "#525c5a", {
              roughness: .7, metalness: .34
            });
            for (const x of [10.75, 19.25]) {
              const pillar = new THREE.Mesh(cachedBoxGeometry(1.5, 2.2, 9), pillarMaterial);
              pillar.position.set(x, 1.1, -14.5);
              pillar.castShadow = true;
              pillar.receiveShadow = true;
              mapGroup.add(pillar);
              mapObstacleMeshes.push(pillar);
            }
            const benchMaterial = cachedMaterial("subway-bench", "#35423f", {
              roughness: .46, metalness: .5
            });
            for (const [x, y] of [[5, 13.5], [24, 16.5]]) {
              const bench = new THREE.Mesh(cachedBoxGeometry(4, .55, .9), benchMaterial);
              bench.position.set(x, .48, -y);
              bench.castShadow = true;
              mapGroup.add(bench);
              mapObstacleMeshes.push(bench);
            }
            const trackMaterial = cachedMaterial("subway-track", "#252a28", {
              roughness: .36, metalness: .72
            });
            for (const x of [12, 14, 16]) {
              const rail = new THREE.Mesh(cachedBoxGeometry(.14, .12, depth - 3), trackMaterial);
              rail.position.set(x, .02, -depth / 2);
              mapGroup.add(rail);
            }
            const sleeperMaterial = cachedMaterial("subway-sleeper", "#49453d", {
              roughness: .88, metalness: .14
            });
            for (let y = 2.5; y < depth - 2; y += 1.35) {
              const sleeper = new THREE.Mesh(cachedBoxGeometry(5.2, .08, .22), sleeperMaterial);
              sleeper.position.set(14, .015, -y);
              mapGroup.add(sleeper);
            }
            const trainBody = new THREE.Mesh(
              cachedBoxGeometry(4.4, 2.1, 6.4),
              cachedMaterial("subway-train-body", "#364344", { roughness: .42, metalness: .58 })
            );
            trainBody.position.set(14, 1.12, -25.5);
            trainBody.castShadow = true;
            mapGroup.add(trainBody);
            mapObstacleMeshes.push(trainBody);
            const trainWindowMaterial = cachedMaterial("subway-train-window", "#72bcc0", {
              roughness: .24, metalness: .38, emissive: "#20565b", emissiveIntensity: .55
            });
            for (const x of [12.35, 13.45, 14.55, 15.65]) {
              const window = new THREE.Mesh(cachedBoxGeometry(.72, .82, .035), trainWindowMaterial);
              window.position.set(x, 1.45, -22.27);
              mapGroup.add(window);
            }
            const signMaterial = cachedMaterial("subway-sign", "#172b2c", {
              roughness: .5, metalness: .25, emissive: "#22666a", emissiveIntensity: .45
            });
            for (const [x, y, width] of [[5, 6, 4], [24, 6, 4], [5, 23, 4], [24, 23, 4]]) {
              const sign = new THREE.Mesh(cachedBoxGeometry(width, .7, .12), signMaterial);
              sign.position.set(x, 3.25, -y);
              mapGroup.add(sign);
            }
            const tileMaterial = cachedMaterial("subway-platform-tile", "#a9a18b", { roughness: .78 });
            for (const y of [8.5, 20.5]) {
              const warningStrip = new THREE.Mesh(cachedBoxGeometry(9, .025, .24), tileMaterial);
              warningStrip.position.set(width / 2, .01, -y);
              mapGroup.add(warningStrip);
            }
            for (const [x, y, color] of [[5, 5, "#4ac6c1"], [24, 24, "#f2ae61"], [24, 5, "#5bb9db"]]) {
              const lamp = new THREE.PointLight(color, 2.1, 10, 2);
              lamp.position.set(x, 3.1, -y);
              mapGroup.add(lamp);
              dynamicMapLights.push(lamp);
              lamp.userData.baseIntensity = 2.1;
          }
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
              mapId === "arena" && lightIndex === 0 ? 2.2 : mapId === "pool" ? 1.05 :
                mapId === "iron_foundry" ? .55 : 1.25,
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

      function validateMapDefinition(mapId) {
        const definition = mapDefinitions[mapId];
        if (!definition || !Array.isArray(definition.grid) || definition.grid.length < 3) {
          throw new RangeError(`Map "${mapId}" is missing its collision grid.`);
        }
        const width = definition.grid[0].length;
        if (width < 3 || definition.grid.some(row =>
          typeof row !== "string" || row.length !== width || /[^01]/.test(row)
        )) throw new Error(`Map "${mapId}" has an invalid collision grid.`);
        const dimensions = definition.dimensions || { width, depth: definition.grid.length };
        if (dimensions.width !== width || dimensions.depth !== definition.grid.length) {
          throw new Error(`Map "${mapId}" has collision dimensions that do not match its grid.`);
        }
        for (const box of definition.collisionBoxes || []) {
          if (![box.minX, box.maxX, box.minY, box.maxY, box.minHeight, box.maxHeight].every(Number.isFinite) ||
            box.minX < 0 || box.minY < 0 || box.maxX > width || box.maxY > definition.grid.length ||
            box.minX >= box.maxX || box.minY >= box.maxY || box.minHeight > box.maxHeight) {
            throw new Error(`Map "${mapId}" has an invalid obstacle collision box.`);
          }
        }
        const validMapPoint = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
          x >= .24 && y >= .24 && x <= width - .24 && y <= definition.grid.length - .24 &&
          canOccupyOnMap(definition.grid, x, y, .24);
        const validPosition = position => position?.isVector3 &&
          Number.isFinite(position.x) && Number.isFinite(position.y) &&
          Number.isFinite(position.z) && Math.abs(position.y) < .001 &&
          validMapPoint(position.x, -position.z);
        if (!definition.spawnPoints?.some(validPosition) ||
          !definition.enemySpawns?.some(validPosition) ||
          !validMapPoint(definition.spawn?.x, definition.spawn?.y)) {
          throw new Error(`Map "${mapId}" is missing valid player or enemy spawn nodes.`);
        }
        if (!definition.grid.some(row => row.includes("1")) ||
          !definition.grid.some(row => row.includes("0"))) {
          throw new Error(`Map "${mapId}" is missing floor or wall geometry.`);
        }
        return definition;
      }

      function loadMap(requestedMapId) {
        const mapId = requestedMapId === "foundry" ? "iron_foundry" : requestedMapId;
        const definition = validateMapDefinition(mapId);
        vfxSystem.clearDecals();
        activeMapId = mapId;
        map = mapDefinitions[mapId].grid;
        if (mapGroup) scene.remove(mapGroup);
        mapWalls = null;
        mapGroup = new THREE.Group();
        mapGroup.name = `map-${mapId}`;
        scene.add(mapGroup);
        scene.background = new THREE.Color(definition.background);
        scene.fog = new THREE.Fog(
          definition.fog, definition.fogNear ?? 12, definition.fogFar ?? (mapId === "battlefield" ? 42 : 34)
        );
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
        if (!mapWalls || mapWalls.count <= 0 || !mapGroup.children.length) {
          throw new Error(`Map "${mapId}" did not build its collision walls and scene geometry.`);
        }
        if (mapId === "arena") {
          const duck = new THREE.Group();
          const yellow = cachedMaterial("easter-egg-duck", "#f0c84b", { roughness: .72 });
          const orange = cachedMaterial("easter-egg-duck-beak", "#e77937", { roughness: .72 });
          const dark = cachedMaterial("easter-egg-headphones", "#252c33", { metalness: .35 });
          const body = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 8), yellow);
          body.scale.set(1.25, .85, 1);
          const head = new THREE.Mesh(new THREE.SphereGeometry(.095, 12, 8), yellow);
          head.position.set(.03, .14, -.02);
          const beak = new THREE.Mesh(new THREE.ConeGeometry(.035, .1, 8), orange);
          beak.position.set(.11, .13, -.09);
          beak.rotation.x = Math.PI / 2;
          const headphoneBand = new THREE.Mesh(new THREE.TorusGeometry(.09, .012, 6, 18, Math.PI), dark);
          headphoneBand.position.set(.03, .16, 0);
          headphoneBand.rotation.z = Math.PI;
          const earCup = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .035, 8), dark);
          earCup.rotation.z = Math.PI / 2;
          earCup.position.set(-.055, .15, 0);
          duck.add(body, head, beak, headphoneBand, earCup);
          duck.position.set(14.55, .18, -14.55);
          duck.rotation.y = -.45;
          mapGroup.add(duck);
        }
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
          const attachment = input.dataset.attachment;
          const compatible = loadoutWeaponIndex !== 4 && !((attachment === "optic" &&
            (loadoutWeaponIndex === 2 || loadoutWeaponIndex === 4)) ||
            (attachment === "suppressor" && loadoutWeaponIndex === 4));
          const unlocked = ownedAttachments.has(attachment);
          input.checked = Boolean(weapons[loadoutWeaponIndex].attachments[attachment]);
          input.disabled = !compatible || !unlocked;
          const status = document.querySelector(`[data-attachment-status="${attachment}"]`);
          if (status) status.textContent = !compatible ? "NOT COMPATIBLE"
            : unlocked ? "" : "LOCKED - OUTPOST";
        });
      }

      function initializeWeapons() {
        weaponAnchor = new THREE.Group();
        weaponAnchor.position.set(.32, -.3, -.48);
        camera.add(weaponAnchor);
        parryShield = new THREE.Group();
        parryShield.name = "knife-parry-shield";
        const shieldMaterial = new THREE.MeshBasicMaterial({
          color: "#64dce3",
          transparent: true,
          opacity: .2,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false
        });
        const shieldMembrane = new THREE.Mesh(new THREE.CircleGeometry(.48, 40), shieldMaterial);
        shieldMembrane.position.z = -.9;
        shieldMembrane.renderOrder = 8;
        const shieldRing = new THREE.Mesh(
          new THREE.RingGeometry(.49, .53, 40),
          new THREE.MeshBasicMaterial({
            color: "#b3fbf3",
            transparent: true,
            opacity: .75,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
          })
        );
        shieldRing.position.z = -.89;
        shieldRing.renderOrder = 9;
        parryShield.add(shieldMembrane, shieldRing);
        parryShield.userData.membraneMaterial = shieldMaterial;
        parryShield.userData.ringMaterial = shieldRing.material;
        parryShield.visible = false;
        camera.add(parryShield);
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
            if (index !== 4) {
              const attachmentMaterial = cachedMaterial("weapon-attachment-dark", "#252c2b", {
                roughness: .42, metalness: .68
              });
              const glassMaterial = cachedMaterial("weapon-attachment-glass", "#5cbec2", {
                roughness: .2, metalness: .24, emissive: "#19494c", emissiveIntensity: .65
              });
              const optic = new THREE.Group();
              optic.name = "weapon-optic";
              const opticBody = new THREE.Mesh(cachedBoxGeometry(.11, .075, .12), attachmentMaterial);
              opticBody.position.set(0, .105, -.2);
              const opticGlass = new THREE.Mesh(cachedBoxGeometry(.065, .018, .065), glassMaterial);
              opticGlass.position.set(0, .147, -.2);
              optic.add(opticBody, opticGlass);
              const suppressor = new THREE.Mesh(
                cachedCylinderGeometry(.04, .04, .28, 10), attachmentMaterial
              );
              suppressor.name = "weapon-suppressor";
              suppressor.rotation.x = Math.PI / 2;
              suppressor.position.set(0, .005, -.48);
              const foregrip = new THREE.Mesh(cachedBoxGeometry(.07, .16, .08), attachmentMaterial);
              foregrip.name = "weapon-foregrip";
              foregrip.position.set(0, -.105, -.32);
              model.add(optic, suppressor, foregrip);
            }
            model.traverse(object => {
              if (!object.isMesh) return;
              const partName = object.name.toLowerCase();
              const isPump = index === 2 && /pump|fore[_ -]?end|forend/.test(partName);
              const isBolt = /bolt|slide|charging[_ -]?handle/.test(partName);
              if (!isPump && !isBolt) return;
              object.userData.weaponMotion = isPump ? "pump" : "bolt";
              object.userData.weaponRestZ = object.position.z;
            });
            weaponMuzzles[index] = weaponAssetLoader.getMuzzle(model, index);
            weaponSights[index] = weaponAssetLoader.getSight(model, index);
            applyWeaponAttachments(index);
          });
          applyWeaponCamo();
          enemyModels.forEach(model => {
            if (model.userData.rigged) model.userData.weaponIndex = -1;
          });
          if (playerRigModel) playerRigModel.userData.weaponIndex = -1;
        });
      }
      const player = new Player(mapDefinitions[activeMapId].spawn);
      initializeWeapons();
      const keys = new Set();
      let enemies = [];
      let explosions = [];
      let pickups = [];
      let sukunaActive = false;
      let sukunaWavesRemaining = 0;
      let sukunaActivationWave = 0;
      let sukunaOriginalWeaponIndex = 0;
      let sukunaProjectiles = [];
      let domainEffectTimeout = 0;
      let boss = null;
      let playerFlashTimer = 0;
      let playerFlashFadeTimer = 0;
      let playerFlashFadeIn = 0;
      let playerFlashOpacity = 0;
      let waveFiveDropSpawned = false;
      let waveRewardsAwarded = new Set();
      let nextEnemyId = 0, killStreak = 0;
      let resultSubmitted = false;
      const replayGhosts = new Map();
      let running = false, locallyPaused = false, gameOver = false, pointerLockUnavailable = false, wave = 0, lastTime = 0;
      let deploymentCountdownToken = 0;
      let fireCooldown = 0, reloadTimer = 0, hurtFlash = 0, muzzleFlash = 0;
      let parryCharges = 5, parryCooldown = 0, parryPulse = 0;
      let hitMarkerTimeout = 0, hitConfirmationTimeout = 0;
      let reloadDuration = 0;
      let firing = false, aiming = false, toastTimeout = 0, knifeSwing = 0, movementBob = 0;
      let knifeComboStep = 0, knifeAttackStyle = "stab";
      let weaponRecoil = 0, recoilPitch = 0, recoilYaw = 0, weaponLagX = 0, dashTimer = 0, dashCooldown = 0;
      let stamina = 100, sprintExhausted = false, jumpHeight = 0, jumpVelocity = 0,
        bunnyHopMultiplier = 1, cameraKickback = 0;
      let rooftopFallHeight = 0, rooftopFallVelocity = 0, rooftopFalling = false;
      let playerAnimationState = "idle";
      const inspectDuration = 1.45;
      let inspectTimer = 0;
      let dashDirectionX = 0, dashDirectionY = 0;
      const dashDuration = .38;
      let touchMovementX = 0, touchMovementY = 0, lookPointerId = null, lastLookX = 0, lastLookY = 0;
      let touchStickPointerId = null;
      let grenadeCooldown = 0, flashbangCooldown = 0, grenadeAnimation = 0, flashbangAnimation = 0;
      let grenades = 2, flashbangs = 1;
      let grenadeFlash = 0, damageMessageTimer = 0, footstepsTimer = 0;
      let credits = 0;
      const cosmeticItems = [
        { id: "skin-winter", label: "Winter Soldier", type: "skin", color: "#b7d5e0", price: 1000 },
        { id: "skin-helmet", label: "Bike Helmet", type: "skin", color: "#e5aa51", price: 2500 },
        { id: "skin-camo", label: "Field Camo", type: "skin", color: "#788b52", price: 4000 },
        { id: "camo-arctic", label: "Arctic Camo", type: "camo", color: "#b5d3d4", price: 6000 },
        { id: "camo-ember", label: "Ember Camo", type: "camo", color: "#ca583c", price: 8000 },
        { id: "camo-obsidian", label: "Obsidian Camo", type: "camo", color: "#292f38", price: 10000 },
        { id: "attachment-optic", label: "Reflex Optic", type: "attachment", attachment: "optic", color: "#4b8c91", price: 900 },
        { id: "attachment-suppressor", label: "Suppressor", type: "attachment", attachment: "suppressor", color: "#41494b", price: 1200 },
        { id: "attachment-foregrip", label: "Angled Foregrip", type: "attachment", attachment: "foregrip", color: "#6d695d", price: 700 }
      ];
      const achievementDetails = {
        first_blood: { title: "First Blood", description: "Eliminate your first hostile." },
        headshot: { title: "Dead Center", description: "Earn a headshot elimination." },
        backstab: { title: "Behind You", description: "Earn a backstab elimination." },
        streak_three: { title: "UAV Operator", description: "Reach a three-elimination streak." },
        streak_five: { title: "Air Support", description: "Reach a five-elimination streak." }
      };
      let ownedCosmetics = new Set();
      let ownedAttachments = new Set();
      let unlockedAchievements = new Set();
      let equippedSkin = "";
      let equippedCamo = "";
      let shopReturnScreen = mainMenu;
      let achievementTimeout = 0;
      let bossBarFill = document.querySelector("#boss-health-fill");
      let creditsDisplay = document.querySelector("#credits");
      const controlSettings = { mouseSensitivity: 1, scopeSensitivity: .25, fieldOfView: 82, masterVolume: .7 };
      let settingsReturnToPause = false;
      let reloadKind = "";
      let lastEscapePress = 0;
      let pointerLockPauseAt = 0;
      let escapeRunningBeforeFirst = false;
      let escapeLocallyPausedBeforeFirst = false;
      let suppressPointerLockPauseUntil = 0;
      let operatorName = "", selectedMode = "ffa-waves", gameMode = "waves";
      let roomMessageTimeout = 0, profileReturnScreen = mainMenu;

      try {
        operatorName = localStorage.getItem("blacksite.operator") || "";
      } catch (error) {
        console.warn("Local profile storage is unavailable.", error);
      }

      try {
        const savedProgression = JSON.parse(localStorage.getItem("blacksite.progression") || "{}");
        credits = Number.isSafeInteger(savedProgression.credits) && savedProgression.credits >= 0
          ? savedProgression.credits : 0;
        const validCosmeticIds = new Set(cosmeticItems.filter(item => item.type !== "attachment").map(item => item.id));
        ownedCosmetics = new Set(Array.isArray(savedProgression.owned)
          ? savedProgression.owned.filter(id => validCosmeticIds.has(id)) : []);
        const validAttachmentIds = new Set(cosmeticItems.filter(item => item.type === "attachment").map(item => item.attachment));
        ownedAttachments = new Set(Array.isArray(savedProgression.attachments)
          ? savedProgression.attachments.filter(name => validAttachmentIds.has(name)) : []);
        const validAchievementIds = new Set(Object.keys(achievementDetails));
        unlockedAchievements = new Set(Array.isArray(savedProgression.achievements)
          ? savedProgression.achievements.filter(id => validAchievementIds.has(id)) : []);
        equippedSkin = ownedCosmetics.has(savedProgression.equippedSkin) ? savedProgression.equippedSkin : "";
        equippedCamo = ownedCosmetics.has(savedProgression.equippedCamo) ? savedProgression.equippedCamo : "";
        if (Array.isArray(savedProgression.weaponAttachments)) {
          savedProgression.weaponAttachments.forEach((attachments, index) => {
            if (!attachments || !weapons[index]) return;
            for (const name of Object.keys(weapons[index].attachments)) {
              weapons[index].attachments[name] = ownedAttachments.has(name) && attachments[name] === true;
            }
          });
        }
      } catch (error) {
        console.warn("Saved operator progression could not be loaded.", error);
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
        document.querySelector("#fov-value").value = `${controlSettings.fieldOfView} deg`;
        document.querySelector("#volume-value").value = `${Math.round(controlSettings.masterVolume * 100)}%`;
        audioManager.setMasterVolume(controlSettings.masterVolume);
      }

      function saveProgression() {
        try {
          localStorage.setItem("blacksite.progression", JSON.stringify({
            credits, owned: [...ownedCosmetics], attachments: [...ownedAttachments], achievements: [...unlockedAchievements],
            equippedSkin, equippedCamo,
            weaponAttachments: weapons.map(weapon => ({ ...weapon.attachments }))
          }));
        } catch (error) {
          console.warn("Operator progression could not be saved.", error);
          setCombatMessage("PROGRESSION COULD NOT BE SAVED", 1800);
        }
        creditsDisplay.textContent = String(credits);
        document.querySelector("#shop-credits").textContent = String(credits);
      }

      function cosmeticColor(id) {
        return cosmeticItems.find(item => item.id === id)?.color || "";
      }

      function applyWeaponCamo() {
        const color = cosmeticColor(equippedCamo);
        for (const holder of weaponModels) {
          holder.traverse(object => {
            if (!object.isMesh) return;
            if (!object.userData.camoBaseMaterial) {
              object.userData.camoBaseMaterial = object.material;
              object.userData.camoMaterial = Array.isArray(object.material)
                ? object.material.map(material => material.clone())
                : object.material.clone();
            }
            const base = object.userData.camoBaseMaterial;
            const camo = object.userData.camoMaterial;
            const bases = Array.isArray(base) ? base : [base];
            const camos = Array.isArray(camo) ? camo : [camo];
            camos.forEach((material, index) => {
              material.color.copy(bases[index].color);
              if (color) material.color.lerp(new THREE.Color(color), .44);
            });
            object.material = camo;
          });
        }
      }

      function applyRemoteCosmetics() {
        if (!remoteModel) return;
        const skinColor = cosmeticColor(remotePlayer?.skin);
        const camoColor = cosmeticColor(remotePlayer?.camo);
        remoteModel.traverse(object => {
          if (!object.isMesh || object.userData.isHitbox) return;
          if (/torso|arm|leg/i.test(object.name)) {
            if (!object.userData.skinBaseMaterial) {
              object.userData.skinBaseMaterial = object.material;
              object.material = Array.isArray(object.material)
                ? object.material.map(material => material.clone())
                : object.material.clone();
            }
            const baseMaterials = Array.isArray(object.userData.skinBaseMaterial)
              ? object.userData.skinBaseMaterial : [object.userData.skinBaseMaterial];
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material, index) => {
              material.color.copy(baseMaterials[index].color);
              if (skinColor) material.color.set(skinColor);
            });
          }
          if (/helmet|visor/i.test(object.name)) {
            if (!object.userData.skinBaseMaterial) {
              object.userData.skinBaseMaterial = object.material;
              object.material = Array.isArray(object.material)
                ? object.material.map(material => material.clone())
                : object.material.clone();
            }
            const baseMaterials = Array.isArray(object.userData.skinBaseMaterial)
              ? object.userData.skinBaseMaterial : [object.userData.skinBaseMaterial];
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material, index) => {
              material.color.copy(baseMaterials[index].color);
              if (remotePlayer?.skin === "skin-helmet") material.color.set("#e5aa51");
            });
          }
          let ancestor = object;
          let isWeaponPart = false;
          while (ancestor && ancestor !== remoteModel) {
            if (ancestor.userData.isWeapon || ancestor.name === "Hand_R") {
              isWeaponPart = true;
              break;
            }
            ancestor = ancestor.parent;
          }
          if (isWeaponPart) {
            if (!object.userData.remoteBaseMaterial) {
              object.userData.remoteBaseMaterial = object.material;
              object.userData.remoteCamoMaterial = Array.isArray(object.material)
                ? object.material.map(material => material.clone())
                : object.material.clone();
            }
            const baseMaterials = Array.isArray(object.userData.remoteBaseMaterial)
              ? object.userData.remoteBaseMaterial : [object.userData.remoteBaseMaterial];
            const camoMaterials = Array.isArray(object.userData.remoteCamoMaterial)
              ? object.userData.remoteCamoMaterial : [object.userData.remoteCamoMaterial];
            camoMaterials.forEach((material, index) => {
              material.color.copy(baseMaterials[index].color);
              if (camoColor) material.color.lerp(new THREE.Color(camoColor), .44);
            });
            object.material = object.userData.remoteCamoMaterial;
          }
        });
      }

      function createNameplate(name) {
        const surface = document.createElement("canvas");
        surface.width = 512;
        surface.height = 96;
        const context = surface.getContext("2d");
        context.fillStyle = "rgba(10,15,12,.78)";
        context.fillRect(12, 12, 488, 72);
        context.strokeStyle = "rgba(193,225,109,.72)";
        context.strokeRect(12, 12, 488, 72);
        context.font = "700 36px Segoe UI, Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#edf4df";
        context.fillText(name.slice(0, 16), 256, 48, 450);
        const texture = new THREE.CanvasTexture(surface);
        texture.encoding = THREE.sRGBEncoding;
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.45, .28, 1);
        sprite.position.y = 2.2;
        sprite.userData.nameplate = name;
        return sprite;
      }

      function renderShop() {
        const container = document.querySelector("#shop-items");
        container.replaceChildren();
        document.querySelector("#shop-credits").textContent = String(credits);
        for (const item of cosmeticItems) {
          const attachmentItem = item.type === "attachment";
          const owned = attachmentItem
            ? ownedAttachments.has(item.attachment)
            : ownedCosmetics.has(item.id);
          const equipped = !attachmentItem && (equippedSkin === item.id || equippedCamo === item.id);
          const row = document.createElement("article");
          row.className = "shop-item";
          const preview = document.createElement("span");
          preview.className = "shop-swatch";
          preview.style.backgroundColor = item.color;
          const description = document.createElement("div");
          description.className = "shop-item-copy";
          const title = document.createElement("strong");
          title.textContent = item.label;
          const price = document.createElement("span");
          price.textContent = owned
            ? equipped ? "EQUIPPED" : attachmentItem ? "UNLOCKED FOR WEAPON BENCH" : "OWNED"
            : `${item.price.toLocaleString()} CREDITS`;
          description.append(title, price);
          const action = document.createElement("button");
          action.type = "button";
          action.dataset.cosmetic = item.id;
          action.textContent = owned
            ? equipped ? "EQUIPPED" : attachmentItem ? "UNLOCKED" : "EQUIP"
            : credits >= item.price ? "PURCHASE" : "LOCKED";
          action.disabled = (owned && (equipped || attachmentItem)) || (!owned && credits < item.price);
          row.append(preview, description, action);
          container.append(row);
        }
      }

      function useCosmetic(id) {
        const item = cosmeticItems.find(candidate => candidate.id === id);
        if (!item) return;
        if (item.type === "attachment") {
          if (!ownedAttachments.has(item.attachment)) {
            if (credits < item.price) return;
            credits -= item.price;
            ownedAttachments.add(item.attachment);
          }
          saveProgression();
          updateLoadoutControls();
          renderShop();
          return;
        }
        if (!ownedCosmetics.has(id)) {
          if (credits < item.price) return;
          credits -= item.price;
          ownedCosmetics.add(id);
        }
        if (item.type === "skin") equippedSkin = id;
        else equippedCamo = id;
        saveProgression();
        applyWeaponCamo();
        renderShop();
        sendPlayerState();
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
          const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
          if (fullscreenElement) {
            const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
            if (!exitFullscreen) throw new Error("Fullscreen exit is not supported.");
            await exitFullscreen.call(document);
          } else {
            const shell = document.querySelector(".game-shell");
            const requestTarget = shell.requestFullscreen || shell.webkitRequestFullscreen
              ? shell
              : document.documentElement;
            const requestFullscreen = requestTarget.requestFullscreen || requestTarget.webkitRequestFullscreen;
            if (!requestFullscreen) throw new Error("Fullscreen is not supported on this device.");
            await requestFullscreen.call(requestTarget);
          }
        } catch (error) {
          console.error("Could not change fullscreen mode.", error);
          setCombatMessage("FULLSCREEN IS NOT AVAILABLE", 1800);
        }
      }

      function syncFullscreenButton() {
        const fullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
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
        if (data.type === "shot-parried") {
          setCombatMessage("SHOT PARRIED", 700);
          return;
        }
        showMenu(mainMenu);
      }

      function disconnectPeer() {
        const connection = networkConnection;
        if (connection?.open) {
          connection.send({ type: "player-left", username: operatorName || "Operator" });
        }
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
        respawnCountdown = 0;
        deploymentCountdownToken++;
        document.querySelector("#deploy-countdown").hidden = true;
        deactivateSukunaPower(false);
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
        pickups.forEach(pickup => {
          scene.remove(pickup.model);
          pickup.model.userData.disposableResources?.forEach(resource => resource.dispose());
        });
        pickups.length = 0;
        sukunaProjectiles.forEach(projectile => {
          scene.remove(projectile.model);
          projectile.model.traverse(object => {
            object.geometry?.dispose();
          });
        });
        sukunaProjectiles.length = 0;
        document.querySelector("#domain-overlay").hidden = true;
        domainEffectTimeout = 0;
        boss = null;
        waveFiveDropSpawned = false;
        waveRewardsAwarded.clear();
        playerFlashTimer = 0;
        playerFlashFadeTimer = 0;
        document.querySelector("#boss-health").hidden = true;
        document.querySelector("#damage-overlay").style.removeProperty("--flashbang-opacity");
        enemies.length = 0;
        for (const model of enemyModels.values()) scene.remove(model);
        enemyModels.clear();
        for (const ghost of replayGhosts.values()) {
          scene.remove(ghost);
          ghost.traverse(object => object.geometry?.dispose());
        }
        replayGhosts.clear();
        if (replayPlayerModel) {
          scene.remove(replayPlayerModel);
          replayPlayerModel = null;
          replayPlayerActor = null;
        }
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
        stamina = 100;
        jumpHeight = 0;
        jumpVelocity = 0;
        rooftopFallHeight = 0;
        rooftopFallVelocity = 0;
        rooftopFalling = false;
        playerAnimationState = "idle";
        bunnyHopMultiplier = 1;
        cameraKickback = 0;
        inspectTimer = 0;
        updateInspectControl();
        staminaFill.style.width = "100%";
        staminaFill.style.background = "#79d8d0";
        staminaValue.textContent = "100";
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
        if (screen === shopScreen) renderShop();
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

      function unlockAchievement(id) {
        if (unlockedAchievements.has(id)) return;
        const achievement = achievementDetails[id];
        if (!achievement) return;
        unlockedAchievements.add(id);
        document.querySelector("#achievement-title").textContent = achievement.title;
        document.querySelector("#achievement-description").textContent = achievement.description;
        const toast = document.querySelector("#achievement-toast");
        toast.hidden = false;
        toast.classList.remove("visible");
        void toast.offsetWidth;
        toast.classList.add("visible");
        cancelScheduledTimeout(achievementTimeout);
        achievementTimeout = scheduleTimeout(() => {
          toast.classList.remove("visible");
          toast.hidden = true;
        }, 3200);
        saveProgression();
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
          unlockAchievement("streak_three");
          enemies.forEach(enemy => { enemy.uavRevealTimer = 7; });
          setCombatMessage("UAV ACTIVE / HOSTILES REVEALED", 2200);
          playSound("hit", undefined, { volume: .8 });
        } else if (killStreak === 5) {
          unlockAchievement("streak_five");
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
        status.textContent = "Saving match result...";
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

      function playMatchReplay({ perspective = matchReplayPerspective } = {}) {
        if (!replayBuffer.startPlayback(performance.now())) {
          document.querySelector("#leaderboard-status").textContent = "Replay unavailable: not enough recorded match history.";
          return;
        }
        replayPlayback = true;
        replayPerspective = perspective;
        overlay.hidden = true;
        const replayIndicator = document.querySelector("#replay-indicator");
        replayIndicator.textContent = networkConnection?.open
          ? "BEST PLAY / SYNCHRONIZED REPLAY"
          : "BEST PLAY / FINAL 10 SECONDS";
        replayIndicator.hidden = false;
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
          position: {
            x: player.x,
            y: 1.65 + getMapElevation(player.x, player.y) + rooftopFallHeight +
              jumpHeight - (dashTimer > 0 ? .22 : 0),
            z: -player.y
          },
          angle: player.angle,
          pitch: playerPitch,
          cameraDirection: {
            x: Math.cos(player.angle) * horizontalLook,
            y: Math.sin(playerPitch),
            z: -Math.sin(player.angle) * horizontalLook
          },
          cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          fov: camera.fov,
          health: player.health,
          spawnShielded: player.spawnInvulnerability > 0,
          username: operatorName || "Operator",
          skin: equippedSkin,
          camo: equippedCamo,
          weapon: player.weaponIndex,
          animationState: playerAnimationState,
          mapId: activeMapId,
          firing
        }));
      }

      function removeRemoteModel() {
        releaseRemoteModel();
        remotePlayer = null;
        networkManager.reset();
      }

      function releaseRemoteModel() {
        if (remoteModel) {
          scene.remove(remoteModel);
          for (const resource of remoteModel.userData.disposableResources || []) resource.dispose();
          remoteModel.traverse(object => {
            if (object.userData.nameplate) {
              object.material.map?.dispose();
              object.material.dispose();
            }
            if (object.userData.remoteCamoMaterial) object.userData.remoteCamoMaterial.dispose();
            if (object.userData.skinBaseMaterial) object.material.dispose();
          });
        }
        remoteModel = null;
      }

      function applyRemoteShot(angle, pitch, weaponIndex) {
        if (!running || gameOver || gameMode === "infinite" || player.spawnInvulnerability > 0 || gameMode === "coop" ||
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
        if (parryIncomingBullet()) {
          sendPeerMessage({ type: "shot-parried" });
          return;
        }
        const headshot = shotHeight >= 1.48;
        const attackerBehind = weaponIndex === 4 &&
          Math.cos(player.angle) * (remotePlayer.x - player.x) +
          Math.sin(player.angle) * (remotePlayer.y - player.y) < -along * .35;
        const backstab = Boolean(attackerBehind);
        player.health = Math.max(0, player.health - weapon.damage * (headshot ? 3 : 1));
        document.querySelector("#health").textContent = player.health;
        const fill = document.querySelector("#health-fill");
        fill.style.width = `${player.health}%`;
        fill.style.background = player.health < 35 ? "#dd6d58" : "#57c2c8";
        document.querySelector("#damage-overlay").classList.add("visible");
        scheduleTimeout(() => document.querySelector("#damage-overlay").classList.remove("visible"), 300);
        setCombatMessage(`HIT BY ${weapon.short}`);
        sendPeerMessage({
          type: "shot-confirmation",
          headshot,
          backstab,
          eliminated: player.health === 0
        });
        sendPlayerState();
        if (player.health === 0) {
          endGame({ replay: true });
        }
      }

      function handlePeerData(data) {
        if (!data || typeof data !== "object") return;
        if (data.type === "player-left") {
          const name = typeof data.username === "string" && data.username.trim()
            ? data.username.slice(0, 16)
            : "Opponent";
          setCombatMessage(`${name} has left`, 4000);
          setRoomMessage(`${name} has left the match.`);
          updateRoomPanel(`${name} has left the match.`);
          return;
        }
        if (data.type === "match-end" && networkConnection?.open && !gameOver) {
          endGame({ won: !data.won, replay: Boolean(data.replay), fromPeer: true });
          return;
        }
        if (data.type === "shot-confirmation" &&
          typeof data.headshot === "boolean" && typeof data.backstab === "boolean" &&
          typeof data.eliminated === "boolean") {
          showHitMarker();
          if (data.headshot || data.backstab || data.eliminated) {
            showHitConfirmation(data.headshot ? "HEADSHOT" : data.backstab ? "BACKSTAB" : "ELIMINATED");
          }
          return;
        }
        if (data.type === "flashbang" && Number.isFinite(data.x) && Number.isFinite(data.y) &&
        Number.isFinite(data.sourceAngle)) {
        applyFlashToPlayer(data.x, data.y, data.sourceAngle);
        return;
        }
        if (data.type === "room-config" && networkRole !== "host" &&
          ["ffa-waves", "duel", "ffa", "tdm"].includes(data.mode) &&
          typeof data.mapId === "string" && mapDefinitions[data.mapId]) {
          const spawnPoints = data.spawns;
          const guestSpawn = spawnPoints?.guest;
          const hostSpawn = spawnPoints?.host;
          const mapGrid = mapDefinitions[data.mapId].grid;
          const validSpawn = position => position &&
            Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) &&
            Math.abs(position.y) < .001 &&
            canOccupyOnMap(mapGrid, position.x, -position.z, .24);
          if (!validSpawn(hostSpawn)) {
            setRoomMessage("The host supplied invalid map spawn coordinates. Disconnecting.", true);
            networkConnection?.close();
            return;
          }
          selectedMode = data.mode;
          selectedMapId = data.mapId;
          gameMode = data.mode === "ffa-waves" ? "coop" : data.mode;
          if (activeMapId !== data.mapId) loadMap(data.mapId);
          const guestSeparated = validSpawn(guestSpawn) &&
            Math.hypot(guestSpawn.x - hostSpawn.x, guestSpawn.z - hostSpawn.z) >= 2.4;
          const assignedGuestSpawn = guestSeparated
            ? new THREE.Vector3(guestSpawn.x, guestSpawn.y, guestSpawn.z)
            : findNearestValidSpawn(mapGrid, guestSpawn, hostSpawn);
          if (!assignedGuestSpawn) {
            setRoomMessage("No collision-free spawn is available for Player 2.", true);
            networkConnection?.close();
            return;
          }
          startGame(gameMode, true, { acquirePointerLock: false, spawnPosition: assignedGuestSpawn });
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
          (data.fov === undefined || (Number.isFinite(data.fov) && data.fov >= 30 && data.fov <= 120)) &&
          (data.cameraPosition === undefined || (data.cameraPosition &&
            [data.cameraPosition.x, data.cameraPosition.y, data.cameraPosition.z].every(Number.isFinite))) &&
          (data.spawnShielded === undefined || typeof data.spawnShielded === "boolean") &&
          (data.username === undefined || typeof data.username === "string") &&
          (data.skin === undefined || typeof data.skin === "string") &&
          (data.camo === undefined || typeof data.camo === "string") &&
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
          remotePlayer = { ...accepted, username: data.username || "Opponent", skin: data.skin || "", camo: data.camo || "" };
          if (accepted.health === 0 && running && !gameOver) endGame({ won: true, replay: true, fromPeer: true });
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
          if (networkRole === "host") {
            const roomMode = roomConfiguration ? roomConfiguration.mode : selectedMode;
            const roomMap = roomConfiguration ? roomConfiguration.mapId : selectedMapId;
            updateRoomPanel(`Connected to ${connection.peer}. Starting ${roomMode.toUpperCase()}...`);
            selectedMapId = roomMap;
            if (activeMapId !== roomMap) loadMap(roomMap);
            gameMode = roomMode === "ffa-waves" ? "coop" : roomMode;
            const hostSpawn = getPlayerSpawnPosition("host");
            const guestSpawn = getPlayerSpawnPosition("guest");
            const hostWorldSpawn = { x: hostSpawn.x, y: 0, z: -hostSpawn.y };
            const guestWorldSpawn = { x: guestSpawn.x, y: 0, z: -guestSpawn.y };
            startGame(gameMode, true, { acquirePointerLock: false, spawnPosition: hostWorldSpawn });
            sendPeerMessage({
              type: "room-config",
              mode: roomMode,
              mapId: roomMap,
              spawns: {
                host: hostWorldSpawn,
                guest: guestWorldSpawn
              }
            });
            sendPlayerState();
            if (networkStateTimer) clearInterval(networkStateTimer);
            networkStateTimer = window.setInterval(sendPlayerState, 50);
          } else {
            updateRoomPanel(`Connected to ${connection.peer}. Waiting for host spawn assignment...`);
          }
          updateRoomConfigurationControls();
        });
        connection.on("data", handlePeerData);
        connection.on("close", () => {
          if (networkConnection !== connection) return;
          const opponentName = remotePlayer?.username || "Opponent";
          networkConnection = null;
          networkManager.reset();
          if (networkStateTimer) clearInterval(networkStateTimer);
          networkStateTimer = 0;
          removeRemoteModel();
          setCombatMessage(`${opponentName} has left`, 4000);
          setRoomMessage(`${opponentName} has left the match.`);
          updateRoomPanel(`${opponentName} has left the match.`);
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
        if (!running || locallyPaused || sukunaActive || inspectTimer > 0) return;
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
              if (distanceToBlast > 7.4) continue;
              if (castRayFrom(enemy.x, enemy.y, Math.atan2(impactY - enemy.y, impactX - enemy.x)).distance <
                distanceToBlast - .25) continue;
              enemy.health -= 250 * Math.max(.12, 1 - distanceToBlast / 7.4);
              if (enemy.health <= 0) eliminateEnemy(enemy, { weaponIndex: player.weaponIndex });
            }
            setCombatMessage("FRAG DETONATED");
            if (gameMode === "tdm" ? !enemies.some(enemy => enemy.team === 1) :
              !isWaveMode() && gameMode !== "training" && enemies.length === 0) endGame();
          } else {
            playSound("flash", new THREE.Vector3(impactX, .15, -impactY), { refDistance: 3, rolloffFactor: 1.1 });
            grenadeFlash = 1.2;
            addImpactParticles(new THREE.Vector3(impactX, .35, -impactY), "#fff4ce");
            enemies.forEach(enemy => {
              const distanceToBlast = Math.hypot(enemy.x - impactX, enemy.y - impactY);
              const towardBlastX = impactX - enemy.x, towardBlastY = impactY - enemy.y;
              const facingDot = (enemy.facingX || 0) * towardBlastX + (enemy.facingY || 0) * towardBlastY;
              const lineOfSight = castRayFrom(enemy.x, enemy.y, Math.atan2(towardBlastY, towardBlastX)).distance;
              if (distanceToBlast <= 8 && facingDot > 0 && lineOfSight >= distanceToBlast - .25) {
                enemy.blindTimer = 5;
                enemy.stateTimer = 0;
              }
            });
            applyFlashToPlayer(impactX, impactY, player.angle);
            sendPeerMessage({ type: "flashbang", x: impactX, y: impactY, sourceAngle: player.angle });
            setCombatMessage("FLASHBANG OUT");
          }
        }, travelTime);
      }

      function currentWeapon() {
        return weaponManager.current(player.weaponIndex);
      }

      function hasScope(weapon = currentWeapon()) {
        return Boolean(weapon.scoped || weapon.attachments.optic);
      }

      function isParrying() {
        return running && !locallyPaused && !sukunaActive && currentWeapon().melee && aiming &&
          parryCharges > 0 && parryCooldown <= 0;
      }

      function updateParryHud() {
        const indicator = document.querySelector("#parry-indicator");
        const knifeSelected = currentWeapon().melee && !sukunaActive;
        indicator.hidden = !knifeSelected;
        indicator.classList.toggle("active", isParrying());
        indicator.classList.toggle("depleted", parryCooldown > 0);
        if (!knifeSelected) {
          parryShield.visible = false;
          return;
        }
        indicator.textContent = parryCooldown > 0
          ? `PARRY DEPLETED / ${Math.ceil(parryCooldown)}S`
          : isParrying()
            ? `PARRY ACTIVE / ${parryCharges} BLOCK${parryCharges === 1 ? "" : "S"} LEFT`
            : `RIGHT CLICK TO PARRY / ${parryCharges} BLOCKS`;
        parryShield.visible = isParrying() || parryPulse > 0;
        parryShield.userData.membraneMaterial.opacity = .2 + parryPulse * .5;
      }

      function parryIncomingBullet() {
        if (!isParrying()) return false;
        parryCharges--;
        parryPulse = .32;
        playSound("parry");
        addImpactParticles(new THREE.Vector3(player.x, 1.35, -player.y), "#75e9ef");
        if (parryCharges === 0) {
          parryCooldown = 25;
          aiming = false;
          playSound("parry-break");
          setCombatMessage("PARRY SHIELD DEPLETED / 25S COOLDOWN", 1800);
        } else {
          setCombatMessage(`PARRY / ${parryCharges} BLOCKS LEFT`, 600);
        }
        updateAimHud();
        return true;
      }

      function lookSensitivityMultiplier() {
        return aiming ? hasScope() ? controlSettings.scopeSensitivity : .66 : 1;
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

      function getPlayerMuzzleWorldDirection() {
        const muzzle = weaponMuzzles[player.weaponIndex];
        if (muzzle) {
          muzzle.updateWorldMatrix(true, false);
          return new THREE.Vector3(0, 0, -1).transformDirection(muzzle.matrixWorld).normalize();
        }
        return camera.getWorldDirection(new THREE.Vector3()).normalize();
      }

      function getEnemyMuzzleWorldTransform(enemy) {
        const model = enemyModels.get(enemy);
        const muzzle = model?.userData.weaponMuzzle;
        if (muzzle) {
          model.updateWorldMatrix(true, true);
          return {
            position: muzzle.getWorldPosition(new THREE.Vector3()),
            direction: new THREE.Vector3(0, 0, -1).transformDirection(muzzle.matrixWorld).normalize()
          };
        }
        const weapon = model?.userData.weapons?.children[enemy.weaponIndex];
        const barrel = weapon?.getObjectByName("bot-weapon-barrel");
        if (barrel) {
          model.updateWorldMatrix(true, true);
          const direction = new THREE.Vector3(0, 0, -1).transformDirection(barrel.matrixWorld).normalize();
          barrel.geometry.computeBoundingBox();
          const barrelSize = barrel.geometry.boundingBox.getSize(new THREE.Vector3());
          const position = barrel.localToWorld(new THREE.Vector3(0, 0, -barrelSize.z / 2));
          return { position, direction };
        }
        const angle = enemy.faceAngle || 0;
        return {
          position: new THREE.Vector3(enemy.x, 1.2 + (enemy.fallHeight || 0), -enemy.y),
          direction: new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle))
        };
      }

      function isWaveMode() {
        return ["waves", "coop", "infinite", "zombies"].includes(gameMode);
      }

      function getPlayerSpawnPosition(role = networkRole) {
        const definition = mapDefinitions[activeMapId];
        const grid = definition.grid;
        const toPlayerPosition = worldPosition => ({ x: worldPosition.x, y: -worldPosition.z });
        const valid = worldPosition => worldPosition?.isVector3 &&
          Number.isFinite(worldPosition.x) && Number.isFinite(worldPosition.y) &&
          Number.isFinite(worldPosition.z) && Math.abs(worldPosition.y) < .001 &&
          canOccupyOnMap(grid, worldPosition.x, -worldPosition.z, .24);
        const candidates = definition.spawnPoints.filter(valid);
        if (!candidates.length) throw new Error(`Map "${activeMapId}" has no valid authored player spawns.`);
        const defaultSpawn = candidates.find(position =>
          position.x === definition.spawn.x && position.z === -definition.spawn.y
        );
        if (!defaultSpawn) throw new Error(`Map "${activeMapId}" has no valid default spawn.`);
        if (role !== "guest" || !networkConnection?.open) return toPlayerPosition(defaultSpawn);
        const opponentSpawn = new THREE.Vector3(definition.spawn.x, 0, -definition.spawn.y);
        const safeCandidates = candidates.filter(position =>
          Math.hypot(position.x - opponentSpawn.x, position.z - opponentSpawn.z) >= 4 &&
          !botAI.hasLineOfSight(grid, toPlayerPosition(opponentSpawn), toPlayerPosition(position))
        );
        const pool = safeCandidates.length ? safeCandidates : candidates;
        let spawn = defaultSpawn;
        for (const candidate of pool) {
          if (Math.hypot(candidate.x - opponentSpawn.x, candidate.z - opponentSpawn.z) >
            Math.hypot(spawn.x - opponentSpawn.x, spawn.z - opponentSpawn.z)) spawn = candidate;
        }
        return toPlayerPosition(spawn);
      }

      function findNearestValidSpawn(grid, preferredPosition, avoidPosition) {
        const definition = mapDefinitions[activeMapId];
        const candidates = [
          ...definition.spawnPoints,
          ...grid.flatMap((row, y) => Array.from(row, (cell, x) =>
            cell === "0" ? new THREE.Vector3(x + .5, 0, -(y + .5)) : null
          ).filter(Boolean))
        ].filter(position =>
          Number.isFinite(position.x) && Number.isFinite(position.z) &&
          Math.abs(position.y || 0) < .001 &&
          canOccupyOnMap(grid, position.x, -position.z, .24)
        );
        if (!candidates.length) return null;
        const isSpacedFromOpponent = (position, minimumDistance) =>
          !avoidPosition || Math.hypot(position.x - avoidPosition.x, position.z - avoidPosition.z) >= minimumDistance;
        const spacedCandidates = candidates.filter(position => isSpacedFromOpponent(position, 4));
        const safeCandidates = spacedCandidates.length
          ? spacedCandidates
          : candidates.filter(position => isSpacedFromOpponent(position, .6));
        const available = safeCandidates.length ? safeCandidates : candidates;
        const originX = Number.isFinite(preferredPosition?.x) ? preferredPosition.x : candidates[0].x;
        const originZ = Number.isFinite(preferredPosition?.z) ? preferredPosition.z : candidates[0].z;
        return available.reduce((nearest, position) =>
          Math.hypot(position.x - originX, position.z - originZ) <
            Math.hypot(nearest.x - originX, nearest.z - originZ)
            ? position
            : nearest
        ).clone();
      }

      function updateAimHud() {
        const scoped = aiming && hasScope() && !sukunaActive;
        document.querySelector("#scope-overlay").hidden = !scoped;
        document.querySelector("#crosshair").hidden = scoped;
        document.querySelector(".stage").classList.toggle("is-aiming", aiming && !sukunaActive);
        updateParryHud();
      }

      function updateWeaponHud() {
        const weapon = currentWeapon();
        document.querySelector("#weapon-label").textContent = sukunaActive ? "SUKUNA'S FINGER" : weapon.name;
        document.querySelector("#ammo").textContent = sukunaActive || weapon.melee ? "--" : weapon.ammo;
        document.querySelector("#magazine").textContent = sukunaActive || weapon.melee ? "--" : weapon.magazine;
        document.querySelector("#reserve").textContent = sukunaActive || weapon.melee
          ? "--" : String(weapon.reserve).padStart(3, "0");
        document.querySelectorAll(".weapon-slot").forEach((slot, index) => {
          slot.classList.toggle("active", index === player.weaponIndex);
          slot.setAttribute("aria-pressed", String(index === player.weaponIndex));
        });
        weaponModels.forEach((model, index) => {
          model.visible = !sukunaActive && index === player.weaponIndex && !(aiming && hasScope(weapon));
        });
      }

      function selectWeapon(index) {
        if (sukunaActive || inspectTimer > 0) return;
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
        const outside = my < 0 || mx < 0 || my >= map.length || mx >= map[my].length;
        if (outside) return activeMapId !== "rooftop";
        const definition = mapDefinitions[activeMapId];
        const elevation = getMapElevation(x, y);
        const insideBox = (definition.collisionBoxes || []).some(box =>
          x >= box.minX && x < box.maxX && y >= box.minY && y < box.maxY &&
          elevation < box.maxHeight && elevation + 1.8 > box.minHeight
        );
        return (map[my][mx] === "1" && elevation === 0) || insideBox;
      }

      function canOccupy(x, y, radius) {
        return !wallAt(x - radius, y - radius) && !wallAt(x + radius, y - radius) &&
          !wallAt(x - radius, y + radius) && !wallAt(x + radius, y + radius);
      }

      function movePlayer(dx, dy) {
        player.move(dx, dy, canOccupy);
      }

      function getMapElevation(x, y, mapId = activeMapId) {
        const zone = (mapDefinitions[mapId].elevationZones || []).find(area =>
          x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
        );
        return zone?.height || 0;
      }

      function getEnvironmentalDamage(x, y) {
        return (mapDefinitions[activeMapId].hazards || [])
          .filter(area => x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY)
          .reduce((damage, area) => damage + area.damagePerSecond, 0);
      }

      function canOccupyOnMap(grid, x, y, radius) {
        if (![x, y, radius].every(Number.isFinite) || radius < 0) return false;
        const mapId = Object.keys(mapDefinitions).find(id => mapDefinitions[id].grid === grid);
        const definition = mapId ? mapDefinitions[mapId] : null;
        const wall = (px, py) => {
          const mx = Math.floor(px), my = Math.floor(py);
          const outside = my < 0 || mx < 0 || my >= grid.length || mx >= grid[my].length;
          if (outside) return mapId !== "rooftop";
          const elevation = getMapElevation(px, py, mapId);
          const blockedByBox = (definition?.collisionBoxes || []).some(box =>
            px >= box.minX && px < box.maxX && py >= box.minY && py < box.maxY &&
            elevation < box.maxHeight && elevation + 1.8 > box.minHeight
          );
          return (grid[my][mx] !== "0" && elevation === 0) || blockedByBox;
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

      function startJump() {
        if (!running || locallyPaused || jumpHeight > 0 || jumpVelocity > 0) return;
        jumpVelocity = 5.2;
        bunnyHopMultiplier = Math.min(1.3, bunnyHopMultiplier + .08);
      }

      function inspectWeapon() {
        if (!running || locallyPaused || sukunaActive) return;
        if (inspectTimer > 0) {
          inspectTimer = 0;
          updateInspectControl();
          setCombatMessage("INSPECT CANCELED", 700);
          return;
        }
        if (reloadTimer > 0) return;
        inspectTimer = inspectDuration;
        firing = false;
        aiming = false;
        grenadeAim = false;
        updateInspectControl();
        updateAimHud();
        setCombatMessage("INSPECTING / PRESS F OR TAP CANCEL / ESC TO PAUSE", inspectDuration * 1000);
      }

      function updateInspectControl() {
        const button = document.querySelector("#touch-inspect");
        const active = inspectTimer > 0;
        button.textContent = active ? "CANCEL" : "INSPECT";
        button.setAttribute("aria-label", active ? "Cancel weapon inspection" : "Inspect weapon");
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
        updateInspectControl();
      }

      function createEnemyModel(enemy) {
        if (enemy.trainingDummy) {
          const target = new THREE.Group();
          target.userData.trainingTarget = true;
          const targetMaterial = cachedMaterial("training-target-board", "#c5a86a", { roughness: .82 });
          const centerMaterial = cachedMaterial("training-target-center", "#6a3028", { roughness: .8 });
          const standMaterial = cachedMaterial("training-target-stand", "#373d34", { metalness: .22 });
          const torso = new THREE.Mesh(cachedBoxGeometry(.72, .92, .1), targetMaterial);
          torso.position.set(0, 1.12, 0);
          torso.name = "training-chest";
          torso.userData.enemyRef = enemy;
          torso.userData.hitZone = "chest";
          torso.userData.isHitbox = true;
          const bullseye = new THREE.Mesh(cachedCylinderGeometry(.18, .18, .015, 20), centerMaterial);
          bullseye.position.set(0, 1.12, -.061);
          bullseye.rotation.x = Math.PI / 2;
          const head = new THREE.Mesh(new THREE.SphereGeometry(.21, 12, 8), targetMaterial);
          head.position.set(0, 1.78, 0);
          head.name = "training-head";
          head.userData.enemyRef = enemy;
          head.userData.hitZone = "head";
          head.userData.isHitbox = true;
          const post = new THREE.Mesh(cachedCylinderGeometry(.035, .035, .9, 8), standMaterial);
          post.position.y = .46;
          target.add(torso, bullseye, head, post);
          scene.add(target);
          enemyModels.set(enemy, target);
          return target;
        }
        if (enemyRigTemplate) {
          const riggedModel = createRiggedEnemyModel(enemy);
          if (riggedModel) return riggedModel;
        }
        const group = new THREE.Group();
        const teamColor = enemy.type === "brute" ? "#46483f" :
          enemy.type === "zombie" ? "#4c7350" :
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
        const rightHandSocket = new THREE.Group();
        rightHandSocket.name = "Hand_R";
        rightHandSocket.position.set(0, -.23, -.15);
        rightArm.add(rightHandSocket);
        leftArm.rotation.x = rightArm.rotation.x = .62;
        leftElbow.rotation.x = rightElbow.rotation.x = -.3;
        box([.18, .1, .32], armor, [-.14, .08, -.04], "left-boot");
        box([.18, .1, .32], armor, [.14, .08, -.04], "right-boot");
        const botWeapons = new THREE.Group();
        const botWeaponMaterials = [
          cachedMaterial("bot-rifle", "#343a31", { metalness: .55 }),
          cachedMaterial("bot-sniper", "#292f2c", { metalness: .7 }),
          cachedMaterial("bot-shotgun", "#554b39", { metalness: .45 }),
          cachedMaterial("bot-smg", "#303932", { metalness: .6 }),
          cachedMaterial("bot-knife", "#a9b5b2", { metalness: .8 })
        ];
        for (let index = 0; index < weapons.length; index++) {
          const weaponMesh = new THREE.Group();
          if (index === 4) {
            const blade = new THREE.Mesh(cachedBoxGeometry(.035, .035, .38), botWeaponMaterials[index]);
            const grip = new THREE.Mesh(cachedBoxGeometry(.055, .055, .12), armor);
            blade.position.z = -.2;
            grip.position.z = .05;
            blade.castShadow = grip.castShadow = true;
            weaponMesh.add(blade, grip);
            botWeapons.add(weaponMesh);
            weaponMesh.visible = index === enemy.weaponIndex;
            continue;
          }
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
        rightHandSocket.add(botWeapons);
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
        group.scale.setScalar(enemy.type === "boss" ? 1.72 : enemy.type === "brute" ? 1.42 : 1.2);
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
          findBone(/^(?:hand_r|mixamorigrightHand|right[_ -]?hand|wristr)$/i);
        if (!handSocket) {
          if (!warnedMissingHandSocket) {
            warnedMissingHandSocket = true;
            console.warn("The optional enemy rig has no Hand_R/right-hand bone; using the procedural bot.");
          }
          return null;
        }
        model.scale.setScalar(enemy.type === "brute" ? 1.4 : 1.18);
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
        const clipForState = {
          idle: enemyRigAnimations.find(clip => /idle_gun|idle|stand|breath/i.test(clip.name)),
          walk: enemyRigAnimations.find(clip => /walk|move/i.test(clip.name)),
          run: enemyRigAnimations.find(clip => /run|sprint/i.test(clip.name)),
          jump: enemyRigAnimations.find(clip => /jump|leap/i.test(clip.name)),
          shoot: enemyRigAnimations.find(clip => /shoot|fire|attack/i.test(clip.name)),
          reload: enemyRigAnimations.find(clip => /reload/i.test(clip.name)),
          stab: enemyRigAnimations.find(clip => /punch_right|stab/i.test(clip.name)),
          slash: enemyRigAnimations.find(clip => /sword_slash|slash/i.test(clip.name))
        };
        const animationActions = {};
        for (const [state, clip] of Object.entries(clipForState)) {
          if (clip) animationActions[state] = animationMixer.clipAction(clip);
        }
        model.userData.rigged = true;
        model.userData.mixer = animationMixer;
        model.userData.animationActions = animationActions;
        model.userData.animationState = "";
        model.userData.weaponHand = handSocket;
        model.userData.weaponIndex = -1;
        model.userData.aimBones = [
          findBone(/upperarm_l|leftarm|arm_l/i),
          findBone(/upperarm_r|rightarm|arm_r/i)
        ].filter(Boolean).map(bone => ({ bone, restRotationX: bone.rotation.x }));
        scene.add(model);
        enemyModels.set(enemy, model);
        setRigAnimation(model, enemy.animationState || "idle");
        return model;
      }

      function setRigAnimation(model, state) {
        const actions = model.userData.animationActions;
        if (!actions) return;
        const selectedState = actions[state] ? state
          : state === "run" && actions.walk ? "walk"
            : state === "walk" && actions.run ? "run"
              : actions.idle ? "idle" : actions.walk ? "walk" : actions.run ? "run"
                : Object.keys(actions)[0];
        const nextAction = actions[selectedState];
        if (!nextAction) return;
        if (model.userData.animationState === selectedState) {
          if (["shoot", "reload", "stab", "slash"].includes(selectedState) && !nextAction.isRunning()) {
            nextAction.reset().play();
          }
          return;
        }
        const previousAction = actions[model.userData.animationState];
        const oneShot = ["shoot", "reload", "stab", "slash"].includes(selectedState);
        nextAction.reset();
        nextAction.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
        nextAction.clampWhenFinished = oneShot;
        nextAction.play();
        if (previousAction && previousAction !== nextAction) {
          previousAction.crossFadeTo(nextAction, .16, true);
        } else {
          nextAction.fadeIn(.16);
        }
        model.userData.animationState = selectedState;
      }

      function updateRiggedWeapon(model, enemy) {
        if (model.userData.weaponIndex === enemy.weaponIndex) return;
        model.userData.weaponModel?.parent?.remove(model.userData.weaponModel);
        const weapon = weaponAssetLoader.createInstance(enemy.weaponIndex);
        model.userData.weaponModel = weapon;
        model.userData.weaponIndex = weapon ? enemy.weaponIndex : -1;
        if (!weapon) return;
        const handOffset = weaponAssetLoader.getHandOffset(enemy.weaponIndex);
        weapon.position.set(...handOffset.position);
        weapon.rotation.set(...handOffset.rotation);
        weapon.scale.setScalar(handOffset.scale);
        weapon.userData.isWeapon = true;
        weapon.traverse(object => {
          object.userData.isWeapon = true;
          object.userData.enemyRef = enemy;
        });
        model.userData.weaponHand.add(weapon);
        model.userData.weaponMuzzle = weaponAssetLoader.getMuzzle(weapon, enemy.weaponIndex);
      }

      function loadEnemyRig() {
        weaponAssetLoader.loadCharacter().then(character => {
          if (!character) return;
          enemyRigTemplate = character.model;
          enemyRigAnimations = character.animations;
          if (playerRigModel) {
            scene.remove(playerRigModel);
            playerRigModel = null;
            playerRigActor = null;
          }
          releaseRemoteModel();
          if (replayPlayerModel) {
            scene.remove(replayPlayerModel);
            replayPlayerModel = null;
            replayPlayerActor = null;
          }
          for (const [enemy, model] of enemyModels) {
            scene.remove(model);
            enemyModels.delete(enemy);
          }
          playerRigActor = {
            type: "soldier", weaponIndex: player.weaponIndex, health: 100,
            phase: 0, stunned: 0, animationState: "idle"
          };
          playerRigModel = createRiggedEnemyModel(playerRigActor);
          if (playerRigModel) {
            enemyModels.delete(playerRigActor);
            const bones = [];
            playerRigModel.traverse(object => {
              if (object.isBone) bones.push(object);
              if (object.isMesh) {
                object.visible = /arm|hand/i.test(object.name) && !/torso/i.test(object.name);
                object.userData.enemyRef = null;
              }
              if (object.userData.isHitbox) object.visible = false;
            });
            playerRigModel.scale.setScalar(.45);
            playerRigModel.position.set(0, -1, -1);
            playerRigModel.rotation.set(0, Math.PI, 0);
            playerRigModel.userData.firstPerson = true;
            firstPersonHandPose = {
              index: bones.filter(bone => /^Index[1-4]R$/i.test(bone.name))
                .map(bone => ({ bone, rotation: bone.rotation.clone() }))
            };
            scene.remove(playerRigModel);
            camera.add(playerRigModel);
            if (weaponAnchor.parent !== camera) {
              weaponAnchor.parent?.remove(weaponAnchor);
              camera.add(weaponAnchor);
            }
            weaponAnchor.scale.setScalar(1);
            playerRigModel.visible = true;
            playerRigModel.userData.mixer.update(0);
          }
        }).catch(error => {
          console.error("Character rig loading failed unexpectedly; using procedural characters.", error);
        });
      }

      function updateEnemyModels(dt = 0) {
        if (playerRigModel && playerRigActor) {
          playerRigActor.weaponIndex = player.weaponIndex;
          playerRigActor.animationState = playerAnimationState;
          if (playerRigModel.userData.firstPerson) {
            playerRigModel.position.set(0, -1 - Math.min(.12, jumpHeight * .12), -1);
            playerRigModel.rotation.set(0, Math.PI, 0);
          } else {
            playerRigModel.position.set(player.x, getMapElevation(player.x, player.y) + rooftopFallHeight, -player.y);
            playerRigModel.rotation.y = player.angle - Math.PI / 2;
          }
          playerRigModel.userData.mixer.update(dt);
          setRigAnimation(playerRigModel, knifeSwing > 0 && currentWeapon().melee
            ? knifeAttackStyle : playerAnimationState);
          if (!playerRigModel.userData.firstPerson) updateRiggedWeapon(playerRigModel, playerRigActor);
          playerRigModel.visible = playerRigModel.userData.firstPerson;
        }
        const liveEnemies = new Set(enemies);
        for (const [enemy, model] of enemyModels) {
          if (liveEnemies.has(enemy)) continue;
          scene.remove(model);
          enemyModels.delete(enemy);
        }
        for (const enemy of enemies) {
          const model = enemyModels.get(enemy) || createEnemyModel(enemy);
          model.position.set(enemy.x, 0, -enemy.y);
          if (!model.userData.uavMarker && !model.userData.trainingTarget) {
            const marker = new THREE.Mesh(
              new THREE.TorusGeometry(.24, .025, 6, 16),
              new THREE.MeshBasicMaterial({ color: "#e8503f" })
            );
            marker.rotation.x = Math.PI / 2;
            marker.position.y = 2.15;
            model.add(marker);
            model.userData.uavMarker = marker;
          }
          if (model.userData.uavMarker) model.userData.uavMarker.visible = enemy.uavRevealTimer > 0;
          if (model.userData.trainingTarget) {
            model.visible = enemy.health > 0;
            continue;
          }
          const faceAngle = Number.isFinite(enemy.faceAngle) ? enemy.faceAngle : Math.atan2(player.y - enemy.y, player.x - enemy.x);
          model.rotation.y = faceAngle - Math.PI / 2;
          model.position.y = (enemy.fallHeight || 0) + getMapElevation(enemy.x, enemy.y);
          if (model.userData.rigged) {
            model.userData.mixer.update(dt);
            setRigAnimation(model, enemy.animationState || "idle");
            if (!model.userData.animationActions.shoot) {
              model.userData.aimBones.forEach(({ bone, restRotationX }, index) => {
                bone.rotation.x = restRotationX + (enemy.aiming ? index === 0 ? -.35 : .42 : 0);
              });
            }
            updateRiggedWeapon(model, enemy);
            model.visible = enemy.health > 0;
            continue;
          }
          const gait = enemy.stunned > 0 ? 0 : Math.sin(enemy.phase) * .55;
          const aimPose = enemy.aiming ? 1 : 0;
          model.userData.leftLeg.rotation.x = gait;
          model.userData.rightLeg.rotation.x = -gait;
          model.userData.leftKnee.rotation.x = Math.max(0, -gait) * .8;
          model.userData.rightKnee.rotation.x = Math.max(0, gait) * .8;
          model.userData.leftArm.rotation.x = -.7 * aimPose - gait * .3;
          model.userData.rightArm.rotation.x = .8 * aimPose + gait * .3;
          model.userData.leftElbow.rotation.x = -.65 * aimPose + Math.max(0, gait) * .2;
          model.userData.rightElbow.rotation.x = -.8 * aimPose - Math.max(0, gait) * .2;
          model.userData.weapons.children.forEach((weapon, index) => { weapon.visible = index === enemy.weaponIndex; });
          model.visible = enemy.health > 0;
        }
      }

      loadEnemyRig();

      function createRemoteModel() {
        if (remoteModel) return remoteModel;
        const remoteEnemy = {
          type: "grunt",
          weaponIndex: 0,
          health: 100,
          phase: 0,
          stunned: 0
        };
        remoteModel = createEnemyModel(remoteEnemy);
        enemyModels.delete(remoteEnemy);
        remoteModel.userData.disposableResources = [];
        remoteModel.userData.remoteEnemy = remoteEnemy;
        const muzzle = new THREE.PointLight("#ffb65c", 0, 2.5, 2);
        muzzle.position.set(.35, 1.35, -.55);
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
        remoteModel.userData.phase = 0;
        remoteModel.userData.lastPosition = null;
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
        const now = performance.now();
        const dt = model.userData.lastUpdateTime
          ? Math.min((now - model.userData.lastUpdateTime) / 1000, .05)
          : 0;
        model.userData.lastUpdateTime = now;
        const last = model.userData.lastPosition;
        const distance = last ? Math.hypot(remotePlayer.x - last.x, remotePlayer.y - last.y) : 0;
        model.userData.phase += distance * 10;
        const gait = Math.sin(model.userData.phase) * Math.min(.55, distance * 18);
        const remoteEnemy = model.userData.remoteEnemy;
        remoteEnemy.health = remotePlayer.health;
        remoteEnemy.weaponIndex = Math.max(0, Math.min(weapons.length - 1, Math.trunc(remotePlayer.weapon || 0)));
        remoteEnemy.aiming = Boolean(remotePlayer.firing);
        if (model.userData.rigged) {
          model.userData.mixer.update(dt);
          setRigAnimation(model, remotePlayer.animationState || (remotePlayer.firing ? "shoot" : distance > .005 ? "walk" : "idle"));
          updateRiggedWeapon(model, remoteEnemy);
        } else {
          model.userData.leftLeg.rotation.x = gait;
          model.userData.rightLeg.rotation.x = -gait;
          model.userData.leftKnee.rotation.x = Math.max(0, -gait) * .8;
          model.userData.rightKnee.rotation.x = Math.max(0, gait) * .8;
          model.userData.leftArm.rotation.x = (remoteEnemy.aiming ? -.7 : 0) - gait * .3;
          model.userData.rightArm.rotation.x = (remoteEnemy.aiming ? .8 : 0) + gait * .55;
          model.userData.leftElbow.rotation.x = (remoteEnemy.aiming ? -.65 : 0) + Math.max(0, gait) * .35;
          model.userData.rightElbow.rotation.x = (remoteEnemy.aiming ? -.8 : -.3) - Math.max(0, gait) * .35;
          model.userData.weapons.children.forEach((weapon, index) => {
            weapon.visible = index === remoteEnemy.weaponIndex;
          });
        }
        model.userData.lastPosition = { x: remotePlayer.x, y: remotePlayer.y };
        model.position.set(remotePlayer.x, 0, -remotePlayer.y);
        model.position.y = Math.max(0, (remotePlayer.position?.y || 1.65) - 1.65);
        model.rotation.y = remotePlayer.angle - Math.PI / 2;
        model.userData.muzzleLight.intensity = remotePlayer.firing ? .75 : 0;
        model.userData.spawnShield.visible = Boolean(remotePlayer.spawnShielded);
        const remoteName = remotePlayer.username || "Opponent";
        if (!model.userData.nameplate || model.userData.nameplate.userData.nameplate !== remoteName) {
          if (model.userData.nameplate) {
            model.remove(model.userData.nameplate);
            model.userData.nameplate.material.map.dispose();
            model.userData.nameplate.material.dispose();
          }
          model.userData.nameplate = createNameplate(remoteName);
          model.add(model.userData.nameplate);
        }
        applyRemoteCosmetics();
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

      function eliminateEnemy(enemy, {
        weaponIndex = player.weaponIndex, headshot = false, backstab = false, noScope = false
      } = {}) {
        if (enemy.trainingDummy) {
          enemy.health = enemy.maxHealth;
          enemy.underFire = false;
          const targetModel = enemyModels.get(enemy);
          if (targetModel) targetModel.visible = true;
          vfxSystem.spawnBlood(new THREE.Vector3(enemy.x, 1, -enemy.y));
          player.score += 25;
          document.querySelector("#score").textContent = String(player.score).padStart(4, "0");
          setCombatMessage("TARGET RESET / +25", 700);
          return true;
        }
        const enemyIndex = enemies.indexOf(enemy);
        if (enemyIndex < 0) return false;
        const model = enemyModels.get(enemy);
        if (model) model.visible = false;
        vfxSystem.spawnBlood(new THREE.Vector3(enemy.x, .95, -enemy.y));
        enemies.splice(enemyIndex, 1);
        if (enemy === boss) {
          boss = null;
          document.querySelector("#boss-health").hidden = true;
          player.score += 500;
          setCombatMessage("BOSS ELIMINATED / +500", 1800);
          if (wave >= 10 && !networkConnection?.open &&
            ["waves", "infinite", "zombies"].includes(gameMode) && Math.random() < .05) {
            addPickup("sukuna-finger", enemy.x, enemy.y);
            setCombatMessage("A CURSED FINGER DROPPED / PRESS E TO CLAIM", 3000);
          }
        }
        player.score += 100;
        unlockAchievement("first_blood");
        if (headshot) unlockAchievement("headshot");
        if (backstab) unlockAchievement("backstab");
        awardKillstreak();
        replayBuffer.recordEvent(performance.now(), {
          type: "kill", weapon: weaponIndex, headshot, backstab, noScope, x: enemy.x, y: enemy.y
        });
        document.querySelector("#score").textContent = String(player.score).padStart(4, "0");
        return true;
      }

      function addPickup(type, x, y, weaponIndex = -1) {
        const group = new THREE.Group();
        const color = type === "medkit" ? "#76d898" : "#dfbd67";
        const material = cachedMaterial(`pickup-${type}`, color, {
          emissive: color, emissiveIntensity: .28, roughness: .48, metalness: .15
        });
        const baseY = type === "sukuna-finger" ? .2 : .46;
        if (type === "sukuna-finger") {
          const fingerMaterial = cachedMaterial("sukuna-finger", "#7d2228", {
            emissive: "#c31e32", emissiveIntensity: .7, roughness: .34, metalness: .12
          });
          const bandMaterial = cachedMaterial("sukuna-finger-band", "#e7b46b", {
            emissive: "#ad3a32", emissiveIntensity: .45, metalness: .62, roughness: .28
          });
          const finger = new THREE.Mesh(new THREE.CylinderGeometry(.055, .085, .38, 10), fingerMaterial);
          finger.rotation.z = -Math.PI / 2;
          finger.position.y = -.07;
          const nail = new THREE.Mesh(new THREE.ConeGeometry(.055, .12, 8), bandMaterial);
          nail.rotation.z = -Math.PI / 2;
          nail.position.set(.23, -.07, 0);
          const bandA = new THREE.Mesh(new THREE.TorusGeometry(.074, .012, 6, 12), bandMaterial);
          const bandB = bandA.clone();
          bandA.rotation.y = bandB.rotation.y = Math.PI / 2;
          bandA.position.set(-.08, -.07, 0);
          bandB.position.set(.07, -.07, 0);
          const aura = new THREE.Mesh(
            new THREE.RingGeometry(.24, .3, 32),
            new THREE.MeshBasicMaterial({ color: "#e94250", transparent: true, opacity: .6, side: THREE.DoubleSide })
          );
          aura.rotation.x = -Math.PI / 2;
          aura.position.y = -.19;
          group.add(finger, nail, bandA, bandB, aura);
          group.userData.aura = aura;
          group.userData.disposableResources = [
            finger.geometry, nail.geometry, bandA.geometry, aura.geometry, aura.material
          ];
        } else {
          const item = new THREE.Mesh(cachedBoxGeometry(.34, .34, .34), material);
          item.castShadow = true;
          group.add(item);
        }
        if (type === "medkit") {
          const cross = new THREE.Mesh(cachedBoxGeometry(.2, .055, .055), cachedMaterial("pickup-medkit-cross", "#f0f3e8"));
          const crossVertical = new THREE.Mesh(cachedBoxGeometry(.055, .2, .055), cross.material);
          group.add(cross, crossVertical);
        }
        group.position.set(x, baseY, -y);
        scene.add(group);
        pickups.push({ type, x, y, weaponIndex, model: group, baseY, phase: Math.random() * Math.PI * 2 });
      }

      function spawnWaveFiveDrops() {
        const centerX = map[0].length / 2;
        const centerY = map.length / 2;
        const tiles = [];
        for (let y = 1; y < map.length - 1; y++) {
          for (let x = 1; x < map[y].length - 1; x++) {
            if (canOccupyOnMap(map, x + .5, y + .5, .24)) {
              tiles.push({ x: x + .5, y: y + .5 });
            }
          }
        }
        tiles.sort((a, b) => Math.hypot(a.x - centerX, a.y - centerY) -
          Math.hypot(b.x - centerX, b.y - centerY));
        if (tiles.length < 2) throw new Error(`Map "${activeMapId}" has no safe Wave 5 drop area.`);
        const [medkit, weapon] = tiles;
        const droppedWeapon = Math.floor(Math.random() * 4);
        addPickup("medkit", medkit.x, medkit.y);
        addPickup("weapon", weapon.x, weapon.y, droppedWeapon);
        setCombatMessage(`${weapons[droppedWeapon].short} DROP + MEDKIT IN THE ARENA`, 3000);
      }

      function updatePickups(dt) {
        for (let index = pickups.length - 1; index >= 0; index--) {
          const pickup = pickups[index];
          pickup.phase += dt * 2.4;
          pickup.model.rotation.y += dt * 1.4;
          pickup.model.position.y = pickup.baseY + Math.sin(pickup.phase) *
            (pickup.type === "sukuna-finger" ? .025 : .08);
          if (pickup.model.userData.aura) {
            pickup.model.userData.aura.material.opacity = .42 + Math.sin(pickup.phase * 1.7) * .18;
            pickup.model.userData.aura.scale.setScalar(1 + Math.sin(pickup.phase) * .08);
          }
          if (Math.hypot(player.x - pickup.x, player.y - pickup.y) > .85 || !keys.has("KeyE")) continue;
          if (pickup.type === "sukuna-finger") {
            if (!activateSukunaPower()) {
              setCombatMessage("SUKUNA'S FINGER IS SOLO ONLY", 1500);
              continue;
            }
          } else if (pickup.type === "medkit") {
            player.health = Math.min(100, player.health + 50);
            document.querySelector("#health").textContent = player.health;
            document.querySelector("#health-fill").style.width = `${player.health}%`;
            setCombatMessage("MEDKIT USED");
          } else {
            const weapon = weapons[pickup.weaponIndex];
            weapon.reserve += weapon.magazine * 2;
            weapon.ammo = Math.min(weapon.magazine, weapon.ammo + weapon.magazine);
            selectWeapon(pickup.weaponIndex);
            updateWeaponHud();
            setCombatMessage(`${weapon.short} ACQUIRED`);
          }
          scene.remove(pickup.model);
          pickup.model.userData.disposableResources?.forEach(resource => resource.dispose());
          pickups.splice(index, 1);
        }
      }

      function updateSukunaHud() {
        const hud = document.querySelector("#sukuna-hud");
        document.querySelector(".stage").classList.toggle("sukuna-active", sukunaActive);
        hud.hidden = !sukunaActive;
        if (sukunaActive) {
          hud.textContent =
            `SUKUNA'S FINGER / ${sukunaWavesRemaining} WAVES LEFT / M1 SLASH / Q CLEAVE / DISMANTLE / F FUGA / X DOMAIN`;
        }
        const touchLabels = [
          ["#touch-aim", sukunaActive ? "CLEAVE" : "AIM"],
          ["#touch-reload", sukunaActive ? "FUGA" : "RELOAD"],
          ["#touch-frag", sukunaActive ? "DOMAIN" : "FRAG"]
        ];
        touchLabels.forEach(([selector, label]) => {
          document.querySelector(selector).textContent = label;
        });
        document.querySelector("#touch-swap").hidden = sukunaActive;
        document.querySelector("#touch-inspect").hidden = sukunaActive;
        document.querySelector("#touch-flash").hidden = sukunaActive;
      }

      function activateSukunaPower() {
        if (networkConnection?.open || !["waves", "infinite", "zombies"].includes(gameMode)) return false;
        if (!sukunaActive) sukunaOriginalWeaponIndex = player.weaponIndex;
        sukunaActive = true;
        sukunaWavesRemaining = 10;
        sukunaActivationWave = wave;
        aiming = false;
        firing = false;
        grenadeAim = false;
        inspectTimer = 0;
        updateInspectControl();
        updateSukunaHud();
        updateAimHud();
        updateWeaponHud();
        setCombatMessage("SUKUNA'S FINGER AWAKENS", 2200);
        return true;
      }

      function deactivateSukunaPower(notify = false) {
        if (!sukunaActive) return;
        sukunaActive = false;
        sukunaWavesRemaining = 0;
        sukunaActivationWave = 0;
        player.weaponIndex = sukunaOriginalWeaponIndex;
        weaponManager.select(sukunaOriginalWeaponIndex);
        updateSukunaHud();
        updateWeaponHud();
        updateAimHud();
        if (notify) setCombatMessage("SUKUNA'S POWER FADES / LOADOUT RESTORED", 2200);
      }

      function getSukunaRay(maxDistance, maxTargets = 8) {
        const origin = camera.position.clone();
        const direction = camera.getWorldDirection(new THREE.Vector3()).normalize();
        raycaster.set(origin, direction);
        raycaster.near = 0;
        raycaster.far = maxDistance;
        const wallIntersection = mapWalls ? raycaster.intersectObject(mapWalls, false)[0] : null;
        const targets = enemies
          .filter(enemy => enemy.health > 0)
          .map(enemy => enemyModels.get(enemy) || createEnemyModel(enemy));
        const hits = collectPenetratingHits(
          raycaster.intersectObjects(targets, true),
          wallIntersection?.distance,
          true,
          maxTargets
        );
        const end = hits.length
          ? hits[hits.length - 1].point
          : wallIntersection
            ? wallIntersection.point
            : raycaster.ray.at(maxDistance, new THREE.Vector3());
        return { origin, direction, wallIntersection, hits, end };
      }

      function damageSukunaTargets(hits, damage) {
        if (!hits.length) return false;
        for (const hit of hits) {
          const enemy = hit.enemy;
          if (!enemies.includes(enemy)) continue;
          const normal = hit.normal || new THREE.Vector3(-hit.point.x, 0, hit.point.z).normalize();
          vfxSystem.spawnSlash(hit.point, normal, .72);
          addImpactParticles(hit.point, "#ee4351");
          enemy.health -= damage * hit.penetrationScale;
          enemy.underFire = true;
          if (enemy.health <= 0) eliminateEnemy(enemy, {
            weaponIndex: 4,
            headshot: hit.hitZone === "head"
          });
        }
        showHitMarker();
        return true;
      }

      function sukunaM1() {
        if (!sukunaActive || fireCooldown > 0) return;
        fireCooldown = .42;
        playSound("knife");
        const attack = getSukunaRay(2.8, 1);
        vfxSystem.spawnBullet(attack.origin, attack.end, { color: "#ff5a66", speed: 110 });
        damageSukunaTargets(attack.hits, 420);
        if (!attack.hits.length && attack.wallIntersection) {
          vfxSystem.spawnSlash(attack.wallIntersection.point, attack.wallIntersection.face?.normal || new THREE.Vector3(0, 1, 0));
        }
      }

      function castSukunaCleave() {
        if (!sukunaActive || !running || locallyPaused) return;
        playSound("knife");
        const attack = getSukunaRay(18, 8);
        const material = cachedMaterial("sukuna-cleave", "#ff294d", {
          emissive: "#c8193b", emissiveIntensity: 1.8, transparent: true,
          opacity: .9, side: THREE.DoubleSide
        });
        const slash = new THREE.Group();
        const blade = new THREE.Mesh(new THREE.PlaneGeometry(.92, .16), material);
        blade.rotation.z = -.55;
        const crossCut = new THREE.Mesh(new THREE.PlaneGeometry(.58, .1), material);
        crossCut.rotation.z = .55;
        slash.add(blade, crossCut);
        slash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), attack.direction);
        slash.position.copy(attack.origin);
        scene.add(slash);
        const distance = attack.origin.distanceTo(attack.end);
        sukunaProjectiles.push({
          type: "cleave",
          model: slash,
          origin: attack.origin,
          direction: attack.direction,
          distance,
          age: 0,
          duration: Math.max(.08, distance / 95)
        });
        if (damageSukunaTargets(attack.hits, 240)) {
          setCombatMessage("CLEAVE / DISMANTLE", 700);
        }
      }

      function launchSukunaFuga() {
        if (!sukunaActive || !running || locallyPaused) return;
        ensureAudio();
        const attack = getSukunaRay(18, 1);
        const targetDistance = attack.hits.length
          ? attack.origin.distanceTo(attack.hits[0].point)
          : Infinity;
        const wallDistance = attack.wallIntersection?.distance ?? Infinity;
        const distance = Math.max(.3, Math.min(18, targetDistance, wallDistance));
        const impact = attack.origin.clone().addScaledVector(attack.direction, distance);
        const material = cachedMaterial("sukuna-fuga-fire", "#ff542e", {
          emissive: "#ff2c18", emissiveIntensity: 2.2, roughness: .28
        });
        const arrow = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, .5, 7), material);
        shaft.rotation.x = Math.PI / 2;
        const point = new THREE.Mesh(new THREE.ConeGeometry(.065, .18, 8), material);
        point.rotation.x = Math.PI / 2;
        point.position.z = -.3;
        arrow.add(shaft, point);
        arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), attack.direction);
        arrow.position.copy(attack.origin);
        scene.add(arrow);
        sukunaProjectiles.push({
          type: "fuga",
          model: arrow,
          origin: attack.origin,
          direction: attack.direction,
          impact,
          distance,
          age: 0,
          duration: Math.max(.12, distance / 18)
        });
        playSound("flash");
        setCombatMessage("FUGA / FIRE ARROW", 900);
      }

      function detonateSukunaFuga(projectile) {
        const { impact } = projectile;
        vfxSystem.spawnExplosion(impact, "#ff462b");
        playSound("grenade", impact, { volume: 1.1, refDistance: 4, rolloffFactor: .9 });
        for (const enemy of [...enemies]) {
          const distance = Math.hypot(enemy.x - impact.x, enemy.y + impact.z);
          if (distance > 4.2) continue;
          const angle = Math.atan2(-impact.z - enemy.y, impact.x - enemy.x);
          if (castRayFrom(enemy.x, enemy.y, angle).distance < distance - .25) continue;
          enemy.health -= 900 * Math.max(.15, 1 - distance / 4.2);
          if (enemy.health <= 0) eliminateEnemy(enemy, { weaponIndex: 4 });
        }
        addImpactParticles(impact, "#ff603d");
      }

      function updateSukunaProjectiles(dt) {
        for (let index = sukunaProjectiles.length - 1; index >= 0; index--) {
          const projectile = sukunaProjectiles[index];
          projectile.age += dt;
          const travel = Math.min(projectile.distance, projectile.age / projectile.duration * projectile.distance);
          projectile.model.position.copy(projectile.origin).addScaledVector(projectile.direction, travel);
          if (projectile.age < projectile.duration) continue;
          scene.remove(projectile.model);
          projectile.model.traverse(object => object.geometry?.dispose());
          sukunaProjectiles.splice(index, 1);
          if (projectile.type === "fuga") detonateSukunaFuga(projectile);
        }
      }

      function expandSukunaDomain() {
        if (!sukunaActive || !running || locallyPaused) return;
        playSound("parry-break");
        const overlay = document.querySelector("#domain-overlay");
        overlay.hidden = false;
        overlay.classList.remove("active");
        void overlay.offsetWidth;
        overlay.classList.add("active");
        cancelScheduledTimeout(domainEffectTimeout);
        domainEffectTimeout = scheduleTimeout(() => {
          overlay.hidden = true;
          overlay.classList.remove("active");
        }, 1800);
        addBlastEffect(new THREE.Vector3(player.x, .45, -player.y));
        for (const enemy of [...enemies]) {
          enemy.health = 0;
          eliminateEnemy(enemy, { weaponIndex: 4 });
        }
        setCombatMessage("DOMAIN EXPANSION / MALEVOLENT SHRINE", 1800);
      }

      function spawnWave() {
        wave++;
        if (sukunaActive && wave > sukunaActivationWave) {
          sukunaWavesRemaining = Math.max(0, sukunaWavesRemaining - 1);
          if (sukunaWavesRemaining === 0) deactivateSukunaPower(true);
          else updateSukunaHud();
        }
        player.health = 100;
        document.querySelector("#health").textContent = "100";
        document.querySelector("#health-fill").style.width = "100%";
        document.querySelector("#health-fill").style.background = "#57c2c8";
        if (wave % 5 === 0 && !waveRewardsAwarded.has(wave)) {
          credits += 100;
          waveRewardsAwarded.add(wave);
          setCombatMessage("WAVE CLEAR / +100 CREDITS", 1700);
        }
        if (wave % 10 === 0 && !waveRewardsAwarded.has(-wave)) {
          credits += 300;
          waveRewardsAwarded.add(-wave);
          setCombatMessage("BOSS WAVE / +300 CREDITS", 1900);
        }
        saveProgression();
        const peerMatch = Boolean(networkConnection?.open);
        const count = peerMatch ? 0 : gameMode === "training" ? 6 :
          isWaveMode() ? Math.min(2 + Math.floor(wave * .8), gameMode === "infinite" ? 20 : 12) :
          gameMode === "duel" ? 1 : gameMode === "tdm" ? 4 : 5;
        const bruteIndex = gameMode === "duel" || gameMode === "training" || gameMode === "zombies" ||
          (isWaveMode() ? wave < 5 : Math.random() >= .2)
          ? -1
          : count - 1;
        if (gameMode === "training") {
          enemies.length = 0;
          const centerX = map[0].length / 2, centerY = map.length / 2;
          const candidates = map.flatMap((row, y) => [...row].map((cell, x) =>
            cell === "0" && canOccupyOnMap(map, x + .5, y + .5, .24)
              ? { x: x + .5, y: y + .5 } : null
          ).filter(Boolean)).sort((a, b) =>
            Math.hypot(b.x - centerX, b.y - centerY) - Math.hypot(a.x - centerX, a.y - centerY));
          candidates.slice(0, 6).forEach(position => enemies.push({
            id: `target-${nextEnemyId++}`, x: position.x, y: position.y, type: "target",
            health: 100, maxHealth: 100, trainingDummy: true, phase: 0, weaponIndex: 0
          }));
          document.querySelector("#wave").textContent = "TRAINING";
          document.querySelector("#objective").textContent = "Shoot targets / E collects drops / F inspects";
          return;
        }
        for (let i = 0; i < count; i++) {
          const spawn = getEnemySpawnPosition();
          const isBrute = i === bruteIndex;
          const weaponIndex = gameMode === "zombies" ? 4 : isBrute
            ? [1, 2][Math.floor(Math.random() * 2)]
            : [0, 0, 1, 2, 3][Math.floor(Math.random() * 5)];
          enemies.push({
            id: `enemy-${nextEnemyId++}`,
            x: spawn.x, y: spawn.y, type: isBrute ? "brute" : gameMode === "zombies" ? "zombie" : "soldier",
            health: isBrute ? 300 : gameMode === "zombies" ? 110 : 100,
            maxHealth: isBrute ? 300 : gameMode === "zombies" ? 110 : 100,
            movementMultiplier: isBrute ? .68 : gameMode === "zombies" ? 1.2 : 1, attack: Math.random() * 1.5,
            strafe: Math.random() < .5 ? 1 : -1, phase: Math.random() * Math.PI * 2,
            footstepTimer: Math.random() * .25, sprinting: false,
            team: gameMode === "tdm" ? (i < 2 ? 0 : 1) : 1,
            weaponIndex, state: "seek", stateTimer: 1 + Math.random() * 2, cover: null,
            blindTimer: 0
          });
        }
        boss = null;
        if (!peerMatch && isWaveMode() && wave % 10 === 0) {
          const spawn = getEnemySpawnPosition();
          const maxHealth = 1200 * (wave / 10);
          boss = {
            id: `boss-${wave}`, x: spawn.x, y: spawn.y, type: "boss",
            health: maxHealth, maxHealth, movementMultiplier: 1.08 + wave / 100,
            attack: .8, strafe: Math.random() < .5 ? 1 : -1,
            phase: 0, footstepTimer: 0, weaponIndex: 0, state: "seek",
            stateTimer: 0, cover: null, blindTimer: 0
          };
          enemies.push(boss);
          document.querySelector("#boss-name").textContent = `WAVE ${wave} COMMANDER`;
          document.querySelector("#boss-health").hidden = false;
          bossBarFill.style.width = "100%";
        } else {
          document.querySelector("#boss-health").hidden = true;
        }
        if (wave === 5 && !waveFiveDropSpawned) {
          waveFiveDropSpawned = true;
          spawnWaveFiveDrops();
        }
        document.querySelector("#wave").textContent = isWaveMode()
          ? `WAVE ${String(wave).padStart(2, "0")}`
          : `MATCH ${String(wave).padStart(2, "0")}`;
        const modeTitle = { waves: "hostiles in the area", coop: "hostiles in the area", infinite: "hostiles in the area", zombies: "undead in the area", duel: "training opponent", ffa: "training opponents", tdm: "training opponents" }[gameMode];
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
          const outside = mapY < 0 || mapX < 0 || mapY >= map.length || mapX >= map[0].length;
          const obstacleBox = !outside && (mapDefinitions[activeMapId].collisionBoxes || []).some(box =>
            mapX < box.maxX && mapX + 1 > box.minX &&
            mapY < box.maxY && mapY + 1 > box.minY
          );
          if (outside || map[mapY][mapX] === "1" || obstacleBox) {
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

      function updateReplayGhosts(sample, dt) {
        enemyModels.forEach(model => { model.visible = !sample; });
        const replayEnemies = sample?.enemies.filter(enemy =>
          enemy.id !== (replayPerspective === "remote" ? "opponent" : "local-player")
        ) || [];
        for (const [id, ghost] of replayGhosts) {
          if (replayEnemies.some(enemy => enemy.id === id)) continue;
          scene.remove(ghost);
          ghost.traverse(object => {
            if (!object.userData.replayBaseMaterial) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => material?.dispose());
          });
          replayGhosts.delete(id);
        }
        if (!sample) return;
        for (const enemy of replayEnemies) {
          let ghost = replayGhosts.get(enemy.id);
          if (!ghost) {
            const actor = {
              type: "soldier", weaponIndex: enemy.weapon || 0, health: 100,
              phase: 0, stunned: 0, animationState: enemy.animationState || "idle"
            };
            ghost = createEnemyModel(actor);
            enemyModels.delete(actor);
            ghost.userData.replayActor = actor;
            ghost.traverse(object => {
              if (!object.isMesh || object.userData.isHitbox) return;
              object.userData.replayBaseMaterial = object.material;
              const tint = () => new THREE.MeshBasicMaterial({
                  color: "#b9d690", transparent: true, opacity: .48,
                  depthWrite: false, side: THREE.DoubleSide
                });
              object.material = Array.isArray(object.material)
                ? object.material.map(tint)
                : tint(object.material);
            });
            replayGhosts.set(enemy.id, ghost);
          }
          const actor = ghost.userData.replayActor;
          actor.weaponIndex = Math.max(0, Math.min(weapons.length - 1, Math.trunc(enemy.weapon || 0)));
          actor.animationState = enemy.animationState || "idle";
          ghost.position.set(enemy.x, enemy.position?.y || 0, -enemy.y);
          ghost.rotation.set(
            enemy.rotation?.x || 0,
            Number.isFinite(enemy.rotation?.y) ? enemy.rotation.y : (enemy.angle || 0) - Math.PI / 2,
            enemy.rotation?.z || 0
          );
          if (ghost.userData.rigged) {
            ghost.userData.mixer.update(dt);
            setRigAnimation(ghost, actor.animationState);
            updateRiggedWeapon(ghost, actor);
          } else {
            ghost.userData.weapons.children.forEach((weapon, index) => {
              weapon.visible = index === actor.weaponIndex;
            });
          }
        }
      }

      function updateReplayPlayer(sample, dt) {
        if (!sample) {
          if (replayPlayerModel) replayPlayerModel.visible = false;
          return;
        }
        if (!replayPlayerModel) {
          replayPlayerActor = { type: "soldier", weaponIndex: 0, health: 100, phase: 0, stunned: 0 };
          replayPlayerModel = createEnemyModel(replayPlayerActor);
          enemyModels.delete(replayPlayerActor);
          const label = createNameplate(operatorName || "Operator");
          replayPlayerModel.add(label);
          replayPlayerModel.userData.nameplate = label;
          replayPlayerModel.userData.lastPosition = null;
          replayPlayerModel.traverse(object => {
            if (!object.isMesh || object.userData.isHitbox || !/torso|arm|leg/i.test(object.name)) return;
            object.userData.replayBaseMaterial = object.material;
            object.material = Array.isArray(object.material)
              ? object.material.map(material => material.clone())
              : object.material.clone();
          });
        }
        const subject = sample.player;
        replayPlayerActor.weaponIndex = Math.max(0, Math.min(weapons.length - 1, Math.trunc(subject.weapon || 0)));
        replayPlayerActor.animationState = subject.animationState || "idle";
        replayPlayerActor.health = 100;
        const model = replayPlayerModel;
        const previous = model.userData.lastPosition;
        const distance = previous ? Math.hypot(subject.x - previous.x, subject.y - previous.y) : 0;
        replayPlayerActor.phase += distance * 10;
        model.position.set(subject.x, subject.position?.y || 0, -subject.y);
        model.rotation.set(
          subject.rotation?.x || 0,
          Number.isFinite(subject.rotation?.y) ? subject.rotation.y : subject.angle - Math.PI / 2,
          subject.rotation?.z || 0
        );
        model.userData.lastPosition = { x: subject.x, y: subject.y };
        if (model.userData.rigged) {
          model.userData.mixer.update(dt);
          setRigAnimation(model, replayPlayerActor.animationState);
          updateRiggedWeapon(model, replayPlayerActor);
        } else {
          const gait = Math.sin(replayPlayerActor.phase) * Math.min(.55, distance * 18);
          model.userData.leftLeg.rotation.x = gait;
          model.userData.rightLeg.rotation.x = -gait;
          model.userData.leftKnee.rotation.x = Math.max(0, -gait) * .8;
          model.userData.rightKnee.rotation.x = Math.max(0, gait) * .8;
          model.userData.leftArm.rotation.x = -gait * .55;
          model.userData.rightArm.rotation.x = gait * .55;
          model.userData.leftElbow.rotation.x = -.3 + Math.max(0, gait) * .35;
          model.userData.rightElbow.rotation.x = -.3 - Math.max(0, gait) * .35;
          model.userData.weapons.children.forEach((weapon, index) => {
            weapon.visible = index === replayPlayerActor.weaponIndex;
          });
        }
        const skinColor = cosmeticColor(equippedSkin);
        model.traverse(object => {
          if (!object.userData.replayBaseMaterial) return;
          const baseMaterials = Array.isArray(object.userData.replayBaseMaterial)
            ? object.userData.replayBaseMaterial : [object.userData.replayBaseMaterial];
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material, index) => {
            material.color.copy(baseMaterials[index].color);
            if (skinColor) material.color.set(skinColor);
          });
        });
        model.visible = false;
      }

      function render(playbackSample = null, deltaTime = 0) {
        updateEnemyModels(deltaTime);
        updateRemoteModel();
        updateReplayGhosts(playbackSample, deltaTime);
        updateReplayPlayer(playbackSample, deltaTime);
        const eyePosition = new THREE.Vector3(
          player.x,
          1.65 + getMapElevation(player.x, player.y) + rooftopFallHeight +
            jumpHeight - (dashTimer > 0 ? .22 : 0),
          -player.y
        );
        const viewDirection = new THREE.Vector3(
          Math.cos(player.angle) * Math.cos(playerPitch),
          Math.sin(playerPitch),
          -Math.sin(player.angle) * Math.cos(playerPitch)
        ).normalize();
        if (playbackSample) {
          const subject = playbackSample.player;
          if (subject.cameraPosition && subject.cameraDirection) {
            camera.position.set(
              subject.cameraPosition.x,
              subject.cameraPosition.y,
              subject.cameraPosition.z
            );
            camera.lookAt(camera.position.clone().add(new THREE.Vector3(
              subject.cameraDirection.x,
              subject.cameraDirection.y,
              subject.cameraDirection.z
            )));
          } else {
            camera.position.set(subject.x, 1.65, -subject.y);
            camera.rotation.set(subject.pitch || 0, subject.angle - Math.PI / 2, 0);
          }
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
        if (!playbackSample && cameraKickback > .0005) {
          camera.position.addScaledVector(viewDirection, -cameraKickback);
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
        camera.fov = playbackSample
          ? playbackSample.player.fov || controlSettings.fieldOfView
          : aiming
          ? hasScope() ? 22 : Math.max(60, controlSettings.fieldOfView - 12)
            : controlSettings.fieldOfView;
        camera.updateProjectionMatrix();
        const aimWallDistance = castRay(player.angle).distance;
        aimRaycaster.set(camera.position, viewDirection);
        aimRaycaster.near = 0;
        aimRaycaster.far = Math.min(currentWeapon().range || 18, aimWallDistance - .04);
        const aimTargets = Array.from(enemyModels, ([enemy, model]) => enemy.health > 0 ? model : null).filter(Boolean);
        const hasAimTarget = aimRaycaster.far > 0 && aimRaycaster.intersectObjects(aimTargets, true).length > 0;
        document.querySelector("#crosshair").classList.toggle("targeting", hasAimTarget && !hasScope());
        document.querySelector("#scope-overlay").classList.toggle("targeting", hasAimTarget && hasScope());
        if (weaponAnchor) {
          weaponAnchor.visible = !playbackSample && !sukunaActive;
          const moving = movementInput().forward !== 0 || movementInput().strafe !== 0;
          const sprinting = moving && isSprinting() && stamina > 0 && !sprintExhausted;
          const weapon = currentWeapon();
          const reloadProgress = reloadKind === "reload" && reloadTimer > 0
            ? THREE.MathUtils.clamp(1 - reloadTimer / reloadDuration, 0, 1)
            : 0;
          const reloadEnvelope = Math.sin(reloadProgress * Math.PI);
          const aimOffset = aiming && !hasScope();
          const inspectProgress = inspectTimer > 0
            ? Math.max(0, Math.min(1, (inspectDuration - inspectTimer) / inspectDuration))
            : 0;
          const inspectEnvelope = Math.sin(inspectProgress * Math.PI);
          const inspectStyle = currentWeapon().inspect;
          const inspectScale = currentWeapon().melee ? 1 + inspectEnvelope * .04 : 1;
          const viewportHeight = canvas.clientHeight || window.innerHeight;
          const viewportAspect = (canvas.clientWidth || window.innerWidth) / viewportHeight;
          const aspectScale = THREE.MathUtils.clamp(viewportAspect / (16 / 9), .78, 1);
          const viewModelScale = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
            Math.tan(THREE.MathUtils.degToRad(referenceViewModelFov / 2));
          const weaponBaseY = weapon.melee ? -.12 : -.3;
          const weaponBaseZ = weapon.melee ? -.55 : -.48;
          const targetWeaponPosition = new THREE.Vector3(
            aimOffset ? .015 : .32 * aspectScale,
            (aimOffset ? -.17 : weaponBaseY) + Math.sin(movementBob) * (sprinting ? .012 : .006) -
            weaponRecoil * .0008 - (dashTimer > 0 ? .06 : 0) - reloadEnvelope * .14,
            weaponBaseZ);
          targetWeaponPosition.add(new THREE.Vector3(...inspectStyle.position).multiplyScalar(inspectEnvelope));
          targetWeaponPosition.z += aimOffset ? .12 : 0;
          targetWeaponPosition.z += Math.min(.13, weaponRecoil * (player.weaponIndex === 2 ? .008 : .006));
          targetWeaponPosition.x += Math.sin(performance.now() * .0018) * (moving ? .008 : .003) -
            weaponLagX * .00045;
          targetWeaponPosition.x *= viewModelScale;
          targetWeaponPosition.y *= viewModelScale;
          targetWeaponPosition.y -= Math.min(.12, jumpHeight * .11);
          weaponAnchor.position.lerp(targetWeaponPosition, .22);
          const knifeProgress = weapon.melee && knifeSwing > 0
            ? THREE.MathUtils.clamp(1 - knifeSwing / weapon.interval, 0, 1)
            : 0;
          const meleeArc = weapon.melee && knifeSwing > 0
            ? Math.sin(knifeProgress * Math.PI)
            : 0;
          const slashDirection = knifeAttackStyle === "slash" ? -1 : 1;
          const stab = knifeAttackStyle === "stab" && knifeSwing > 0 ? meleeArc : 0;
          const inspectRotation = inspectStyle.rotation;
          const inspectSpin = weapon.melee ? inspectProgress * Math.PI * 4 : 0;
          weaponAnchor.rotation.x = (dashTimer > 0 ? -.16 : 0) + weaponRecoil * .004 -
            (weapon.melee ? stab * .9 : reloadEnvelope * .24) + inspectRotation[0] * inspectEnvelope;
          weaponAnchor.rotation.y = weapon.melee
            ? .9 + inspectRotation[1] * inspectEnvelope + inspectSpin
            : inspectRotation[1] * inspectEnvelope + Math.PI * inspectEnvelope;
          weaponAnchor.rotation.z = (dashTimer > 0 ? -.08 : weapon.melee ? meleeArc * .55 * slashDirection : 0) +
            inspectRotation[2] * inspectEnvelope + reloadEnvelope * .48;
          if (aiming && !hasScope()) alignWeaponSight();
          if (playerRigModel?.userData.firstPerson) {
            playerRigModel.visible = !sukunaActive && !(aiming && hasScope());
            const inspectingKnife = weapon.melee && inspectEnvelope > .05;
            firstPersonHandPose?.index.forEach(({ bone, rotation }) => {
              bone.rotation.copy(rotation);
              if (inspectingKnife) {
                bone.rotation.x -= .28 * inspectEnvelope;
                bone.rotation.z -= .34 * inspectEnvelope;
              }
            });
          }
          muzzleLight.intensity = muzzleFlash > 0 ? 3.5 : 0;
          weaponModels.forEach((model, index) => {
            model.visible = !sukunaActive && index === player.weaponIndex && !(aiming && hasScope());
            const firearmScale = (weapon.melee ? 1 : .98) * viewModelScale;
            model.scale.setScalar(index === player.weaponIndex ? firearmScale * inspectScale : 1);
            let magazine = null;
            model.traverse(object => {
              if (!magazine && /magazine|ammo[_ -]?clip/i.test(object.name)) magazine = object;
            });
            if (magazine) {
              magazine.userData.reloadRestPosition ||= magazine.position.clone();
              magazine.position.copy(magazine.userData.reloadRestPosition);
              magazine.position.y -= reloadEnvelope * .18;
              magazine.rotation.x = -reloadEnvelope * .55;
            }
            const recoilProgress = index === player.weaponIndex
              ? Math.min(1, weaponRecoil / 20)
              : 0;
            model.traverse(object => {
              if (!object.userData.weaponMotion) return;
              const travel = object.userData.weaponMotion === "pump" ? .14 : .075;
              object.position.z = object.userData.weaponRestZ +
                recoilProgress * travel;
            });
          });
        }
        renderer.render(scene, camera);
      }

      function reload() {
        const weapon = currentWeapon();
        if (!running || locallyPaused || sukunaActive || inspectTimer > 0 ||
          weapon.melee || reloadTimer > 0 || weapon.ammo === weapon.magazine || weapon.reserve <= 0) return;
        reloadTimer = weapon.reloadTime;
        reloadDuration = weapon.reloadTime;
        reloadKind = "reload";
        playSound("reload");
        document.querySelector("#objective").textContent = `Reloading ${weapon.short.toLowerCase()}...`;
      }

      function shoot() {
        if (!running || locallyPaused || inspectTimer > 0 || fireCooldown > 0 || reloadTimer > 0) return;
        if (sukunaActive) {
          sukunaM1();
          return;
        }
        const weapon = currentWeapon();
        if (!weapon.melee && gameMode !== "infinite" && weapon.ammo <= 0) { reload(); return; }
        ensureAudio();
        const muzzlePosition = getMuzzleWorldPosition();
        const recoilScale = (aiming ? .3 : 1) * (weapon.attachments.suppressor ? .7 : 1);
        if (!weapon.melee) {
          if (gameMode !== "infinite") weapon.ammo--;
          muzzleFlash = hasScope(weapon) ? .18 : .1;
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
          knifeAttackStyle = knifeComboStep === 1 ? "slash" : "stab";
          knifeComboStep = (knifeComboStep + 1) % 3;
          knifeSwing = weapon.interval;
          playSound("knife");
        }
        fireCooldown = weapon.interval;
        const recoilStrength = weapon.recoil || 7;
        const pitchKick = recoilStrength * Math.PI / 180 * .16 * recoilScale;
        const yawKick = (Math.random() - .5) * recoilStrength * Math.PI / 180 * .09 * recoilScale;
        recoilPitch = Math.min(.18, recoilPitch + pitchKick);
        recoilYaw = Math.max(-.12, Math.min(.12, recoilYaw + yawKick));
        playerPitch = Math.max(-1.35, Math.min(1.35, playerPitch + pitchKick));
        player.angle += yawKick;
        cameraKickback = Math.min(.28, cameraKickback + recoilStrength * .004 * recoilScale);
        if (weapon.chamberTime) {
          reloadTimer = weapon.chamberTime;
          reloadDuration = weapon.chamberTime;
          reloadKind = "chamber";
        }
        sendPeerMessage({ type: "shot", weapon: player.weaponIndex, angle: player.angle, pitch: playerPitch });
        const pelletCount = weapon.melee ? 1 : weapon.pellets || 1;
        const hits = new Map();
        for (let pellet = 0; pellet < pelletCount; pellet++) {
          const spread = weapon.melee ? 0
            : player.weaponIndex === 1 ? (aiming ? .008 : .065)
              : player.weaponIndex === 2
                ? weapon.spread * (aiming ? 1.35 : 2.6) * (weapon.attachments.foregrip ? .78 : 1)
                : weapon.spread * (aiming ? .45 : 1) * (weapon.attachments.foregrip ? .78 : 1);
          const shotAngle = player.angle + (Math.random() - .5) * spread;
          const maxDistance = weapon.melee ? 1.8 : weapon.range || 18;
          const targets = enemies
            .filter(enemy => enemy.health > 0 && (gameMode !== "tdm" || enemy.team === 1))
            .map(enemy => enemyModels.get(enemy) || createEnemyModel(enemy));
          const shotDirection = getPlayerMuzzleWorldDirection()
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), shotAngle - player.angle)
            .normalize();
          raycaster.set(
            muzzlePosition,
            shotDirection
          );
          raycaster.near = 0;
          raycaster.far = maxDistance;
          const wallIntersections = [];
          if (mapWalls) wallIntersections.push(...raycaster.intersectObject(mapWalls, false));
          if (mapObstacleMeshes.length) {
            wallIntersections.push(...raycaster.intersectObjects(mapObstacleMeshes, false));
          }
          const wallIntersection = wallIntersections.sort((a, b) => a.distance - b.distance)[0] || null;
          const rayHits = collectPenetratingHits(
            raycaster.intersectObjects(targets, true),
            wallIntersection?.distance,
            Boolean(weapon.piercing),
            5
          );
          const tracerEnd = rayHits.length
            ? rayHits[rayHits.length - 1].point
            : wallIntersection
              ? wallIntersection.point
              : raycaster.ray.at(maxDistance, new THREE.Vector3());
          if (!weapon.melee) vfxSystem.spawnBullet(muzzlePosition, tracerEnd, { color: rayHits.length ? "#f5e8b0" : "#dfb96e" });
          for (const target of rayHits) {
            if (weapon.melee) {
              const slashNormal = target.normal || new THREE.Vector3(
                -Math.cos(shotAngle), 0, Math.sin(shotAngle)
              );
              vfxSystem.spawnSlash(target.point, slashNormal);
            } else {
              addImpactParticles(target.point, target.hitZone === "head" ? "#bcab7e" : "#f5d992");
            }
          }
          if (!rayHits.length && wallIntersection && wallIntersection.distance <= maxDistance) {
            const wallHit = castRay(shotAngle);
            const normal = wallHit.side === 0
              ? new THREE.Vector3(wallHit.rayX > 0 ? -1 : 1, 0, 0)
              : new THREE.Vector3(0, 0, wallHit.rayY > 0 ? 1 : -1);
            const wallNormal = wallIntersection.face?.normal?.clone()
              .transformDirection(wallIntersection.object.matrixWorld) || normal;
            if (weapon.melee) vfxSystem.spawnSlash(wallIntersection.point, wallNormal);
            else vfxSystem.spawnImpact(wallIntersection.point, wallNormal, "#3b382e");
          }
          for (const target of rayHits) {
            const previous = hits.get(target.enemy);
            hits.set(target.enemy, {
              ...target,
              pellets: (previous?.pellets || 0) + 1,
              penetrationDamage: (previous?.penetrationDamage || 0) + target.penetrationScale,
              hitZone: target.hitZone === "head" ? "head" : previous?.hitZone || target.hitZone
            });
          }
        }
        if (hits.size) {
          playSound("hit");
          showHitMarker();
          for (const { enemy, distance, pellets: hitPellets, penetrationDamage, hitZone } of hits.values()) {
            const rangeScale = player.weaponIndex === 2 ? .35 + .65 * Math.max(0, 1 - distance / 10) : 1;
            const behindBot = (enemy.facingX || 0) * (player.x - enemy.x) +
              (enemy.facingY || 0) * (player.y - enemy.y) < -distance * .35;
            const backstab = weapon.melee && behindBot;
            const damageScale = weapon.melee
              ? hitZone === "head" || backstab ? enemy.health / weapon.damage : 1
              : hitZone === "head" ? 3 : hitZone === "limb" ? .5 : 1;
            enemy.health -= weapon.damage * damageScale *
              ((weapon.piercing ? penetrationDamage : hitPellets) / pelletCount) * rangeScale;
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
              backstab,
              noScope
            });
            setCombatMessage("TARGET ELIMINATED", 650);
            if (gameMode === "tdm" ? !enemies.some(enemy => enemy.team === 1) :
              !isWaveMode() && gameMode !== "training" && enemies.length === 0) endGame();
          }
        }
      }

      function startDash() {
        const { forward, strafe } = movementInput();
        const length = Math.hypot(forward, strafe);
        if (!running || locallyPaused || inspectTimer > 0 || aiming || dashTimer > 0 || dashCooldown > 0 || length === 0) return;
        dashDirectionX = (Math.cos(player.angle) * forward + Math.cos(player.angle - Math.PI / 2) * strafe) / length;
        dashDirectionY = (Math.sin(player.angle) * forward + Math.sin(player.angle - Math.PI / 2) * strafe) / length;
        dashTimer = dashDuration;
        dashCooldown = .9;
        setCombatMessage("DASH", 500);
      }

      function update(dt) {
        updateTransientEffects(dt);
        updateSukunaProjectiles(dt);
        player.spawnInvulnerability = Math.max(0, player.spawnInvulnerability - dt);
        document.querySelector("#spawn-shield-overlay").classList.toggle("active", player.spawnInvulnerability > 0);
        const wasInspecting = inspectTimer > 0;
        inspectTimer = Math.max(0, inspectTimer - dt);
        if (wasInspecting && inspectTimer === 0) updateInspectControl();
        cameraKickback *= Math.exp(-dt * 11);
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
        knifeSwing = Math.max(0, knifeSwing - dt);
        weaponRecoil = Math.max(0, weaponRecoil - dt * 40);
        weaponLagX *= Math.max(0, 1 - dt * (5 / currentWeapon().movementSpeed));
        dashTimer = Math.max(0, dashTimer - dt);
        dashCooldown = Math.max(0, dashCooldown - dt);
        hurtFlash = Math.max(0, hurtFlash - dt * 1.4);
        grenadeFlash = Math.max(0, grenadeFlash - dt * 2.8);
        grenadeCooldown = Math.max(0, grenadeCooldown - dt);
        flashbangCooldown = Math.max(0, flashbangCooldown - dt);
        parryPulse = Math.max(0, parryPulse - dt);
        if (parryCooldown > 0) {
          parryCooldown = Math.max(0, parryCooldown - dt);
          if (parryCooldown === 0) {
            parryCharges = 5;
            setCombatMessage("PARRY SHIELD RECHARGED", 1000);
          }
        }
        updateParryHud();
        grenadeAnimation = Math.max(0, grenadeAnimation - dt * 1.4);
        flashbangAnimation = Math.max(0, flashbangAnimation - dt * 1.4);
        for (let index = explosions.length - 1; index >= 0; index--) {
          const explosion = explosions[index];
          explosion.age += dt;
          if (explosion.age >= explosion.duration) explosions.splice(index, 1);
        }
        if (inspectTimer <= 0 && firing && currentWeapon().auto) shoot();
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
        if (jumpHeight > 0 || jumpVelocity > 0) {
          jumpVelocity -= 12 * dt;
          jumpHeight = Math.max(0, jumpHeight + jumpVelocity * dt);
          if (jumpHeight === 0) {
            jumpVelocity = 0;
            if (keys.has("Space") && (forward !== 0 || strafe !== 0)) {
              bunnyHopMultiplier = Math.min(1.3, bunnyHopMultiplier + .08);
              jumpVelocity = 5.2;
            } else {
              bunnyHopMultiplier = 1;
            }
          }
        }
        if (sprintExhausted && stamina >= 25) sprintExhausted = false;
        const wantsSprint = !sprintExhausted && !aiming && dashTimer === 0 &&
          isSprinting() && (forward !== 0 || strafe !== 0);
        if (wantsSprint) {
          stamina = Math.max(0, stamina - 32 * dt);
          if (stamina === 0) sprintExhausted = true;
        } else {
          stamina = Math.min(100, stamina + (moving ? 14 : 22) * dt);
        }
        const sprinting = wantsSprint && !sprintExhausted;
        staminaFill.style.width = `${stamina}%`;
        staminaFill.style.background = stamina < 25 ? "#dd6d58" : "#79d8d0";
        staminaValue.textContent = String(Math.ceil(stamina));
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
          const speed = (aiming ? 2 : sprinting ? 4.2 : 3.2) *
            currentWeapon().movementSpeed * (jumpHeight > 0 ? bunnyHopMultiplier : 1) * dt;
          movePlayer((Math.cos(player.angle) * forward + Math.cos(player.angle - Math.PI / 2) * strafe) / length * speed,
            (Math.sin(player.angle) * forward + Math.sin(player.angle - Math.PI / 2) * strafe) / length * speed);
        }
        const correction = networkManager.consumeCorrection(dt);
        if (correction.x || correction.y) movePlayer(correction.x, correction.y);

        if (activeMapId === "rooftop") {
          const dimensions = mapDefinitions.rooftop.dimensions;
          if (!rooftopFalling && (player.x < 0 || player.y < 0 ||
            player.x > dimensions.width || player.y > dimensions.depth)) {
            rooftopFalling = true;
            rooftopFallVelocity = 0;
          }
          if (rooftopFalling) {
            rooftopFallVelocity -= 18 * dt;
            rooftopFallHeight += rooftopFallVelocity * dt;
            if (1.65 + rooftopFallHeight < -10) {
              player.health = 0;
              document.querySelector("#health").textContent = "0";
              document.querySelector("#health-fill").style.width = "0%";
              playSound("death");
              endGame();
              return;
            }
          }
        } else {
          rooftopFalling = false;
          rooftopFallVelocity = 0;
          rooftopFallHeight = 0;
        }
        const environmentalDamage = activeMapId === "iron_foundry"
          ? getEnvironmentalDamage(player.x, player.y) * dt : 0;
        if (environmentalDamage > 0 && gameMode !== "infinite") {
          player.applyDamage(environmentalDamage);
          document.querySelector("#health").textContent = String(Math.ceil(player.health));
          const healthFill = document.querySelector("#health-fill");
          healthFill.style.width = `${player.health}%`;
          healthFill.style.background = player.health < 35 ? "#dd6d58" : "#57c2c8";
          if (player.health === 0) {
            playSound("death");
            endGame();
            return;
          }
        }

        for (const enemy of enemies) {
          const weapon = weapons[enemy.weaponIndex] || weapons[0];
          enemy.stunned = Math.max(0, (enemy.stunned || 0) - dt);
          enemy.blindTimer = Math.max(0, (enemy.blindTimer || 0) - dt);
          enemy.footstepTimer = Math.max(0, enemy.footstepTimer - dt);
          enemy.uavRevealTimer = Math.max(0, (enemy.uavRevealTimer || 0) - dt);
          if (activeMapId === "rooftop") {
            const dimensions = mapDefinitions.rooftop.dimensions;
            if (!enemy.falling && (enemy.x < 0 || enemy.y < 0 ||
              enemy.x > dimensions.width || enemy.y > dimensions.depth)) {
              enemy.falling = true;
              enemy.fallVelocity = 0;
              enemy.fallHeight = 0;
            }
            if (enemy.falling) {
              enemy.fallVelocity -= 18 * dt;
              enemy.fallHeight += enemy.fallVelocity * dt;
              if (enemy.fallHeight < -10) {
                eliminateEnemy(enemy);
                continue;
              }
            }
          }
          const hazardDamage = activeMapId === "iron_foundry"
            ? getEnvironmentalDamage(enemy.x, enemy.y) * dt : 0;
          if (hazardDamage > 0) {
            enemy.health -= hazardDamage;
            if (enemy.health <= 0) {
              eliminateEnemy(enemy);
              continue;
            }
          }
          if (enemy.trainingDummy || enemy.stunned > 0) continue;
          let action = botAI.update(enemy, player, dt, map, weapon);
          if (enemy.blindTimer > 0) {
            enemy.faceAngle += (Math.random() - .5) * dt * 5;
            enemy.facingX = Math.cos(enemy.faceAngle);
            enemy.facingY = Math.sin(enemy.faceAngle);
            action = { ...action, state: "blind-fire", moveX: 0, moveY: 0, fire: action.fire || Math.random() < dt * 1.8 };
          }
          const distance = action.distance;
          enemy.sprinting = action.sprinting;
          enemy.aiming = action.state === "attack" || action.fire;
          enemy.animationState = action.fire ? "shoot"
            : action.moveX || action.moveY ? enemy.sprinting ? "run" : "walk" : "idle";
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
          if (enemy.blindTimer > 0) {
            if (enemy.weaponIndex === 4 || Math.random() >= .35) continue;
            const wildAngle = enemy.faceAngle + (Math.random() - .5) * Math.PI * 2;
            const wildDistance = Math.min(weapon.range || 12, castRayFrom(enemy.x, enemy.y, wildAngle).distance);
            const muzzleTransform = getEnemyMuzzleWorldTransform(enemy);
            const muzzle = muzzleTransform.position;
            const wildDirection = muzzleTransform.direction
              .clone()
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), wildAngle - enemy.faceAngle);
            const miss = muzzle.clone().addScaledVector(wildDirection, wildDistance);
            playSound(enemy.weaponIndex === 1 ? "sniper" : "rifle", muzzle, { volume: .28, refDistance: 2.5 });
            vfxSystem.spawnBullet(muzzle, miss, { color: "#ff9b72", speed: 80 });
            addTracer(muzzle, miss, "#ff9b72");
            continue;
          }
          if (!closeAttack && (enemy.weaponIndex === 4 || Math.random() >= .58)) continue;
          const damage = closeAttack
            ? enemy.type === "zombie" ? 11 : enemy.type === "boss" ? 22 : 6
            : Math.max(3, weapon.damage * (enemy.weaponIndex === 1 ? .075 : .045));
          if (player.spawnInvulnerability > 0) continue;
          if (!closeAttack && gameMode !== "infinite" && parryIncomingBullet()) continue;
          if (gameMode !== "infinite") player.applyDamage(Math.round(damage));
          hurtFlash = .8;
          damageMessageTimer = .3;
          const muzzleTransform = getEnemyMuzzleWorldTransform(enemy);
          const muzzle = muzzleTransform.position;
          const playerChest = new THREE.Vector3(player.x, 1.25, -player.y);
          playSound(closeAttack ? "damage" : enemy.weaponIndex === 1 ? "sniper" : "rifle",
            muzzle, { volume: .45, refDistance: 3 });
          if (!closeAttack) {
            const targetDistance = muzzle.distanceTo(playerChest);
            const projectileEnd = muzzle.clone()
              .addScaledVector(muzzleTransform.direction, targetDistance);
            vfxSystem.spawnBullet(muzzle, projectileEnd, { color: "#ff9b72", speed: 80 });
            addTracer(muzzle, projectileEnd, "#ff9b72");
          }
          document.querySelector("#damage-overlay").classList.add("visible");
          scheduleTimeout(() => document.querySelector("#damage-overlay").classList.remove("visible"), 300);
          document.querySelector("#health").textContent = player.health;
          const fill = document.querySelector("#health-fill");
          fill.style.width = `${player.health}%`;
          fill.style.background = player.health < 35 ? "#dd6d58" : "#57c2c8";
          if (player.health === 0) {
            playSound("death");
            endGame();
            break;
          }
        }
        if (gameMode === "infinite") {
          player.health = 100;
          weapons.forEach(weapon => { if (!weapon.melee) weapon.ammo = weapon.magazine; });
        }
        updatePickups(dt);
        updateFlashEffect(dt);
        if (boss) bossBarFill.style.width = `${Math.max(0, boss.health / boss.maxHealth * 100)}%`;
        if (enemies.length === 0 && running && isWaveMode() && !networkConnection?.open) {
          document.querySelector("#objective").textContent = "Sector clear - next wave inbound";
          spawnWave();
        }
        playerAnimationState = jumpHeight > 0 ? "jump"
          : reloadKind === "reload" ? "reload"
          : firing && fireCooldown > 0 ? "shoot"
            : moving ? sprinting ? "run" : "walk" : "idle";
        const replayEnemies = enemies.map(enemy => ({
          id: enemy.id,
          x: enemy.x,
          y: enemy.y,
          angle: enemy.faceAngle || 0,
          position: { x: enemy.x, y: (enemy.fallHeight || 0) + getMapElevation(enemy.x, enemy.y), z: -enemy.y },
          rotation: { x: 0, y: (enemy.faceAngle || 0) - Math.PI / 2, z: 0 },
          weapon: enemy.weaponIndex || 0,
          weaponId: weapons[enemy.weaponIndex || 0]?.short.toLowerCase() || "rifle",
          animationState: enemy.animationState || "idle"
        }));
        if (remotePlayer && networkConnection?.open) {
          replayEnemies.push({
            id: "opponent",
            x: remotePlayer.x,
            y: remotePlayer.y,
            angle: remotePlayer.angle || 0,
            position: { x: remotePlayer.x, y: remotePlayer.position?.y || 0, z: -remotePlayer.y },
            rotation: { x: remotePlayer.pitch || 0, y: (remotePlayer.angle || 0) - Math.PI / 2, z: 0 },
            weapon: remotePlayer.weapon || 0,
            weaponId: weapons[remotePlayer.weapon || 0]?.short.toLowerCase() || "rifle",
            animationState: remotePlayer.animationState || (remotePlayer.firing ? "shoot" : "idle")
          });
        }
        const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
        const localReplayActor = {
          x: player.x,
          y: player.y,
          angle: player.angle,
          pitch: playerPitch,
          weapon: player.weaponIndex,
          weaponId: weapons[player.weaponIndex]?.short.toLowerCase() || "rifle",
          animationState: playerAnimationState,
          position: {
            x: player.x, y: rooftopFallHeight + getMapElevation(player.x, player.y), z: -player.y
          },
          rotation: { x: playerPitch, y: player.angle - Math.PI / 2, z: 0 },
          cameraPosition: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          cameraDirection: { x: cameraDirection.x, y: cameraDirection.y, z: cameraDirection.z },
          fov: camera.fov
        };
        const opponentReplayActor = remotePlayer && networkConnection?.open
          ? {
              x: remotePlayer.x,
              y: remotePlayer.y,
              angle: remotePlayer.angle || 0,
              pitch: remotePlayer.pitch || 0,
              weapon: remotePlayer.weapon || 0,
              weaponId: weapons[remotePlayer.weapon || 0]?.short.toLowerCase() || "rifle",
              animationState: remotePlayer.animationState || (remotePlayer.firing ? "shoot" : "idle"),
              position: {
                x: remotePlayer.x, y: remotePlayer.position?.y || 0, z: -remotePlayer.y
              },
              rotation: {
                x: remotePlayer.pitch || 0, y: (remotePlayer.angle || 0) - Math.PI / 2, z: 0
              },
              cameraPosition: remotePlayer.cameraPosition || {
                x: remotePlayer.x,
                y: remotePlayer.position?.y || 1.65,
                z: -remotePlayer.y
              },
              cameraDirection: remotePlayer.cameraDirection || {
                x: Math.cos(remotePlayer.angle || 0) * Math.cos(remotePlayer.pitch || 0),
                y: Math.sin(remotePlayer.pitch || 0),
                z: -Math.sin(remotePlayer.angle || 0) * Math.cos(remotePlayer.pitch || 0)
              },
              fov: remotePlayer.fov || controlSettings.fieldOfView
            }
          : null;
        if (opponentReplayActor) replayEnemies.push({ ...localReplayActor, id: "local-player" });
        replayBuffer.record(performance.now(), {
          player: localReplayActor,
          opponent: opponentReplayActor,
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
          if (playbackSample && replayPerspective === "remote" && playbackSample.opponent) {
            playbackSample = { ...playbackSample, player: playbackSample.opponent };
          }
          if (!playbackSample || playbackSample.finished) {
            replayPlayback = false;
            playbackSample = null;
            document.querySelector("#replay-indicator").hidden = true;
            overlay.hidden = false;
          }
        }
        render(playbackSample, dt);
        requestAnimationFrame(frame);
      }

      function beginDeploymentCountdown(label = "GET READY") {
        const countdown = document.querySelector("#deploy-countdown");
        const number = document.querySelector("#countdown-number");
        const caption = document.querySelector("#countdown-label");
        const token = ++deploymentCountdownToken;
        const steps = ["3", "2", "1", "START"];
        caption.textContent = label;
        countdown.hidden = false;
        const showStep = index => {
          if (token !== deploymentCountdownToken) return;
          number.textContent = steps[index];
          number.classList.remove("pulse");
          void number.offsetWidth;
          number.classList.add("pulse");
          if (index === steps.length - 1) {
            scheduleTimeout(() => {
              if (token !== deploymentCountdownToken) return;
              countdown.hidden = true;
              running = true;
              lastTime = performance.now();
            }, 550);
            return;
          }
          scheduleTimeout(() => showStep(index + 1), 900);
        };
        showStep(0);
      }

      function startGame(requestedMode = gameMode, fresh = gameOver, {
        acquirePointerLock = true,
        spawnPosition = null,
        countdownLabel = "GET READY"
      } = {}) {
        const needsCountdown = fresh || gameOver;
        if (fresh || gameOver) {
          teardownMatch(false);
          if (["waves", "training", "infinite", "zombies"].includes(requestedMode) &&
            (networkConnection || networkPeer)) disconnectPeer();
          gameMode = requestedMode;
          if (activeMapId !== selectedMapId) loadMap(selectedMapId);
          const spawn = spawnPosition
            ? { x: spawnPosition.x, y: -spawnPosition.z }
            : getPlayerSpawnPosition();
          if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.y) ||
            !canOccupyOnMap(mapDefinitions[activeMapId].grid, spawn.x, spawn.y, .24)) {
            throw new Error(`The assigned spawn is invalid for map "${activeMapId}".`);
          }
          player.reset(spawn);
          player.angle = Math.PI / 2;
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
          stamina = 100;
          sprintExhausted = false;
          jumpHeight = 0;
          jumpVelocity = 0;
          bunnyHopMultiplier = 1;
          cameraKickback = 0;
          inspectTimer = 0;
          updateInspectControl();
          weaponRecoil = 0;
          recoilPitch = 0;
          recoilYaw = 0;
          weaponLagX = 0;
          replayBuffer.reset();
          replayPlayback = false;
          replayPerspective = "local";
          matchReplayPerspective = "local";
          respawnCountdown = 0;
          killStreak = 0;
          resultSubmitted = false;
          document.querySelector("#leaderboard-panel").hidden = true;
          document.querySelector("#replay-indicator").hidden = true;
          wave = 0; enemies.length = 0; gameOver = false;
          pickups.forEach(pickup => scene.remove(pickup.model));
          pickups.length = 0;
          boss = null;
          waveFiveDropSpawned = false;
          waveRewardsAwarded.clear();
          playerFlashTimer = 0;
          playerFlashFadeTimer = 0;
          playerFlashFadeIn = 0;
          playerFlashOpacity = 0;
          pendingPlayerFlash = null;
          document.querySelector("#boss-health").hidden = true;
          grenades = 2;
          flashbangs = 1;
          document.querySelector("#grenade-count").textContent = grenades;
          document.querySelector("#flash-count").textContent = flashbangs;
          document.querySelector("#health").textContent = "100";
          document.querySelector("#health-fill").style.width = "100%";
          document.querySelector("#health-fill").style.background = "#57c2c8";
          document.querySelector("#wave").textContent = "WAVE 01";
          document.querySelector("#score").textContent = "0000";
          updateWeaponHud();
        }
        ensureAudio();
        firing = false;
        aiming = false;
        locallyPaused = false;
        running = !needsCountdown;
        menuScreens.forEach(menu => { menu.hidden = true; });
        overlay.hidden = true;
        updateAimHud();
        document.querySelector("#overlay-kicker").textContent = isWaveMode() || gameMode === "training"
          ? `SINGLE-PLAYER / ${gameMode.toUpperCase()}`
          : `${networkConnection?.open ? "PEER MATCH" : "BOT MATCH"} / ${gameMode.toUpperCase()}`;
        document.querySelector("#overlay-title").innerHTML = gameMode === "training"
          ? "TRAINING<br>GROUNDS"
          : isWaveMode() ? "HOLD THE<br>PERIMETER" : "MATCH<br>IN PROGRESS";
        document.querySelector("#overlay-copy").textContent = gameMode === "training"
          ? "Practice movement, weapon handling, and aim on respawning targets. Press E to collect any arena drops."
          : gameMode === "infinite"
            ? "Survive endlessly with infinite health and ammunition. Waves keep scaling."
            : gameMode === "zombies"
              ? "Face escalating waves of fast, melee-only undead."
              : isWaveMode()
                ? "Survive escalating hostile waves. Use WASD or the touch controls to move, aim and fire, and dash clear of danger."
          : networkConnection?.open
            ? "Two-player peer match: positions, health, weapons, and shots sync directly. Training bots are disabled in connected rooms."
            : "Eliminate the training opponent. Create or join a private peer room to play against another operator.";
        startButton.textContent = "Deploy";
        startButton.hidden = false;
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
        if (needsCountdown) beginDeploymentCountdown(countdownLabel);
      }

      function pauseGame() {
        if (!running || locallyPaused || gameOver) return;
        const cancelingInspect = inspectTimer > 0;
        inspectTimer = 0;
        updateInspectControl();
        if (cancelingInspect) setCombatMessage("INSPECT CANCELED", 700);
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

      function endGame({ won = false, replay = false, fromPeer = false } = {}) {
        if (gameOver) return;
        if (networkConnection?.open && !fromPeer) {
          sendPeerMessage({ type: "match-end", won, replay: Boolean(replay) });
        }
        running = false; locallyPaused = false; gameOver = true;
        deactivateSukunaPower(false);
        matchReplayPerspective = networkConnection?.open && !won ? "remote" : "local";
        audioManager.setCombatIntensity(0);
        firing = false;
        aiming = false;
        keys.clear();
        resetTouchControls();
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
        if (!isWaveMode()) submitMatchResult();
        document.querySelector("#overlay-kicker").textContent = `${won ? "VICTORY" : isWaveMode() ? "MISSION ENDED" : "MATCH ENDED"} / SCORE ${player.score}`;
        document.querySelector("#overlay-title").innerHTML = isWaveMode()
          ? "PERIMETER<br>BREACHED"
          : won ? "MATCH<br>WON" : networkConnection?.open ? "MATCH<br>LOST" : "MATCH<br>COMPLETE";
        document.querySelector("#overlay-copy").textContent = isWaveMode()
          ? `You held for ${wave} wave${wave === 1 ? "" : "s"}. Reset and try again.`
          : networkConnection?.open
            ? won
              ? "The opposing operator was eliminated."
              : "You were eliminated. Watch the final moments again."
            : `${operatorName} finished the ${gameMode.toUpperCase()} match.`;
        const autoRespawn = !won && !networkConnection?.open;
        startButton.hidden = true;
        returnMenuButton.hidden = false;
        document.querySelector("#pause-button").textContent = "Mission over";
        document.querySelector("#pause-button").disabled = true;
        if (replay && replayBuffer.frames.length >= 2) {
          scheduleTimeout(() => {
            if (gameOver && !replayPlayback) playMatchReplay({ perspective: matchReplayPerspective });
          }, 1800);
        }
        if (autoRespawn) {
          startGame(gameMode, true, { acquirePointerLock: false, countdownLabel: "RESPAWNING" });
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
      document.querySelector("#training-button").addEventListener("click", () => startGame("training", true));
      document.querySelector("#infinite-button").addEventListener("click", () => startGame("infinite", true));
      document.querySelector("#zombies-button").addEventListener("click", () => startGame("zombies", true));
      document.querySelector("#shop-button").addEventListener("click", () => {
        shopReturnScreen = mainMenu;
        showMenu(shopScreen);
      });
      document.querySelector("#shop-back-button").addEventListener("click", () => showMenu(shopReturnScreen));
      document.querySelector("#loadout-button").addEventListener("click", () => {
        updateLoadoutControls();
        showMenu(loadoutScreen);
      });
      document.querySelector("#loadout-shop-button").addEventListener("click", () => {
        shopReturnScreen = loadoutScreen;
        showMenu(shopScreen);
      });
      document.querySelector("#loadout-back-button").addEventListener("click", () => showMenu(mainMenu));
      document.querySelector("#shop-items").addEventListener("click", event => {
        const button = event.target.closest("[data-cosmetic]");
        if (button && !button.disabled) useCosmetic(button.dataset.cosmetic);
      });
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
          const enabled = event.currentTarget.checked;
          if (!weaponManager.setAttachment(loadoutWeaponIndex, attachment, enabled)) {
            event.currentTarget.checked = false;
            setCombatMessage(`${attachment.toUpperCase()} IS NOT AVAILABLE ON THIS WEAPON`, 1800);
            return;
          }
          applyWeaponAttachments(loadoutWeaponIndex);
          saveProgression();
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
          const now = performance.now();
          if (lastEscapePress > 0 && now - lastEscapePress <= 2000) {
            lastEscapePress = 0;
            if (escapeRunningBeforeFirst) {
              if (!running) {
                startGame(gameMode, false);
              } else if (locallyPaused !== escapeLocallyPausedBeforeFirst) {
                if (escapeLocallyPausedBeforeFirst) pauseGame();
                else startGame(gameMode, false);
              }
            } else if (running && !locallyPaused) {
              pauseGame();
            }
            escapeRunningBeforeFirst = false;
            escapeLocallyPausedBeforeFirst = false;
            suppressPointerLockPauseUntil = now + 500;
            toggleFullscreen();
            return;
          }
          const pointerLockWasJustLost = now - pointerLockPauseAt <= 120;
          escapeRunningBeforeFirst = running || pointerLockWasJustLost;
          escapeLocallyPausedBeforeFirst = locallyPaused;
          lastEscapePress = now;
          if (locallyPaused) startGame(gameMode, false);
          else if (running) pauseGame();
          else if (pointerLockWasJustLost) return;
          else if (!gameOver && !overlay.hidden) startGame(gameMode, false);
          return;
        }
        if (!running || locallyPaused) return;
        if (sukunaActive && event.code === "KeyF" && !event.repeat) {
          launchSukunaFuga();
          return;
        }
        if (event.code === "KeyF" && !event.repeat) {
          inspectWeapon();
          return;
        }
        if ((inspectTimer > 0 && event.code !== "Space") || event.repeat) return;
        if (sukunaActive && event.code === "KeyQ") {
          castSukunaCleave();
          return;
        }
        if (sukunaActive && event.code === "KeyX") {
          expandSukunaDomain();
          return;
        }
        if (event.code === "KeyR") reload();
        if (event.code === "Space") startJump();
        if (event.code === "KeyG") {
          if (sukunaActive) return;
          grenadeAim = true;
          return;
        }
        if (event.code === "KeyV" && !sukunaActive) addGrenade(true);
        if (event.code === "KeyC") startDash();
        if (event.code === "KeyE") updatePickups(0);
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
          if (!running || locallyPaused || (inspectTimer > 0 && button.id !== "touch-sprint")) return;
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
        if (sukunaActive) {
          castSukunaCleave();
        } else {
          aiming = true;
          updateAimHud();
        }
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
      document.querySelector("#touch-jump").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        startJump();
      });
      document.querySelector("#touch-inspect").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        inspectWeapon();
      });
      document.querySelector("#touch-reload").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        if (sukunaActive) launchSukunaFuga();
        else reload();
      });
      document.querySelector("#touch-swap").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        selectWeapon((player.weaponIndex + 1) % weapons.length);
      });
      document.querySelector("#touch-frag").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        if (sukunaActive) expandSukunaDomain();
        else addGrenade(false);
      });
      document.querySelector("#touch-flash").addEventListener("pointerdown", event => {
        if (!running || locallyPaused) return;
        event.preventDefault();
        if (!sukunaActive) addGrenade(true);
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
        if (inspectTimer > 0) return;
        if (event.button === 2) {
          event.preventDefault();
          aiming = !sukunaActive;
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
        if (!running || locallyPaused || inspectTimer > 0 || event.deltaY === 0) return;
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
      saveProgression();
      applyWeaponCamo();
      resize();
      if ("ResizeObserver" in window) {
        new ResizeObserver(resize).observe(document.querySelector(".stage"));
      }
      requestAnimationFrame(frame);
    })();
