/* Hybrid Interactive Wallpaper
   - Detects capability and uses either Canvas (light) or three.js (advanced).
   - Basic features: falling leaves (respawn), wind cycle, click burst, star presets & cycle, settings panel (long-press).
   - NOTE: This is a starting implementation. You can upload to GitHub Pages and paste URL in Lively.
*/

// ----------- Capability detection (simple heuristics) -------------
function detectCapability() {
  const supportsWebGL = (() => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  })();
  const deviceMemory = navigator.deviceMemory || 0;
  const cpuCores = navigator.hardwareConcurrency || 2;
  // WebGL + deviceMemory >= 4GB + >=4 cores -> prefer three
  if (supportsWebGL && deviceMemory >= 4 && cpuCores >= 4) return 'three';
  // Otherwise choose canvas, unless user set performance override
  return 'canvas';
}

// ----------- Dynamic loader for three.js if needed -------------
function loadThreeThen(cb) {
  if (window.THREE) return cb();
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/three@0.154.0/build/three.min.js';
  s.onload = cb;
  s.onerror = () => cb(new Error('Failed to load three.js'));
  document.head.appendChild(s);
}

// ----------- UI & settings (localStorage) -------------
const settings = {
  perf: false,
  starCycle: true,
  starInterval: 15,
  leafDensity: 40,
  windSpeed: 1
};
function loadSettings() {
  try {
    const raw = localStorage.getItem('hw_settings');
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) {}
}
function saveSettings() { try { localStorage.setItem('hw_settings', JSON.stringify(settings)); } catch(e){} }

// ----------- Init & decision -------------
loadSettings();
const choice = detectCapability();
const preferThree = (choice === 'three' && !settings.perf);

if (preferThree) {
  loadThreeThen((err) => {
    if (err) {
      console.warn('three load failed, fallback to canvas', err);
      initCanvas();
    } else {
      // still allow override via settings.perf
      initThree();
    }
  });
} else {
  initCanvas();
}

