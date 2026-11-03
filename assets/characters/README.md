# Character models

The game first looks for `assets/models/swat/swat.gltf`. If it is unavailable,
it tries `assets/characters/soldier.glb`. Procedural characters remain the
fallback when neither rig can be loaded. A rig should:

- Use meters and face local negative Z.
- Include a right-hand bone named `Hand_R`, `WristR`, `hand_r`,
  `mixamorigRightHand`, or `Right_Hand`; the loaded weapon model is parented
  directly to that bone at local position `(0, 0.05, 0)` and zero rotation.
- Include clips named for idle, walk, run, shoot, and reload states. Missing
  states fall back to the closest available locomotion clip.
- Keep a conventional head, chest/spine, and limb skeleton so the game can add
  its transparent hit colliders to those bones.

The procedural articulated model remains the fallback if the rig or required
hand socket is absent.
