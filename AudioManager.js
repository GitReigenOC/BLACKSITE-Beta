export class AudioManager {
  constructor(listenerCamera, world, engine) {
    this.engine = engine;
    this.world = world;
    this.listener = new engine.AudioListener();
    listenerCamera.add(this.listener);
    this.context = this.listener.context;
    this.master = this.context.createGain();
    this.master.gain.value = 1;
    this.environmentFilter = this.context.createBiquadFilter();
    this.environmentFilter.type = "lowpass";
    this.environmentFilter.frequency.value = 20000;
    this.reverbSend = this.context.createGain();
    this.reverbSend.gain.value = 0;
    this.environment = "";
    this.convolver = this.context.createConvolver();
    this.convolver.buffer = this.createImpulseResponse(2.4, 2.2);
    this.listener.gain.disconnect();
    this.listener.gain.connect(this.environmentFilter);
    this.environmentFilter.connect(this.master);
    this.environmentFilter.connect(this.reverbSend);
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.master);
    this.master.connect(this.context.destination);
    this.buffers = new Map();
    this.voices = new Set();
    this.ambient = null;
    this.musicLayers = [];
    this.combatIntensity = -1;
  }

  createImpulseResponse(duration, decay) {
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(2, Math.floor(sampleRate * duration), sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) {
        const time = index / samples.length;
        samples[index] = (Math.random() * 2 - 1) * Math.pow(1 - time, decay);
      }
    }
    return buffer;
  }

  createSoundBuffer(type) {
    const presets = {
      rifle: [105, .11, .24, .38], sniper: [64, .3, .34, .58],
      shotgun: [78, .18, .32, .48], smg: [128, .06, .16, .26],
      suppressed: [72, .12, .12, .68],
      knife: [240, .08, .12, .16], reload: [340, .12, .05, .12],
      damage: [72, .24, .12, .32], death: [48, .7, .16, .72],
      grenade: [55, .4, .3, .92], flash: [880, .22, .09, .4],
      footstep: [88, .045, .035, .12], hit: [190, .07, .06, .14],
      parry: [720, .12, .16, .24], "parry-break": [120, .42, .24, .72]
    };
    const [frequency, duration, volume, noiseAmount] = presets[type] || presets.rifle;
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      const time = index / sampleRate;
      const envelope = Math.exp(-time * (type === "footstep" ? 75 : 12 / duration));
      const tone = Math.sin(2 * Math.PI * frequency * time * (1 - time / (duration * 1.7)));
      samples[index] = (tone * (1 - noiseAmount) + (Math.random() * 2 - 1) * noiseAmount) * envelope * volume;
    }
    return buffer;
  }

  unlock() {
    if (this.context.state === "suspended") this.context.resume();
    if (this.ambient) return;
    const oscillator = this.context.createOscillator();
    const lowpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 47;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 90;
    gain.gain.value = .012;
    oscillator.connect(lowpass).connect(gain).connect(this.master);
    oscillator.start();
    this.ambient = { oscillator, lowpass, gain };
    [55, 82.41, 110].forEach((frequency, index) => {
      const layer = this.context.createOscillator();
      const layerGain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      layer.type = index === 1 ? "sine" : "triangle";
      layer.frequency.value = frequency;
      filter.type = "lowpass";
      filter.frequency.value = index === 2 ? 520 : 260;
      layerGain.gain.value = 0;
      layer.connect(filter).connect(layerGain).connect(this.master);
      layer.start();
      this.musicLayers.push({ gain: layerGain, base: [.009, .006, .003][index] });
    });
  }

  setCombatIntensity(intensity) {
    const level = Math.min(1, Math.max(0, intensity));
    if (Math.abs(level - this.combatIntensity) < .08) return;
    this.combatIntensity = level;
    const now = this.context.currentTime;
    this.musicLayers.forEach(({ gain, base }, index) => {
      gain.gain.setTargetAtTime(base * level * (index === 0 ? 1 : .35 + level * .65), now, .45);
    });
  }

  setMasterVolume(volume) {
    this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), this.context.currentTime, .04);
  }

  play(type, position, options = {}) {
    if (this.context.state === "suspended") this.context.resume();
    if (!this.buffers.has(type)) this.buffers.set(type, this.createSoundBuffer(type));
    const anchor = new this.engine.Object3D();
    anchor.position.copy(position);
    this.world.add(anchor);
    const sound = new this.engine.PositionalAudio(this.listener);
    sound.setBuffer(this.buffers.get(type));
    sound.setRefDistance(options.refDistance || 2.4);
    sound.setRolloffFactor(options.rolloffFactor || 1.35);
    sound.setDistanceModel("inverse");
    sound.setVolume(options.volume ?? 1);
    sound.setLoop(false);
    anchor.add(sound);
    this.voices.add(anchor);
    sound.onEnded = () => {
      sound.disconnect();
      anchor.remove(sound);
      this.world.remove(anchor);
      this.voices.delete(anchor);
    };
    sound.play();
  }

  setEnvironment(mapId, inTrench = false) {
    const environment = `${mapId}:${inTrench}`;
    if (environment === this.environment) return;
    this.environment = environment;
    const now = this.context.currentTime;
    const cutoff = mapId === "battlefield" ? (inTrench ? 1100 : 4200) : 20000;
    const reverb = mapId === "pool" ? .32 : mapId === "battlefield" && inTrench ? .12 : 0;
    this.environmentFilter.frequency.setTargetAtTime(cutoff, now, .18);
    this.reverbSend.gain.setTargetAtTime(reverb, now, .2);
  }

  dispose() {
    for (const anchor of this.voices) {
      const sound = anchor.children.find(child => child.isPositionalAudio);
      if (sound?.isPlaying) sound.stop();
      sound?.disconnect();
      this.world.remove(anchor);
    }
    this.voices.clear();
    this.listener.gain.disconnect();
    this.master.disconnect();
    this.context.close();
  }
}
