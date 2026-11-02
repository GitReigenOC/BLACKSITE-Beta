YO so I'm making some game that's for entertainment purposes without the issue of getting white listed. So either it's going to be one game or a complete web page/site for this game thats all I have to say

(GAME IS IN DEVELOPMENT CURRENTLY SO EXPECT A BUNCH OF BUGS)

## Local development

The browser game is an ES-module application. `_layouts/default.html` supplies the Three.js import map and loads `main.js`; `game.js` remains as a compatibility entry point. The game uses procedural character and weapon models by default. To enable the optional rigged enemy, provide `assets/characters/soldier.glb` with an animated right-hand bone named `RightHand`, `hand_r`, or `mixamorigRightHand`. Optional weapon GLBs can be supplied under `assets/weapons/` as `rifle.glb`, `sniper.glb`, `shotgun.glb`, `smg.glb`, and `knife.glb`; built-in models are used when these files are absent.

Player spawn points are authored per map as world-space `spawnPoints` vectors in `main.js`; multiplayer hosts validate and assign separate safe positions to both peers. Solo bots use grid pathfinding and Seek, Cover, Attack, and Dodge states, with line-of-sight checks against solid map tiles; wave two introduces Brutes with 300 health, heavy weapons, and reduced movement speed. Connected private rooms disable training bots so they cannot interfere with peer matches. Head, torso, and limb hits apply 3x, 1x, and 0.5x damage respectively.

Combat bullets, particles, and wall decals use bounded reusable `THREE.InstancedMesh` pools; transient effects and timers are cleared when a match is reset or left. Players receive three seconds of spawn protection, and spawn selection rejects invalid map coordinates and prefers positions outside enemy line of sight. Multiplayer pause is a local overlay only: the peer simulation continues, and leaving disconnects the local peer without sending a match-end message to the remaining player. Hit markers and hit-confirmation skulls animate and clear after one second. Procedural first-person weapon models are used automatically when optional weapon assets are missing. Wall bullet marks use actual 3D wall intersections, preventing floating marks; bot hits use impact particles instead of wall decals.

Multiplayer currently supports two players in a private PeerJS/WebRTC room; it does not provide public matchmaking, multi-peer FFA/TDM, or a server-authoritative anti-cheat model. Positions, health, weapons, and shots synchronize directly between peers, and a player elimination ends the match for both sides. Solo matches continue to use bots. Multiplayer hosts can configure match mode and map only after creating an active private room; the selected configuration is sent to the joining peer when the match starts. The elimination replay is only triggered by a connected player elimination, not by bot kills.

Movement includes jumping with Space, held-space bunny hops, sprint stamina, and weapon-weight movement speeds. Hip-fire recoil includes camera and weapon kick, reduced while aiming and by suppressors. Press F to inspect, G for a frag, and V for a flashbang. Inspection locks combat and movement until F/the touch Cancel button cancels it or Escape pauses and cancels it; the knife has a dedicated camera-space pose. Sniper ADS uses its scope overlay, reduced FOV, and adjustable lower sensitivity; iron sights align to the camera. Optics are unavailable on shotguns and knives, and suppressors are unavailable on knives. Remote and procedural AI weapons attach at right-hand sockets; optional rigged enemy models require a `Hand_R` or supported equivalent bone.

The map selector and private-room configuration include Tactical Arena, Battlefield, The Pool Rooms, Foundry, and Rooftop. Arena includes a small hidden headphone-wearing duck. Solo play also has Training (respawning target dummies), Infinite (unlimited health and ammunition), and Zombies (melee-only waves). Wave play restores health between rounds, awards credits, drops a medkit and weapon on Wave 5, and adds a scaling boss every 10 waves. Credits persist locally and can be spent in the shop on character skins and weapon camos.

Weapons have individual F-key inspection poses. The sniper has a light movement profile and penetrates up to five lined-up targets, with damage falloff; knife hits use slash decals rather than bullet holes. Flashbangs check facing and wall occlusion, apply a five-second player whiteout, and disrupt AI aim. Connected two-player eliminations trigger a synchronized Best Play replay using each client's locally buffered final ten seconds.

The optional SQLite leaderboard API runs on loopback and uses only the Python standard library:

```powershell
python leaderboard_server.py
```

Serve the Jekyll site separately. The game calls `http://127.0.0.1:8765/api` by default; set `window.BLACKSITE_API_URL` before loading `main.js` to use a different API origin. The local API binds only to `127.0.0.1`; do not expose this development server directly to the public internet. Match results remain playable if the API is unavailable, and the leaderboard panel displays the connection status.

Run the backend tests with:

```powershell
python -m unittest test_leaderboard_server.py
```