// ----------- Canvas implementation -------------
function initCanvas() {
  console.log('Using Canvas engine');
  const canvas = document.getElementById('fx-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = canvas.width = innerWidth, h = canvas.height = innerHeight;

  const bg = document.getElementById('bg-layer');
  window.addEventListener('resize', () => { w = canvas.width = innerWidth; h = canvas.height = innerHeight; createStars(); });

  // mouse
  const mouse = { x: w/2, y: h/2, down:false };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  addEventListener('pointerdown', (e) => { mouse.down=true; spawnBurst(e.clientX,e.clientY,18); if (settings.starCycle) spawnStarPulse(e.clientX,e.clientY); });
  addEventListener('pointerup', () => { mouse.down=false; });

  // long-press to open settings
  let pressTimer = null;
  let pressStartX=0, pressStartY=0;
  addEventListener('pointerdown', (e) => {
    pressStartX=e.clientX; pressStartY=e.clientY;
    pressTimer = setTimeout(()=>{ openSettings(); }, 600);
  });
  addEventListener('pointerup', ()=>{ if (pressTimer) clearTimeout(pressTimer); pressTimer=null; });

  // parallax
  function updateParallax() {
    const dx = (mouse.x - w/2)/(w/2), dy = (mouse.y - h/2)/(h/2);
    const tx = dx * 10 * (1 + settings.windSpeed*0.2), ty = dy * 6 * (1 + settings.windSpeed*0.15);
    const s = 1 + Math.max(Math.abs(dx), Math.abs(dy)) * 0.015;
    bg.style.transform = `translate3d(${tx}px, ${ty}px,0) scale(${s})`;
  }

  // wind cycle
  let t0 = performance.now();
  function windVector(now) {
    const t = (now - t0) * 0.001;
    const period = 10 + (5 * (3 - settings.windSpeed)); // speed influences period
    const ang = Math.sin(t * (2*Math.PI / period)) * Math.PI * 0.75; // swings
    const mag = 0.2 + settings.windSpeed * 0.6 + 0.2*Math.sin(t*0.7);
    return { x: Math.cos(ang)*mag, y: Math.sin(ang)*mag, ang, mag };
  }

  // leaves system
  class Leaf {
    constructor(spawnX, spawnY) {
      this.spawnX = spawnX; this.spawnY = spawnY;
      this.reset(true);
    }
    reset(init=false) {
      this.x = this.spawnX + (Math.random()-0.5)*40;
      this.y = this.spawnY + (init? Math.random()*60 : 0);
      this.vx = (Math.random()-0.5)*0.3; this.vy = 0.2 + Math.random()*0.6;
      this.r = 6 + Math.random()*10;
      this.life = 0;
      this.maxLife = 200 + Math.random()*400;
      this.hue = 250 + Math.random()*60;
    }
    step(wind) {
      // wind pushes and some bob
      this.vx += wind.x * 0.03 + (Math.random()-0.5)*0.03;
      this.vy += 0.008;
      this.vx *= 0.995; this.vy *= 0.995;
      this.x += this.vx; this.y += this.vy;
      this.life++;
      if (this.y > h + 40 || this.life > this.maxLife) {
        // respawn after short delay: move back to spawn top
        this.reset(false);
        this.y = -20; // start above screen to "grow" back
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      const angle = Math.sin(this.life*0.05 + this.x*0.01) * 0.6;
      ctx.rotate(angle);
      const g = ctx.createLinearGradient(-this.r, -this.r, this.r, this.r);
      g.addColorStop(0, `hsla(${this.hue+10},70%,55%,0.95)`);
      g.addColorStop(1, `hsla(${this.hue-20},70%,45%,0.9)`);
      ctx.fillStyle = g;
      // simple leaf shape
      ctx.beginPath(); ctx.ellipse(0,0,this.r, this.r*0.6, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  // spawn points across top branches area (simple grid at top 25% height)
  let spawnPoints = [];
  function createSpawnPoints() {
    spawnPoints = [];
    const rows = 3;
    const cols = Math.max(6, Math.floor(w/160));
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const x = (c+0.5)*(w/cols);
        const y = Math.max(40, h*0.06 + r*18); // near top frame
        spawnPoints.push({x,y});
      }
    }
  }

  const leaves = [];
  function createLeaves() {
    leaves.length = 0;
    createSpawnPoints();
    const density = Math.max(5, settings.leafDensity);
    for (let i=0;i<density;i++){
      const sp = spawnPoints[i % spawnPoints.length];
      leaves.push(new Leaf(sp.x + (Math.random()-0.5)*40, sp.y + (Math.random()-0.5)*40));
    }
  }

  // particles for bursts
  const particles = [];
  class Particle {
    constructor(x,y){
      this.x=x; this.y=y;
      this.vx=(Math.random()-0.5)*3; this.vy=(Math.random()-1.5)*3;
      this.r=2+Math.random()*3; this.life=40+Math.random()*60; this.age=0;
      this.h=250+Math.random()*100;
    }
    step(wind){
      this.vx += wind.x * 0.05; this.vy += 0.03;
      this.vx *= 0.98; this.vy *= 0.99;
      this.x += this.vx; this.y += this.vy; this.age++;
    }
    draw(ctx){
      const a = Math.max(0, 1 - this.age/this.life);
      const g = ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,this.r*6);
      g.addColorStop(0, `hsla(${this.h},90%,60%,${a})`);
      g.addColorStop(1, `hsla(${this.h},60%,50%,0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x,this.y,this.r*6,0,Math.PI*2); ctx.fill();
    }
    dead(){ return this.age >= this.life; }
  }

  function spawnBurst(x,y,n=12){
    for (let i=0;i<n;i++) particles.push(new Particle(x + (Math.random()-0.5)*12, y + (Math.random()-0.5)*12));
  }

  // stars with presets + cycle
  let stars = [];
  const starPresets = [
    { name:'Bokeh Dots', density:80, size:[0.6,2.6], glow:0.9, palette:['#ffffff','#ffe6f0'] },
    { name:'Classic Point', density:40, size:[1.2,3.2], glow:0.7, palette:['#fff7d6'] },
    { name:'Graphic Polygon', density:30, size:[1.8,4.5], glow:0.6, palette:['#d9e8ff','#b8a6ff'] },
    { name:'Spark Clusters', density:20, size:[2,6], glow:1.0, palette:['#ffffff','#ffd6ff','#9ae6ff'] }
  ];
  let starPresetIndex = 0;
  function createStars() {
    stars = [];
    const preset = starPresets[starPresetIndex];
    const count = Math.floor(preset.density * (w*h)/(1920*1080));
    for (let i=0;i<count;i++){
      stars.push({
        x: Math.random()*w, y: Math.random()*h*0.6, // stars mostly in sky region
        s: preset.size[0] + Math.random()*(preset.size[1]-preset.size[0]),
        hue: preset.palette[Math.floor(Math.random()*preset.palette.length)],
        phase: Math.random()*Math.PI*2,
        speed: 0.002 + Math.random()*0.01
      });
    }
  }

  // star cycle
  let lastStarChange = performance.now();
  function maybeCycleStars(now) {
    if (!settings.starCycle) return;
    const interval = (settings.starInterval || 15) * 1000;
    if (now - lastStarChange > interval) {
      starPresetIndex = (starPresetIndex + 1) % starPresets.length;
      // crossfade: quick approach = recreate stars smoothly (fade out/in)
      createStars();
      lastStarChange = now;
    }
  }

  // star pulse on click
  function spawnStarPulse(x,y){
    for (let i=0;i<20;i++){
      particles.push(new Particle(x + (Math.random()-0.5)*80, y + (Math.random()-0.5)*80));
    }
  }

  // settings panel UI bindings
  function bindSettingsUI() {
    const panel = document.getElementById('settings');
    const perfToggle = document.getElementById('perfToggle');
    const starCycleToggle = document.getElementById('starCycleToggle');
    const starInterval = document.getElementById('starInterval');
    const leafDensity = document.getElementById('leafDensity');
    const windSpeed = document.getElementById('windSpeed');
    const closeBtn = document.getElementById('closeSettings');
    perfToggle.checked = settings.perf;
    starCycleToggle.checked = settings.starCycle;
    starInterval.value = settings.starInterval;
    leafDensity.value = settings.leafDensity;
    windSpeed.value = settings.windSpeed;
    perfToggle.addEventListener('change', (e)=>{ settings.perf = e.target.checked; saveSettings(); });
    starCycleToggle.addEventListener('change', (e)=>{ settings.starCycle = e.target.checked; saveSettings(); });
    starInterval.addEventListener('input', (e)=>{ settings.starInterval = parseInt(e.target.value); saveSettings(); });
    leafDensity.addEventListener('input', (e)=>{ settings.leafDensity = parseInt(e.target.value); createLeaves(); saveSettings(); });
    windSpeed.addEventListener('input', (e)=>{ settings.windSpeed = parseFloat(e.target.value); saveSettings(); });
    closeBtn.addEventListener('click', ()=>{ panel.classList.add('hidden'); });
  }
  bindSettingsUI();

  function openSettings() {
    document.getElementById('settings').classList.remove('hidden');
  }

  // hint
  let hint = document.createElement('div'); hint.id='holdHint'; hint.innerText='Nhấn giữ để mở cài đặt'; document.body.appendChild(hint);

  // main loop
  createSpawnPoints();
  createLeaves();
  createStars();

  function loop(now) {
    const wind = windVector(now);
    updateParallax();
    maybeCycleStars(now);

    ctx.clearRect(0,0,w,h);
    // subtle dim overlay
    ctx.fillStyle = 'rgba(6,6,12,0.08)'; ctx.fillRect(0,0,w,h);

    // draw stars
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for (let s of stars) {
      s.phase += s.speed;
      const a = 0.35 + 0.65 * (0.5 + 0.5*Math.sin(s.phase*2));
      const size = s.s * (1 + 0.4*Math.sin(s.phase*4));
      ctx.fillStyle = hexToRgba(s.hue, a);
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.3,size), 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // update & draw leaves
    for (let lf of leaves) { lf.step(wind); lf.draw(ctx); }

    // ambient spawn little particles
    if (Math.random() < 0.06) {
      const sx = Math.random()*w; const sy = Math.random()*h*0.6;
      particles.push(new Particle(sx, sy));
    }

    for (let i=particles.length-1;i>=0;i--){
      const p = particles[i]; p.step(wind); p.draw(ctx);
      if (p.dead()) particles.splice(i,1);
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // helper
  function hexToRgba(hex, a=1){
    const c = hex.replace('#','');
    const bigint = parseInt(c,16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${a})`;
  }
}

// ----------- three.js implementation (basic demo) -------------
function initThree() {
  console.log('Using three.js engine');
  // Basic three scene with Points as 'leaves' and post simple glow via additive blending.
  const container = document.body;
  const width = innerWidth, height = innerHeight;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(width, height); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.domElement.style.position='fixed'; renderer.domElement.style.inset='0'; renderer.domElement.style.zIndex='1'; document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width/height, 0.1, 2000); camera.position.set(0,0,600);

  // simple ambient
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  // create GPU points for leaves (using a sprite texture)
  const texCanvas = document.createElement('canvas'); texCanvas.width=64; texCanvas.height=64;
  const tctx = texCanvas.getContext('2d'); tctx.clearRect(0,0,64,64);
  // draw radial leaf-like dot to use as sprite
  const grad = tctx.createRadialGradient(32,32,4,32,32,28);
  grad.addColorStop(0,'#ffffff'); grad.addColorStop(0.6,'#ffe6ff'); grad.addColorStop(1,'#00000000');
  tctx.fillStyle = grad; tctx.beginPath(); tctx.arc(32,32,24,0,Math.PI*2); tctx.fill();
  const spriteTex = new THREE.CanvasTexture(texCanvas);

  const leafCount = Math.min(8000, Math.floor((innerWidth*innerHeight)/150));
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(leafCount*3);
  const sizes = new Float32Array(leafCount);
  for (let i=0;i<leafCount;i++){
    positions[3*i] = (Math.random()-0.5) * innerWidth;
    positions[3*i+1] = (Math.random()-0.2) * innerHeight;
    positions[3*i+2] = (Math.random()-0.5) * 200;
    sizes[i] = 8 + Math.random()*18;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({ map: spriteTex, size: 12, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, opacity: 0.95 });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // animation
  let t0 = performance.now();
  function animate(now) {
    const t = (now - t0) * 0.001;
    // simple oscillation to mimic wind
    points.rotation.y = Math.sin(t*0.2) * 0.05;
    const pos = geometry.attributes.position.array;
    for (let i=0;i<leafCount;i++){
      pos[3*i+1] -= 0.3 + Math.sin(t*0.6 + i)*0.3;
      if (pos[3*i+1] < -innerHeight*0.6) pos[3*i+1] = innerHeight*0.6;
    }
    geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // resize
  window.addEventListener('resize', ()=> {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w,h); camera.aspect = w/h; camera.updateProjectionMatrix();
  });
}

// ------------- README (instructions) -------------
/*
README (in this JS for convenience):
- Place wallpaper.jpg (your background image) in same folder as these files.
- Run a local server: `python -m http.server 8000` then open http://localhost:8000
- The script auto-detects capability and uses three.js if available & deviceMemory >= 4GB & CPU cores >=4.
- To force Canvas (light) mode: open DevTools and run: localStorage.setItem('hw_settings', JSON.stringify({...JSON.parse(localStorage.getItem('hw_settings')||'{}'), perf:true})); location.reload();
- To force three mode (remove perf): localStorage.setItem('hw_settings', JSON.stringify({...JSON.parse(localStorage.getItem('hw_settings')||'{}'), perf:false})); location.reload();
*/
