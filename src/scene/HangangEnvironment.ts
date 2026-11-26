import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as xb from 'xrblocks';

const TRACK_LENGTH = 160;
const SCENERY_SPAN = 140;
const CHERRY_TREE_COUNT = 22;
const ACACIA_TREE_COUNT = 22;
const DRIFT_PETAL_COUNT = 130;
const SHRUB_COUNT = 84;
const FLOWER_COUNT = 540;
const LAMP_COUNT = 16;
const BOLLARD_COUNT = 40;
const SIGNPOST_COUNT = 5;
const SIGNPOST_SPACING_M = SCENERY_SPAN / SIGNPOST_COUNT;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export class HangangEnvironment extends xb.Script {
  private vrGroup = new THREE.Group();
  private arRibbonGroup = new THREE.Group();
  private roadTexture: THREE.CanvasTexture | null = null;
  private waterTexture: THREE.CanvasTexture | null = null;
  private skyTexture: THREE.CanvasTexture | null = null;
  private arRibbonTexture: THREE.CanvasTexture | null = null;
  private envMapTexture: THREE.Texture | null = null;

  private cherryTrunksMesh: THREE.InstancedMesh | null = null;
  private cherryBlossomsMesh: THREE.InstancedMesh | null = null;
  private cherryInnerMesh: THREE.InstancedMesh | null = null;
  private acaciaTrunksMesh: THREE.InstancedMesh | null = null;
  private acaciaCanopyMesh: THREE.InstancedMesh | null = null;
  private acaciaBlossomsMesh: THREE.InstancedMesh | null = null;
  private driftPetalsMesh: THREE.InstancedMesh | null = null;
  private shrubsMesh: THREE.InstancedMesh | null = null;
  private flowerStemsMesh: THREE.InstancedMesh | null = null;
  private flowerPetalsMesh: THREE.InstancedMesh | null = null;
  private flowerCentersMesh: THREE.InstancedMesh | null = null;
  private lampsMesh: THREE.InstancedMesh | null = null;
  private lampBulbsMesh: THREE.InstancedMesh | null = null;
  private bollardsMesh: THREE.InstancedMesh | null = null;

  private cherryOffsetsZ: number[] = [];
  private cherrySideX: number[] = [];
  private cherryScales: number[] = [];
  private acaciaOffsetsZ: number[] = [];
  private acaciaSideX: number[] = [];
  private acaciaScales: number[] = [];
  private driftPetalOffsetsZ: number[] = [];
  private driftPetalX: number[] = [];
  private driftPetalY: number[] = [];
  private driftPetalPhases: number[] = [];
  private shrubOffsetsZ: number[] = [];
  private shrubSideX: number[] = [];
  private shrubScales: number[] = [];
  private flowerOffsetsZ: number[] = [];
  private flowerSideX: number[] = [];
  private flowerScales: number[] = [];
  private flowerPhases: number[] = [];
  private lampOffsetsZ: number[] = [];
  private bollardOffsetsZ: number[] = [];
  private signposts: Array<{
    group: THREE.Group;
    faceMat: THREE.MeshStandardMaterial;
    z: number;
    kmIndex: number;
  }> = [];
  private signpostTextures: THREE.CanvasTexture[] = [];

  private currentSpeedKmh = 21.4;
  private optimizationRatio = 0.35;
  private isArMode = false;
  private scrollDistance = 0;
  private riverTime = 0;
  private waterUniforms: {uWaterTime: {value: number}} = {
    uWaterTime: {value: 0},
  };

  private arRibbonMat: THREE.MeshBasicMaterial | null = null;
  private disposables: Array<{dispose: () => void}> = [];

  public init(): void {
    this.setupLightingAndEnvironment();
    this.buildSkyAndHorizon();
    this.buildRoadAndRiver();
    this.buildInstancedScenery();
    this.buildArPaceRibbon();

    this.add(this.vrGroup);
    this.add(this.arRibbonGroup);
    this.disablePointerEventsRecursively(this);
  }

  public setTelemetry(speedKmh: number, optimizationScore: number): void {
    this.currentSpeedKmh = speedKmh;
    this.optimizationRatio = optimizationScore / 100;
  }

  public setArPassthrough(enabled: boolean): void {
    this.isArMode = enabled;
    this.vrGroup.visible = !enabled;
    this.arRibbonGroup.visible = true;
    if (xb.core.scene) {
      xb.core.scene.fog = enabled
        ? null
        : new THREE.FogExp2(0xc7e4f8, 0.0072);
    }
  }

  public update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    const speedMs = (this.currentSpeedKmh * 1000) / 3600;
    this.scrollDistance += speedMs * dt;
    this.riverTime += dt;
    this.waterUniforms.uWaterTime.value = this.riverTime;

    if (this.roadTexture) {
      this.roadTexture.offset.y = -(this.scrollDistance / 16) % 1;
    }
    if (this.waterTexture) {
      this.waterTexture.offset.x = Math.sin(this.riverTime * 0.28) * 0.018;
      this.waterTexture.offset.y =
        -((this.riverTime * 0.05 + this.scrollDistance * 0.012) % 1);
    }
    if (this.arRibbonTexture && this.arRibbonMat) {
      this.arRibbonTexture.offset.y = -(this.scrollDistance * 0.32) % 1;
      const targetColor = this.optimizationRatio >= 0.85 ? 0x0284c7 : 0xf59e0b;
      _color.setHex(targetColor);
      this.arRibbonMat.color.lerp(_color, 0.08);
      this.arRibbonMat.opacity = this.isArMode ? 0.55 : 0.35;
    }

    this.updateInstancedScroll(speedMs * dt);
  }

  private setupLightingAndEnvironment(): void {
    // Crisp Hangang daytime outdoor lighting
    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x5c8a5e, 2.15);
    this.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.9);
    keyLight.position.set(18, 28, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 45;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xbae6fd, 0.95);
    rimLight.position.set(-10, 8, -14);
    this.add(rimLight);

    const renderer = xb.core.renderer as unknown as THREE.WebGLRenderer | undefined;
    if (renderer && typeof THREE.PMREMGenerator !== 'undefined') {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new RoomEnvironment();
        const rt = pmrem.fromScene(envScene, 0.04);
        this.envMapTexture = rt.texture;
        if (xb.core.scene) {
          xb.core.scene.environment = this.envMapTexture;
          xb.core.scene.fog = new THREE.FogExp2(0xc7e4f8, 0.0072);
        }
        pmrem.dispose();
        envScene.dispose();
      } catch {
        // Fallback cleanly if renderer is not a standard WebGLRenderer (e.g. SplitEngine)
      }
    }
  }

  private buildSkyAndHorizon(): void {
    // Procedural Hangang bright daytime sky dome with soft clouds and afternoon sun
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.0, '#1d4ed8');
      grad.addColorStop(0.28, '#3b82f6');
      grad.addColorStop(0.5, '#7dd3fc');
      grad.addColorStop(0.68, '#bae6fd');
      grad.addColorStop(0.78, '#e0f2fe');
      grad.addColorStop(0.86, '#cbe7f8');
      grad.addColorStop(1.0, '#93c5fd');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 512);

      // Warm afternoon sun halo
      const sunGrad = ctx.createRadialGradient(690, 155, 8, 690, 155, 190);
      sunGrad.addColorStop(0, 'rgba(255, 253, 240, 0.98)');
      sunGrad.addColorStop(0.18, 'rgba(254, 243, 199, 0.65)');
      sunGrad.addColorStop(0.55, 'rgba(224, 242, 254, 0.2)');
      sunGrad.addColorStop(1, 'rgba(224, 242, 254, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, 1024, 512);

      // Soft daytime cumulus clouds
      const cloudSpots = [
        [160, 210, 72, 24],
        [205, 198, 56, 22],
        [410, 235, 88, 22],
        [460, 225, 62, 20],
        [820, 220, 90, 24],
        [880, 230, 58, 18],
        [580, 175, 68, 18],
      ];
      for (const [cx, cy, rx, ry] of cloudSpots) {
        const cGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
        cGrad.addColorStop(0, 'rgba(255, 255, 255, 0.82)');
        cGrad.addColorStop(0.55, 'rgba(241, 245, 249, 0.45)');
        cGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.translate(-cx, -cy);
        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    this.skyTexture = new THREE.CanvasTexture(canvas);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(this.skyTexture);

    const skyGeo = new THREE.SphereGeometry(135, 32, 20);
    const skyMat = new THREE.MeshBasicMaterial({
      map: this.skyTexture,
      side: THREE.BackSide,
      fog: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.vrGroup.add(skyDome);
    this.disposables.push(skyGeo, skyMat);

    // Distant Seoul Skyline & Namsan Tower in clear daylight
    const skylineGroup = new THREE.Group();
    skylineGroup.position.set(22, 0, -76);

    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x7c8ea3,
      roughness: 0.65,
      metalness: 0.25,
    });
    const hillMat = new THREE.MeshStandardMaterial({
      color: 0x4d7c54,
      roughness: 0.9,
      metalness: 0.0,
    });
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.2,
      metalness: 0.6,
    });
    this.disposables.push(buildingMat, hillMat, windowMat);

    const heights = [10, 15, 8, 20, 13, 24, 11, 16, 9, 18, 12];
    heights.forEach((h, i) => {
      const w = 3.4 + (i % 3) * 1.1;
      const bGeo = new THREE.BoxGeometry(w, h, 3.2);
      const bMesh = new THREE.Mesh(bGeo, buildingMat);
      bMesh.position.set((i - 4) * 5.2, h / 2, (i % 2) * -3);
      skylineGroup.add(bMesh);
      this.disposables.push(bGeo);

      const glassGeo = new THREE.BoxGeometry(w * 0.78, h * 0.14, 0.18);
      const glassBand = new THREE.Mesh(glassGeo, windowMat);
      glassBand.position.set(bMesh.position.x, h * 0.78, bMesh.position.z + 1.62);
      skylineGroup.add(glassBand);
      this.disposables.push(glassGeo);
    });

    // Namsan Seoul Tower in daytime colors
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-10, 6, -4);
    const hillGeo = new THREE.ConeGeometry(14, 10, 16);
    const hillMesh = new THREE.Mesh(hillGeo, hillMat);
    hillMesh.position.y = -3;
    const shaftGeo = new THREE.CylinderGeometry(0.42, 0.62, 16, 12);
    const shaftMesh = new THREE.Mesh(shaftGeo, windowMat);
    shaftMesh.position.y = 8;
    const podGeo = new THREE.CylinderGeometry(1.9, 1.4, 2.3, 16);
    const podMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.18,
      roughness: 0.25,
      metalness: 0.45,
    });
    const podMesh = new THREE.Mesh(podGeo, podMat);
    podMesh.position.y = 14.5;
    const spireGeo = new THREE.CylinderGeometry(0.09, 0.22, 6.5, 8);
    const spireMesh = new THREE.Mesh(spireGeo, windowMat);
    spireMesh.position.y = 18.8;
    towerGroup.add(hillMesh, shaftMesh, podMesh, spireMesh);
    skylineGroup.add(towerGroup);
    this.disposables.push(hillGeo, shaftGeo, podGeo, podMat, spireGeo);
    this.vrGroup.add(skylineGroup);

    this.buildHangangBridge();
  }

  private buildHangangBridge(): void {
    // Realistic multi-span Hangang River Steel Arch & Girder Bridge (inspired by Hangang/Seogang Bridge)
    const bridgeGroup = new THREE.Group();
    bridgeGroup.position.set(0, 0, -38);

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.82,
      metalness: 0.08,
    });
    const darkConcreteMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.88,
      metalness: 0.05,
    });
    const girderSteelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.48,
      metalness: 0.55,
    });
    const archSteelMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.34,
      metalness: 0.42,
    });
    const archAccentMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.38,
      metalness: 0.35,
    });
    const cableMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.3,
      metalness: 0.7,
    });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfef9c3,
      emissive: 0xfef08a,
      emissiveIntensity: 0.2,
      roughness: 0.3,
    });

    // Bridge road deck texture (lanes + center median)
    const deckCanvas = document.createElement('canvas');
    deckCanvas.width = 512;
    deckCanvas.height = 128;
    const dctx = deckCanvas.getContext('2d');
    if (dctx) {
      dctx.fillStyle = '#3f4752';
      dctx.fillRect(0, 0, 512, 128);
      dctx.fillStyle = '#e2e8f0';
      dctx.fillRect(0, 10, 512, 4);
      dctx.fillRect(0, 114, 512, 4);
      dctx.fillStyle = '#facc15';
      dctx.fillRect(0, 61, 512, 6);
      dctx.fillStyle = 'rgba(248,250,252,0.75)';
      for (let x = 8; x < 512; x += 48) {
        dctx.fillRect(x, 35, 24, 3);
        dctx.fillRect(x, 90, 24, 3);
      }
    }
    const deckTex = new THREE.CanvasTexture(deckCanvas);
    deckTex.colorSpace = THREE.SRGBColorSpace;
    deckTex.wrapS = THREE.RepeatWrapping;
    deckTex.repeat.set(8, 1);

    const asphaltDeckMat = new THREE.MeshStandardMaterial({
      map: deckTex,
      roughness: 0.78,
      metalness: 0.05,
    });

    this.disposables.push(
      concreteMat,
      darkConcreteMat,
      girderSteelMat,
      archSteelMat,
      archAccentMat,
      cableMat,
      lampMat,
      deckTex,
      asphaltDeckMat
    );

    const bridgeSpanWidth = 108;
    const bridgeCenterX = 28;
    const deckY = 5.05;
    const deckDepth = 4.5;

    // 1. Continuous steel box girders underneath + concrete slab + asphalt roadway
    const girderGeo = new THREE.BoxGeometry(bridgeSpanWidth, 0.62, 0.55);
    const girderFront = new THREE.Mesh(girderGeo, girderSteelMat);
    girderFront.position.set(bridgeCenterX, deckY - 0.52, 1.38);
    const girderBack = new THREE.Mesh(girderGeo, girderSteelMat);
    girderBack.position.set(bridgeCenterX, deckY - 0.52, -1.38);

    const slabGeo = new THREE.BoxGeometry(bridgeSpanWidth, 0.34, deckDepth);
    const slabMesh = new THREE.Mesh(slabGeo, concreteMat);
    slabMesh.position.set(bridgeCenterX, deckY - 0.05, 0);

    const roadTopGeo = new THREE.PlaneGeometry(bridgeSpanWidth, deckDepth - 0.55);
    const roadTopMesh = new THREE.Mesh(roadTopGeo, asphaltDeckMat);
    roadTopMesh.rotation.x = -Math.PI / 2;
    roadTopMesh.position.set(bridgeCenterX, deckY + 0.13, 0);

    // Parapet barriers & metal guardrails along both sides
    const parapetGeo = new THREE.BoxGeometry(bridgeSpanWidth, 0.42, 0.22);
    const railGeo = new THREE.BoxGeometry(bridgeSpanWidth, 0.09, 0.09);
    const parapetFront = new THREE.Mesh(parapetGeo, concreteMat);
    parapetFront.position.set(bridgeCenterX, deckY + 0.3, deckDepth * 0.5 - 0.14);
    const parapetBack = new THREE.Mesh(parapetGeo, concreteMat);
    parapetBack.position.set(bridgeCenterX, deckY + 0.3, -deckDepth * 0.5 + 0.14);

    const railFront = new THREE.Mesh(railGeo, archSteelMat);
    railFront.position.set(bridgeCenterX, deckY + 0.68, deckDepth * 0.5 - 0.14);
    const railBack = new THREE.Mesh(railGeo, archSteelMat);
    railBack.position.set(bridgeCenterX, deckY + 0.68, -deckDepth * 0.5 + 0.14);

    bridgeGroup.add(
      girderFront,
      girderBack,
      slabMesh,
      roadTopMesh,
      parapetFront,
      parapetBack,
      railFront,
      railBack
    );
    this.disposables.push(girderGeo, slabGeo, roadTopGeo, parapetGeo, railGeo);

    // 2. Concrete Hammerhead Piers & River Cutwater Pile Caps (clear of the cycling path at x = -1.45..2.15)
    const pierXPositions = [-16, -4.2, 4.6, 15.6, 39.6, 51.6, 63.6, 75.6];
    const footingGeo = new THREE.CylinderGeometry(1.15, 1.38, 1.05, 6);
    const colGeo = new THREE.CylinderGeometry(0.44, 0.56, 4.2, 12);
    const pierCapGeo = new THREE.BoxGeometry(1.45, 0.68, 4.4);
    const pierTrimGeo = new THREE.BoxGeometry(1.52, 0.18, 4.48);

    for (const px of pierXPositions) {
      // Waterline cutwater footing (rotated so pointed edge faces river current)
      const footing = new THREE.Mesh(footingGeo, darkConcreteMat);
      footing.position.set(px, 0.22, 0);
      footing.scale.set(0.85, 1, 2.35);
      bridgeGroup.add(footing);

      // Twin tapered concrete columns
      const colFront = new THREE.Mesh(colGeo, concreteMat);
      colFront.position.set(px, 2.45, 1.35);
      const colBack = new THREE.Mesh(colGeo, concreteMat);
      colBack.position.set(px, 2.45, -1.35);

      // Hammerhead pier cap + blue structural bearing collar
      const cap = new THREE.Mesh(pierCapGeo, concreteMat);
      cap.position.set(px, deckY - 0.92, 0);
      const trim = new THREE.Mesh(pierTrimGeo, archAccentMat);
      trim.position.set(px, deckY - 0.58, 0);

      bridgeGroup.add(colFront, colBack, cap, trim);
    }
    this.disposables.push(footingGeo, colGeo, pierCapGeo, pierTrimGeo);

    // 3. Parabolic Steel Arch Spans over the Han River (Main Center Arch + Flanking Arches)
    const hangerGeo = new THREE.CylinderGeometry(0.036, 0.036, 1, 8);
    const strutGeo = new THREE.BoxGeometry(0.24, 0.24, 4.2);
    this.disposables.push(hangerGeo, strutGeo);

    const buildArchSpan = (
      xStart: number,
      xEnd: number,
      archRise: number,
      hangerCount: number,
      ribRadius: number,
      useBlueRib: boolean
    ) => {
      const spanLen = xEnd - xStart;
      const archAt = (t: number) => deckY + 0.1 + 4 * archRise * t * (1 - t);
      const mat = useBlueRib ? archAccentMat : archSteelMat;

      for (const zOff of [-2.05, 2.05]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          pts.push(new THREE.Vector3(xStart + t * spanLen, archAt(t), zOff));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tubeGeo = new THREE.TubeGeometry(curve, 32, ribRadius, 10, false);
        const ribMesh = new THREE.Mesh(tubeGeo, mat);
        bridgeGroup.add(ribMesh);
        this.disposables.push(tubeGeo);
      }

      // Vertical suspender hanger cables + overhead wind-bracing struts
      for (let i = 1; i < hangerCount; i++) {
        const t = i / hangerCount;
        const hx = xStart + t * spanLen;
        const hyTop = archAt(t);
        const cableLen = Math.max(0.2, hyTop - (deckY + 0.15));

        for (const zOff of [-2.05, 2.05]) {
          const cable = new THREE.Mesh(hangerGeo, cableMat);
          cable.scale.set(1, cableLen, 1);
          cable.position.set(hx, deckY + 0.15 + cableLen * 0.5, zOff);
          bridgeGroup.add(cable);
        }

        // Overhead lateral bracing struts on upper half of arch
        if (hyTop - deckY > archRise * 0.48) {
          const strut = new THREE.Mesh(strutGeo, archSteelMat);
          strut.position.set(hx, hyTop, 0);
          bridgeGroup.add(strut);
        }
      }
    };

    // Flanking river arch (left-side river span)
    buildArchSpan(4.6, 15.6, 4.6, 6, 0.2, false);
    // Grand iconic Hangang main arch span
    buildArchSpan(15.6, 39.6, 9.6, 12, 0.28, true);
    // Flanking river arch (right-side river span)
    buildArchSpan(39.6, 51.6, 4.8, 6, 0.2, false);

    // 4. Bridge deck streetlights every 8m
    const lampPoleGeo = new THREE.CylinderGeometry(0.045, 0.06, 2.3, 8);
    const lampArmGeo = new THREE.BoxGeometry(0.1, 0.08, 0.65);
    const lampBulbGeo = new THREE.BoxGeometry(0.18, 0.08, 0.24);
    this.disposables.push(lampPoleGeo, lampArmGeo, lampBulbGeo);

    for (let lx = -20; lx <= 74; lx += 9) {
      for (const side of [-1, 1]) {
        const zEdge = side * (deckDepth * 0.5 - 0.18);
        const pole = new THREE.Mesh(lampPoleGeo, archSteelMat);
        pole.position.set(lx, deckY + 1.3, zEdge);
        const arm = new THREE.Mesh(lampArmGeo, archSteelMat);
        arm.position.set(lx, deckY + 2.42, zEdge - side * 0.28);
        const bulb = new THREE.Mesh(lampBulbGeo, lampMat);
        bulb.position.set(lx, deckY + 2.36, zEdge - side * 0.52);
        bridgeGroup.add(pole, arm, bulb);
      }
    }

    this.vrGroup.add(bridgeGroup);
  }

  private buildRoadAndRiver(): void {
    // Procedural Hangang Cycling Lane texture (daylight asphalt)
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 512;
    roadCanvas.height = 1024;
    const ctx = roadCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#3b424d';
      ctx.fillRect(0, 0, 512, 1024);

      for (let i = 0; i < 4500; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 1024;
        const v = 50 + Math.floor(Math.random() * 28);
        ctx.fillStyle = `rgb(${v},${v + 4},${v + 9})`;
        ctx.fillRect(x, y, 2, 2);
      }

      // Korean bike path shoulders
      ctx.fillStyle = '#36685d';
      ctx.fillRect(14, 0, 46, 1024);
      ctx.fillRect(452, 0, 46, 1024);

      // Crisp white edge lines
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(60, 0, 10, 1024);
      ctx.fillRect(442, 0, 10, 1024);

      // Dashed yellow center divider
      ctx.fillStyle = '#facc15';
      for (let y = 32; y < 1024; y += 160) {
        ctx.fillRect(251, y, 10, 88);
      }

      // Subtle lane chevrons
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
      ctx.lineWidth = 8;
      for (const cy of [240, 750]) {
        ctx.beginPath();
        ctx.moveTo(135, cy + 42);
        ctx.lineTo(165, cy);
        ctx.lineTo(195, cy + 42);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(317, cy + 42);
        ctx.lineTo(347, cy);
        ctx.lineTo(377, cy + 42);
        ctx.stroke();
      }
    }

    this.roadTexture = new THREE.CanvasTexture(roadCanvas);
    this.roadTexture.colorSpace = THREE.SRGBColorSpace;
    this.roadTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.roadTexture.wrapT = THREE.RepeatWrapping;
    this.roadTexture.repeat.set(1, TRACK_LENGTH / 16);
    this.disposables.push(this.roadTexture);

    const roadGeo = new THREE.PlaneGeometry(3.6, TRACK_LENGTH);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      roughness: 0.76,
      metalness: 0.04,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(0.35, 0, -TRACK_LENGTH * 0.38);
    roadMesh.receiveShadow = true;
    this.vrGroup.add(roadMesh);
    this.disposables.push(roadGeo, roadMat);

    // Sunlit grass park bank (left) & concrete riverside curb (right)
    const grassGeo = new THREE.PlaneGeometry(40, TRACK_LENGTH);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x427a4b,
      roughness: 0.9,
      metalness: 0.0,
    });
    const grassLeft = new THREE.Mesh(grassGeo, grassMat);
    grassLeft.rotation.x = -Math.PI / 2;
    grassLeft.position.set(-21.4, -0.02, -TRACK_LENGTH * 0.38);
    grassLeft.receiveShadow = true;
    this.vrGroup.add(grassLeft);

    const bankGeo = new THREE.BoxGeometry(0.65, 0.22, TRACK_LENGTH);
    const bankMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.85,
      metalness: 0.05,
    });
    const bankMesh = new THREE.Mesh(bankGeo, bankMat);
    bankMesh.position.set(2.47, -0.08, -TRACK_LENGTH * 0.38);
    bankMesh.receiveShadow = true;
    this.vrGroup.add(bankMesh);
    this.disposables.push(grassGeo, grassMat, bankGeo, bankMat);

    // Daytime Han River with gentle flowing ripples on the right side
    const waterCanvas = document.createElement('canvas');
    waterCanvas.width = 512;
    waterCanvas.height = 512;
    const wctx = waterCanvas.getContext('2d');
    if (wctx) {
      const wGrad = wctx.createLinearGradient(0, 0, 512, 0);
      wGrad.addColorStop(0, '#1f7a9e');
      wGrad.addColorStop(0.5, '#2587ad');
      wGrad.addColorStop(1, '#1d6f91');
      wctx.fillStyle = wGrad;
      wctx.fillRect(0, 0, 512, 512);

      // Gentle calm ripple bands across the river surface
      for (let i = 0; i < 240; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const len = 18 + Math.random() * 44;
        const thick = 1.5 + Math.random() * 2.2;
        wctx.fillStyle =
          i % 3 === 0
            ? 'rgba(224, 242, 254, 0.34)'
            : i % 3 === 1
              ? 'rgba(125, 211, 252, 0.24)'
              : 'rgba(14, 116, 144, 0.22)';
        wctx.beginPath();
        wctx.ellipse(x, y, len * 0.5, thick, 0.08, 0, Math.PI * 2);
        wctx.fill();
      }
    }
    this.waterTexture = new THREE.CanvasTexture(waterCanvas);
    this.waterTexture.colorSpace = THREE.SRGBColorSpace;
    this.waterTexture.wrapS = THREE.RepeatWrapping;
    this.waterTexture.wrapT = THREE.RepeatWrapping;
    this.waterTexture.repeat.set(9, 24);
    this.disposables.push(this.waterTexture);

    const waterGeo = new THREE.PlaneGeometry(80, TRACK_LENGTH, 56, 110);
    const waterMat = new THREE.MeshStandardMaterial({
      map: this.waterTexture,
      color: 0x3898bf,
      roughness: 0.16,
      metalness: 0.52,
    });
    waterMat.customProgramCacheKey = () => 'hangang-day-water';
    waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterTime = this.waterUniforms.uWaterTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWaterTime;
          varying vec3 vWaterWorldPos;`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float wFreqA = 1.15;
          float wFreqB = 0.72;
          float dWaveX =
            0.024 * wFreqA * cos(position.x * wFreqA + position.y * 0.45 + uWaterTime * 1.35) +
            0.015 * 1.9 * cos(position.x * 1.9 - position.y * 0.8 + uWaterTime * 1.85);
          float dWaveY =
            0.024 * 0.45 * cos(position.x * wFreqA + position.y * 0.45 + uWaterTime * 1.35) -
            0.015 * 0.8 * cos(position.x * 1.9 - position.y * 0.8 + uWaterTime * 1.85) +
            0.018 * wFreqB * cos(position.y * wFreqB - uWaterTime * 1.55);
          objectNormal = normalize(vec3(-dWaveX, -dWaveY, 1.0));`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ripple1 = sin(position.x * 1.15 + position.y * 0.45 + uWaterTime * 1.35) * 0.024;
          float ripple2 = sin(position.x * 1.9 - position.y * 0.8 + uWaterTime * 1.85) * 0.015;
          float ripple3 = sin(position.y * 0.72 - uWaterTime * 1.55) * 0.018;
          transformed.z += ripple1 + ripple2 + ripple3;
          vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uWaterTime;
          varying vec3 vWaterWorldPos;`
        )
        .replace(
          '#include <fog_fragment>',
          `float shimmerA = sin(vWaterWorldPos.x * 1.55 + vWaterWorldPos.z * 0.9 - uWaterTime * 1.7);
          float shimmerB = sin(vWaterWorldPos.x * 2.4 - vWaterWorldPos.z * 1.35 + uWaterTime * 2.1);
          float crest = smoothstep(0.58, 0.98, 0.5 * (shimmerA + shimmerB));
          gl_FragColor.rgb += vec3(0.18, 0.28, 0.32) * crest;
          #include <fog_fragment>`
        );
    };

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.set(42.5, -0.1, -TRACK_LENGTH * 0.38);
    waterMesh.receiveShadow = true;
    this.vrGroup.add(waterMesh);
    this.disposables.push(waterGeo, waterMat);
  }

  private buildCherryTreeGeometries(): {
    trunkGeo: THREE.BufferGeometry;
    blossomGeo: THREE.BufferGeometry;
    innerGeo: THREE.BufferGeometry;
  } {
    // Gnarled cherry bark trunk + root flare + spreading multi-forked branches
    const trunkParts: THREE.BufferGeometry[] = [];
    const rootFlare = new THREE.CylinderGeometry(0.15, 0.27, 0.44, 8);
    rootFlare.translate(0, 0.22, 0);
    trunkParts.push(rootFlare);

    const lowerTrunk = new THREE.CylinderGeometry(0.115, 0.16, 1.12, 8);
    lowerTrunk.rotateZ(0.05);
    lowerTrunk.translate(-0.02, 0.9, 0);
    trunkParts.push(lowerTrunk);

    const upperFork = new THREE.CylinderGeometry(0.08, 0.115, 0.72, 7);
    upperFork.rotateZ(-0.06);
    upperFork.translate(-0.03, 1.65, 0);
    trunkParts.push(upperFork);

    const branchSpecs = [
      {yaw: 0.2, tilt: 0.68, len: 1.25, rTop: 0.028, rBot: 0.068, y: 1.48},
      {yaw: 1.45, tilt: 0.74, len: 1.32, rTop: 0.026, rBot: 0.064, y: 1.54},
      {yaw: 2.75, tilt: 0.64, len: 1.2, rTop: 0.028, rBot: 0.065, y: 1.5},
      {yaw: 4.05, tilt: 0.72, len: 1.28, rTop: 0.026, rBot: 0.064, y: 1.58},
      {yaw: 5.25, tilt: 0.6, len: 1.15, rTop: 0.028, rBot: 0.062, y: 1.62},
    ];
    for (const b of branchSpecs) {
      const limb = new THREE.CylinderGeometry(b.rTop, b.rBot, b.len, 6);
      limb.translate(0, b.len * 0.5, 0);
      limb.rotateZ(b.tilt);
      limb.rotateY(b.yaw);
      limb.translate(-0.03, b.y, 0);
      trunkParts.push(limb);
    }

    const trunkGeo = mergeGeometries(trunkParts);
    for (const g of trunkParts) g.dispose();

    // Layered billowy sakura blossom crown clusters at branch tips
    const blossomParts: THREE.BufferGeometry[] = [];
    const puffSpecs = [
      {x: 0.0, y: 2.88, z: 0.0, r: 0.76, sx: 1.22, sy: 0.78, sz: 1.18},
      {x: -0.78, y: 2.42, z: 0.24, r: 0.64, sx: 1.18, sy: 0.76, sz: 1.15},
      {x: 0.74, y: 2.46, z: -0.22, r: 0.66, sx: 1.2, sy: 0.75, sz: 1.12},
      {x: 0.18, y: 2.48, z: 0.82, r: 0.62, sx: 1.15, sy: 0.76, sz: 1.2},
      {x: -0.22, y: 2.44, z: -0.8, r: 0.64, sx: 1.18, sy: 0.74, sz: 1.18},
      {x: -0.58, y: 2.68, z: -0.45, r: 0.56, sx: 1.15, sy: 0.8, sz: 1.12},
      {x: 0.58, y: 2.7, z: 0.48, r: 0.56, sx: 1.15, sy: 0.8, sz: 1.12},
      {x: 0.45, y: 2.18, z: 0.56, r: 0.44, sx: 1.15, sy: 0.72, sz: 1.15},
      {x: -0.52, y: 2.16, z: -0.35, r: 0.44, sx: 1.15, sy: 0.72, sz: 1.15},
    ];
    for (const p of puffSpecs) {
      const puff = new THREE.IcosahedronGeometry(p.r, 1);
      puff.scale(p.sx, p.sy, p.sz);
      puff.translate(p.x, p.y, p.z);
      blossomParts.push(puff);
    }
    const blossomGeo = mergeGeometries(blossomParts);
    for (const g of blossomParts) g.dispose();

    // Inner sakura deeper-pink buds & young spring leaf clusters for crown depth
    const innerParts: THREE.BufferGeometry[] = [];
    const innerSpecs = [
      {x: -0.35, y: 2.22, z: 0.15, r: 0.34},
      {x: 0.38, y: 2.24, z: -0.18, r: 0.34},
      {x: 0.08, y: 2.34, z: 0.38, r: 0.32},
      {x: -0.1, y: 2.32, z: -0.36, r: 0.32},
      {x: 0.0, y: 2.58, z: 0.0, r: 0.38},
    ];
    for (const s of innerSpecs) {
      const bud = new THREE.IcosahedronGeometry(s.r, 0);
      bud.scale(1.25, 0.75, 1.2);
      bud.translate(s.x, s.y, s.z);
      innerParts.push(bud);
    }
    const innerGeo = mergeGeometries(innerParts);
    for (const g of innerParts) g.dispose();

    return {trunkGeo, blossomGeo, innerGeo};
  }

  private buildAcaciaTreeGeometries(): {
    trunkGeo: THREE.BufferGeometry;
    canopyGeo: THREE.BufferGeometry;
    blossomGeo: THREE.BufferGeometry;
  } {
    // Tall graceful Acacia trunk splitting into sweeping umbrella limbs
    const trunkParts: THREE.BufferGeometry[] = [];
    const rootFlare = new THREE.CylinderGeometry(0.14, 0.25, 0.42, 8);
    rootFlare.translate(0, 0.21, 0);
    trunkParts.push(rootFlare);

    const lowerTrunk = new THREE.CylinderGeometry(0.105, 0.15, 1.48, 8);
    lowerTrunk.rotateZ(-0.07);
    lowerTrunk.translate(0.05, 1.05, 0);
    trunkParts.push(lowerTrunk);

    const limbSpecs = [
      {yaw: 0.15, tilt: 0.74, len: 1.65, y: 1.58},
      {yaw: 1.75, tilt: 0.78, len: 1.72, y: 1.64},
      {yaw: 3.3, tilt: 0.72, len: 1.68, y: 1.6},
      {yaw: 4.85, tilt: 0.76, len: 1.64, y: 1.66},
      {yaw: 0.9, tilt: 0.35, len: 1.35, y: 1.72},
    ];
    for (const l of limbSpecs) {
      const limb = new THREE.CylinderGeometry(0.026, 0.068, l.len, 6);
      limb.translate(0, l.len * 0.5, 0);
      limb.rotateZ(l.tilt);
      limb.rotateY(l.yaw);
      limb.translate(0.08, l.y, 0);
      trunkParts.push(limb);
    }
    const trunkGeo = mergeGeometries(trunkParts);
    for (const g of trunkParts) g.dispose();

    // Wide, flat, horizontal tiered Acacia leaf umbrellas
    const canopyParts: THREE.BufferGeometry[] = [];
    const padSpecs = [
      {x: 0.05, y: 3.22, z: 0.0, r: 0.92, sx: 1.55, sy: 0.32, sz: 1.45},
      {x: -0.92, y: 2.78, z: 0.22, r: 0.74, sx: 1.5, sy: 0.3, sz: 1.38},
      {x: 0.98, y: 2.84, z: -0.18, r: 0.76, sx: 1.52, sy: 0.3, sz: 1.4},
      {x: 0.18, y: 2.74, z: 0.96, r: 0.7, sx: 1.45, sy: 0.28, sz: 1.45},
      {x: -0.18, y: 2.72, z: -0.94, r: 0.72, sx: 1.48, sy: 0.28, sz: 1.42},
      {x: -0.58, y: 3.04, z: -0.52, r: 0.64, sx: 1.4, sy: 0.3, sz: 1.35},
      {x: 0.62, y: 3.06, z: 0.55, r: 0.64, sx: 1.4, sy: 0.3, sz: 1.35},
    ];
    for (const p of padSpecs) {
      const pad = new THREE.IcosahedronGeometry(p.r, 1);
      pad.scale(p.sx, p.sy, p.sz);
      pad.translate(p.x, p.y, p.z);
      canopyParts.push(pad);
    }
    const canopyGeo = mergeGeometries(canopyParts);
    for (const g of canopyParts) g.dispose();

    // Hanging fragrant creamy-white Acacia blossom racemes beneath the foliage tiers
    const blossomParts: THREE.BufferGeometry[] = [];
    const racemeOffsets: Array<[number, number, number]> = [
      [-1.15, 2.52, 0.35],
      [-0.72, 2.55, -0.35],
      [-0.45, 2.82, -0.78],
      [0.05, 2.95, 0.28],
      [0.35, 2.92, -0.32],
      [0.78, 2.58, 0.15],
      [1.18, 2.6, -0.25],
      [0.22, 2.48, 1.12],
      [-0.25, 2.5, 0.85],
      [-0.18, 2.48, -1.08],
      [0.78, 2.82, 0.68],
      [-0.88, 2.6, 0.72],
    ];
    for (const [rx, ry, rz] of racemeOffsets) {
      const raceme = new THREE.ConeGeometry(0.11, 0.34, 6);
      raceme.rotateX(Math.PI); // Taper downward like real drooping acacia flower clusters
      raceme.translate(rx, ry, rz);
      blossomParts.push(raceme);
    }
    const blossomGeo = mergeGeometries(blossomParts);
    for (const g of blossomParts) g.dispose();

    return {trunkGeo, canopyGeo, blossomGeo};
  }

  private buildInstancedScenery(): void {
    // 1. Left roadside avenue trees (가로수) & deeper Hangang forest (숲):
    //    Detailed multi-branch Cherry Blossom trees (벚꽃나무) & Acacia trees (아카시아나무)
    const cherry = this.buildCherryTreeGeometries();
    const cherryTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x452724,
      roughness: 0.88,
      metalness: 0.04,
    });
    const cherryBlossomMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
    });
    const cherryInnerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.0,
    });

    this.cherryTrunksMesh = new THREE.InstancedMesh(
      cherry.trunkGeo,
      cherryTrunkMat,
      CHERRY_TREE_COUNT
    );
    this.cherryBlossomsMesh = new THREE.InstancedMesh(
      cherry.blossomGeo,
      cherryBlossomMat,
      CHERRY_TREE_COUNT
    );
    this.cherryInnerMesh = new THREE.InstancedMesh(
      cherry.innerGeo,
      cherryInnerMat,
      CHERRY_TREE_COUNT
    );
    this.cherryTrunksMesh.frustumCulled = false;
    this.cherryBlossomsMesh.frustumCulled = false;
    this.cherryInnerMesh.frustumCulled = false;

    const cherryTones = [0xfbcfe8, 0xf9a8d4, 0xfff1f2, 0xf472b6];
    const cherryInnerTones = [0xf472b6, 0xec4899, 0x86efac];

    const AVENUE_CHERRY_COUNT = 10;
    for (let i = 0; i < CHERRY_TREE_COUNT; i++) {
      if (i < AVENUE_CHERRY_COUNT) {
        // Cherry blossom trees lining the Hangang bike avenue
        this.cherryOffsetsZ.push(
          -SCENERY_SPAN * 0.8 + (i / AVENUE_CHERRY_COUNT) * SCENERY_SPAN
        );
        this.cherrySideX.push(-2.95 + (Math.random() - 0.5) * 0.32);
        this.cherryScales.push(0.95 + Math.random() * 0.22);
      } else {
        // Cherry blossom trees scattered inside the left forest
        const idx = i - AVENUE_CHERRY_COUNT;
        const total = CHERRY_TREE_COUNT - AVENUE_CHERRY_COUNT;
        this.cherryOffsetsZ.push(
          -SCENERY_SPAN * 0.8 + ((idx + Math.random() * 0.7) / total) * SCENERY_SPAN
        );
        this.cherrySideX.push(-5.5 - (idx % 3) * 2.9 - Math.random() * 1.8);
        this.cherryScales.push(1.0 + Math.random() * 0.48);
      }
      _color.setHex(cherryTones[i % cherryTones.length]);
      this.cherryBlossomsMesh.setColorAt(i, _color);
      _color.setHex(cherryInnerTones[i % cherryInnerTones.length]);
      this.cherryInnerMesh.setColorAt(i, _color);
    }
    if (this.cherryBlossomsMesh.instanceColor) {
      this.cherryBlossomsMesh.instanceColor.needsUpdate = true;
    }
    if (this.cherryInnerMesh.instanceColor) {
      this.cherryInnerMesh.instanceColor.needsUpdate = true;
    }

    this.vrGroup.add(
      this.cherryTrunksMesh,
      this.cherryBlossomsMesh,
      this.cherryInnerMesh
    );
    this.disposables.push(
      cherry.trunkGeo,
      cherryTrunkMat,
      cherry.blossomGeo,
      cherryBlossomMat,
      cherry.innerGeo,
      cherryInnerMat
    );

    // 1a-2. Acacia trees (아카시아나무) with flat tiered feathery foliage & white hanging blossoms
    const acacia = this.buildAcaciaTreeGeometries();
    const acaciaTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x5c4f42,
      roughness: 0.92,
      metalness: 0.02,
    });
    const acaciaCanopyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.0,
    });
    const acaciaBlossomMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.54,
      metalness: 0.0,
    });

    this.acaciaTrunksMesh = new THREE.InstancedMesh(
      acacia.trunkGeo,
      acaciaTrunkMat,
      ACACIA_TREE_COUNT
    );
    this.acaciaCanopyMesh = new THREE.InstancedMesh(
      acacia.canopyGeo,
      acaciaCanopyMat,
      ACACIA_TREE_COUNT
    );
    this.acaciaBlossomsMesh = new THREE.InstancedMesh(
      acacia.blossomGeo,
      acaciaBlossomMat,
      ACACIA_TREE_COUNT
    );
    this.acaciaTrunksMesh.frustumCulled = false;
    this.acaciaCanopyMesh.frustumCulled = false;
    this.acaciaBlossomsMesh.frustumCulled = false;

    const acaciaFlowerTones = [0xfefce8, 0xf8fafc, 0xfef9c3];
    const AVENUE_ACACIA_COUNT = 6;
    for (let i = 0; i < ACACIA_TREE_COUNT; i++) {
      if (i < AVENUE_ACACIA_COUNT) {
        // Acacia avenue trees interspersed along the roadside park border
        this.acaciaOffsetsZ.push(
          -SCENERY_SPAN * 0.8 +
            ((i + 0.5) / AVENUE_ACACIA_COUNT) * SCENERY_SPAN
        );
        this.acaciaSideX.push(-3.35 + (Math.random() - 0.5) * 0.35);
        this.acaciaScales.push(0.92 + Math.random() * 0.24);
      } else {
        // Taller Acacia canopy trees forming the Hangang forest grove
        const idx = i - AVENUE_ACACIA_COUNT;
        const total = ACACIA_TREE_COUNT - AVENUE_ACACIA_COUNT;
        this.acaciaOffsetsZ.push(
          -SCENERY_SPAN * 0.8 + ((idx + Math.random() * 0.7) / total) * SCENERY_SPAN
        );
        this.acaciaSideX.push(-6.2 - (idx % 4) * 2.6 - Math.random() * 2.1);
        this.acaciaScales.push(1.05 + Math.random() * 0.55);
      }
      _color.setHSL(
        0.29 + (Math.random() - 0.5) * 0.05,
        0.54,
        0.36 + Math.random() * 0.1
      );
      this.acaciaCanopyMesh.setColorAt(i, _color);
      _color.setHex(acaciaFlowerTones[i % acaciaFlowerTones.length]);
      this.acaciaBlossomsMesh.setColorAt(i, _color);
    }
    if (this.acaciaCanopyMesh.instanceColor) {
      this.acaciaCanopyMesh.instanceColor.needsUpdate = true;
    }
    if (this.acaciaBlossomsMesh.instanceColor) {
      this.acaciaBlossomsMesh.instanceColor.needsUpdate = true;
    }

    this.vrGroup.add(
      this.acaciaTrunksMesh,
      this.acaciaCanopyMesh,
      this.acaciaBlossomsMesh
    );
    this.disposables.push(
      acacia.trunkGeo,
      acaciaTrunkMat,
      acacia.canopyGeo,
      acaciaCanopyMat,
      acacia.blossomGeo,
      acaciaBlossomMat
    );

    // 1a-3. Drifting cherry & acacia blossom petals in the Hangang breeze
    const driftPetalGeo = new THREE.PlaneGeometry(0.055, 0.036);
    const driftPetalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    this.driftPetalsMesh = new THREE.InstancedMesh(
      driftPetalGeo,
      driftPetalMat,
      DRIFT_PETAL_COUNT
    );
    this.driftPetalsMesh.frustumCulled = false;

    const driftColors = [0xfbcfe8, 0xf9a8d4, 0xfff1f2, 0xfefce8];
    for (let i = 0; i < DRIFT_PETAL_COUNT; i++) {
      this.driftPetalOffsetsZ.push(
        -SCENERY_SPAN * 0.55 + Math.random() * (SCENERY_SPAN * 0.72)
      );
      this.driftPetalX.push(-1.8 - Math.random() * 7.5);
      this.driftPetalY.push(0.2 + Math.random() * 3.4);
      this.driftPetalPhases.push(Math.random() * Math.PI * 2);
      _color.setHex(driftColors[i % driftColors.length]);
      this.driftPetalsMesh.setColorAt(i, _color);
    }
    if (this.driftPetalsMesh.instanceColor) {
      this.driftPetalsMesh.instanceColor.needsUpdate = true;
    }
    this.vrGroup.add(this.driftPetalsMesh);
    this.disposables.push(driftPetalGeo, driftPetalMat);

    // 1b. Low park hedge cushions & colorful flowerbeds weaving under the trees and forest
    const shrubGeo = new THREE.DodecahedronGeometry(0.55, 1);
    const shrubMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
    });
    this.shrubsMesh = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_COUNT);
    this.shrubsMesh.frustumCulled = false;

    for (let i = 0; i < SHRUB_COUNT; i++) {
      this.shrubOffsetsZ.push(
        -SCENERY_SPAN * 0.8 + ((i + Math.random() * 0.8) / SHRUB_COUNT) * SCENERY_SPAN
      );
      const isRoadsideBed = i % 2 === 0;
      this.shrubSideX.push(
        isRoadsideBed
          ? -2.35 - Math.random() * 2.1
          : -5.0 - Math.random() * 8.5
      );
      this.shrubScales.push(0.65 + Math.random() * 0.65);
      _color.setHSL(0.31 + (Math.random() - 0.5) * 0.05, 0.54, 0.32 + Math.random() * 0.12);
      this.shrubsMesh.setColorAt(i, _color);
    }
    if (this.shrubsMesh.instanceColor) {
      this.shrubsMesh.instanceColor.needsUpdate = true;
    }
    this.vrGroup.add(this.shrubsMesh);
    this.disposables.push(shrubGeo, shrubMat);

    // Multi-part instanced 3D flowers (leafy stem + 5-petal blossom + warm center disc)
    const stemPart = new THREE.CylinderGeometry(0.013, 0.018, 0.28, 5);
    stemPart.translate(0, 0.14, 0);
    const leafA = new THREE.SphereGeometry(0.052, 6, 4);
    leafA.scale(0.55, 0.16, 1.35);
    leafA.rotateX(-0.45);
    leafA.rotateY(0.75);
    leafA.translate(0.036, 0.1, 0.032);
    const leafB = new THREE.SphereGeometry(0.048, 6, 4);
    leafB.scale(0.55, 0.16, 1.25);
    leafB.rotateX(-0.4);
    leafB.rotateY(-2.15);
    leafB.translate(-0.034, 0.13, -0.025);
    const flowerStemGeo = mergeGeometries([stemPart, leafA, leafB]);
    stemPart.dispose();
    leafA.dispose();
    leafB.dispose();

    const petalParts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const petal = new THREE.SphereGeometry(0.072, 7, 5);
      petal.scale(0.78, 0.22, 1.32);
      petal.rotateX(-0.24);
      petal.translate(0, 0.015, 0.075);
      petal.rotateY((k * Math.PI * 2) / 5);
      petalParts.push(petal);
    }
    const flowerPetalGeo = mergeGeometries(petalParts);
    for (const p of petalParts) p.dispose();

    const flowerCenterGeo = new THREE.SphereGeometry(0.044, 8, 6);
    flowerCenterGeo.scale(1, 0.52, 1);

    const flowerStemMat = new THREE.MeshStandardMaterial({
      color: 0x3f8f47,
      roughness: 0.8,
    });
    const flowerPetalMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.52,
      metalness: 0.0,
    });
    const flowerCenterMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
    });

    this.flowerStemsMesh = new THREE.InstancedMesh(
      flowerStemGeo,
      flowerStemMat,
      FLOWER_COUNT
    );
    this.flowerPetalsMesh = new THREE.InstancedMesh(
      flowerPetalGeo,
      flowerPetalMat,
      FLOWER_COUNT
    );
    this.flowerCentersMesh = new THREE.InstancedMesh(
      flowerCenterGeo,
      flowerCenterMat,
      FLOWER_COUNT
    );
    this.flowerStemsMesh.frustumCulled = false;
    this.flowerPetalsMesh.frustumCulled = false;
    this.flowerCentersMesh.frustumCulled = false;

    // Vivid Hangang seasonal flowerbed palettes (cosmos, tulips, rapeseed, iris, poppies, daisies)
    const flowerPalettes = [
      [0xf472b6, 0xec4899, 0xfbcfe8], // Pink cosmos bed
      [0xfacc15, 0xfde047, 0xfb923c], // Golden rapeseed & marigold bed
      [0xa855f7, 0xc084fc, 0x818cf8], // Lavender & iris violet bed
      [0xef4444, 0xf97316, 0xfbbf24], // Red & orange tulip bed
      [0x60a5fa, 0xf8fafc, 0xf472b6], // Sky cornflower, white daisy & pink mix
    ];

    for (let i = 0; i < FLOWER_COUNT; i++) {
      // Group flowers into rich colorful patches along the roadside trees and forest clearings
      const patchIdx = Math.floor(i / 18);
      const patchZ = -SCENERY_SPAN * 0.8 + ((patchIdx * 18) / FLOWER_COUNT) * SCENERY_SPAN;
      const inRoadsideBand = patchIdx % 2 === 0;
      const patchCenterX = inRoadsideBand
        ? -2.3 - (patchIdx % 3) * 0.85
        : -5.4 - (patchIdx % 5) * 1.75;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * (inRoadsideBand ? 1.15 : 2.15);
      const fx = Math.min(-2.1, patchCenterX + Math.cos(angle) * radius * 0.72);
      const fz = patchZ + Math.sin(angle) * radius * 2.1;

      this.flowerOffsetsZ.push(fz);
      this.flowerSideX.push(fx);
      this.flowerScales.push(0.78 + Math.random() * 0.62);
      this.flowerPhases.push(Math.random() * Math.PI * 2);

      const palette = flowerPalettes[patchIdx % flowerPalettes.length];
      const petalHex = palette[i % palette.length];
      _color.setHex(petalHex);
      this.flowerPetalsMesh.setColorAt(i, _color);

      // Contrasting warm golden or deep plum flower center
      _color.setHex(petalHex === 0xfacc15 || petalHex === 0xfde047 ? 0xb45309 : 0xfde047);
      this.flowerCentersMesh.setColorAt(i, _color);
    }
    if (this.flowerPetalsMesh.instanceColor) {
      this.flowerPetalsMesh.instanceColor.needsUpdate = true;
    }
    if (this.flowerCentersMesh.instanceColor) {
      this.flowerCentersMesh.instanceColor.needsUpdate = true;
    }

    this.vrGroup.add(
      this.flowerStemsMesh,
      this.flowerPetalsMesh,
      this.flowerCentersMesh
    );
    this.disposables.push(
      flowerStemGeo,
      flowerStemMat,
      flowerPetalGeo,
      flowerPetalMat,
      flowerCenterGeo,
      flowerCenterMat
    );

    // 2. Streetlights along Hangang park (daytime glass/steel)
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 4.2, 8);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.65,
      roughness: 0.35,
    });
    const bulbGeo = new THREE.SphereGeometry(0.16, 10, 10);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.25,
      metalness: 0.1,
    });

    this.lampsMesh = new THREE.InstancedMesh(poleGeo, poleMat, LAMP_COUNT);
    this.lampBulbsMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, LAMP_COUNT);
    this.lampsMesh.frustumCulled = false;
    this.lampBulbsMesh.frustumCulled = false;

    for (let i = 0; i < LAMP_COUNT; i++) {
      this.lampOffsetsZ.push(-SCENERY_SPAN * 0.8 + (i / LAMP_COUNT) * SCENERY_SPAN);
    }
    this.vrGroup.add(this.lampsMesh, this.lampBulbsMesh);
    this.disposables.push(poleGeo, poleMat, bulbGeo, bulbMat);

    // 3. Riverside safety bollards
    const bollardGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.72, 10);
    const bollardMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.5,
      roughness: 0.35,
    });
    this.bollardsMesh = new THREE.InstancedMesh(bollardGeo, bollardMat, BOLLARD_COUNT);
    this.bollardsMesh.frustumCulled = false;
    for (let i = 0; i < BOLLARD_COUNT; i++) {
      this.bollardOffsetsZ.push(-SCENERY_SPAN * 0.8 + (i / BOLLARD_COUNT) * SCENERY_SPAN);
    }
    this.vrGroup.add(this.bollardsMesh);
    this.disposables.push(bollardGeo, bollardMat);

    this.build5KmSignposts();
    this.updateInstancedScroll(0);
  }

  private createKmSignTexture(kmValue: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 680;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // High-contrast crisp white reflective face
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1024, 680);

      // Bold Hangang route navy-blue outer frame
      ctx.strokeStyle = '#075985';
      ctx.lineWidth = 26;
      ctx.strokeRect(14, 14, 996, 652);

      // Compact top header bar
      ctx.fillStyle = '#075985';
      ctx.fillRect(26, 26, 972, 92);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 48px "Google Sans", "Noto Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('한강 자전거길', 512, 73);

      // Massive ultra-bold distance numerals + distinct km unit
      const numStr = `${kmValue}`;
      const unitStr = 'km';
      ctx.font = '900 320px "Google Sans", "Noto Sans KR", sans-serif';
      const numWidth = ctx.measureText(numStr).width;
      ctx.font = '800 116px "Google Sans", "Noto Sans KR", sans-serif';
      const unitWidth = ctx.measureText(unitStr).width;
      const gap = 24;
      const totalWidth = numWidth + gap + unitWidth;
      const startX = 512 - totalWidth / 2;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '900 320px "Google Sans", "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#020617';
      ctx.fillText(numStr, startX, 456);

      ctx.font = '800 116px "Google Sans", "Noto Sans KR", sans-serif';
      ctx.fillStyle = '#0369a1';
      ctx.fillText(unitStr, startX + numWidth + gap, 452);

      // Compact emerald bottom direction strip
      ctx.fillStyle = '#047857';
      ctx.fillRect(26, 566, 972, 88);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 42px "Google Sans", "Noto Sans KR", sans-serif';
      ctx.fillText('반포 · 잠실 한강공원 방면 ↗', 512, 610);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.disposables.push(tex);
    return tex;
  }

  private build5KmSignposts(): void {
    // Pre-generate crisp 5km interval textures (5 km .. 50 km)
    for (let k = 1; k <= 10; k++) {
      this.signpostTextures.push(this.createKmSignTexture(k * 5));
    }

    const baseGeo = new THREE.BoxGeometry(0.28, 0.1, 0.24);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.85,
      metalness: 0.1,
    });
    const poleGeo = new THREE.CylinderGeometry(0.042, 0.048, 1.82, 12);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.32,
      metalness: 0.72,
    });
    const boardBackGeo = new THREE.BoxGeometry(1.18, 0.8, 0.044);
    const boardBackMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.45,
      metalness: 0.5,
    });
    const collarGeo = new THREE.BoxGeometry(0.12, 0.065, 0.095);
    const faceGeo = new THREE.PlaneGeometry(1.12, 0.74);

    this.disposables.push(
      baseGeo,
      baseMat,
      poleGeo,
      poleMat,
      boardBackGeo,
      boardBackMat,
      collarGeo,
      faceGeo
    );

    for (let i = 0; i < SIGNPOST_COUNT; i++) {
      const group = new THREE.Group();
      const kmIndex = i;
      const startZ = -8.5 - i * SIGNPOST_SPACING_M;

      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.set(0, 0.05, 0);

      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(0, 0.91, 0);

      const collarTop = new THREE.Mesh(collarGeo, poleMat);
      collarTop.position.set(0, 1.76, 0.015);
      const collarBottom = new THREE.Mesh(collarGeo, poleMat);
      collarBottom.position.set(0, 1.32, 0.015);

      const boardBack = new THREE.Mesh(boardBackGeo, boardBackMat);
      boardBack.position.set(0, 1.6, 0.036);

      const initialTex =
        this.signpostTextures[kmIndex % this.signpostTextures.length];
      const faceMat = new THREE.MeshStandardMaterial({
        map: initialTex,
        emissive: 0xffffff,
        emissiveMap: initialTex,
        emissiveIntensity: 0.48,
        roughness: 0.65,
        metalness: 0.0,
      });
      this.disposables.push(faceMat);

      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.set(0, 1.6, 0.06);

      group.add(base, pole, collarTop, collarBottom, boardBack, face);
      // Sit on the right concrete road curb (x = 2.56, y = 0.03), angled cleanly toward rider
      group.position.set(2.56, 0.03, startZ);
      group.rotation.y = -0.18;

      this.vrGroup.add(group);
      this.signposts.push({group, faceMat, z: startZ, kmIndex});
    }
  }

  private buildArPaceRibbon(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 256, 512);
      // Edge rails
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(10, 0, 6, 512);
      ctx.fillRect(240, 0, 6, 512);

      // Animated forward pace chevrons
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      for (const y of [100, 270, 440]) {
        ctx.beginPath();
        ctx.moveTo(64, y + 48);
        ctx.lineTo(128, y);
        ctx.lineTo(192, y + 48);
        ctx.stroke();
      }
    }

    this.arRibbonTexture = new THREE.CanvasTexture(canvas);
    this.arRibbonTexture.colorSpace = THREE.SRGBColorSpace;
    this.arRibbonTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.arRibbonTexture.wrapT = THREE.RepeatWrapping;
    this.arRibbonTexture.repeat.set(1, 14);
    this.disposables.push(this.arRibbonTexture);

    const ribbonGeo = new THREE.PlaneGeometry(1.1, 34);
    this.arRibbonMat = new THREE.MeshBasicMaterial({
      map: this.arRibbonTexture,
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, this.arRibbonMat);
    ribbonMesh.rotation.x = -Math.PI / 2;
    ribbonMesh.position.set(-0.52, 0.02, -14);
    this.arRibbonGroup.add(ribbonMesh);
    this.disposables.push(ribbonGeo, this.arRibbonMat);
  }

  private updateInstancedScroll(deltaZ: number): void {
    const zMin = -SCENERY_SPAN * 0.8;
    const zMax = SCENERY_SPAN * 0.2;

    if (
      this.cherryTrunksMesh &&
      this.cherryBlossomsMesh &&
      this.cherryInnerMesh
    ) {
      for (let i = 0; i < CHERRY_TREE_COUNT; i++) {
        let z = this.cherryOffsetsZ[i] + deltaZ;
        if (z > zMax) z -= SCENERY_SPAN;
        this.cherryOffsetsZ[i] = z;

        const s = this.cherryScales[i];
        _dummy.position.set(this.cherrySideX[i], -0.02, z);
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(0, i * 1.15, 0);
        _dummy.updateMatrix();
        this.cherryTrunksMesh.setMatrixAt(i, _dummy.matrix);
        this.cherryBlossomsMesh.setMatrixAt(i, _dummy.matrix);
        this.cherryInnerMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.cherryTrunksMesh.instanceMatrix.needsUpdate = true;
      this.cherryBlossomsMesh.instanceMatrix.needsUpdate = true;
      this.cherryInnerMesh.instanceMatrix.needsUpdate = true;
    }

    if (
      this.acaciaTrunksMesh &&
      this.acaciaCanopyMesh &&
      this.acaciaBlossomsMesh
    ) {
      for (let i = 0; i < ACACIA_TREE_COUNT; i++) {
        let z = this.acaciaOffsetsZ[i] + deltaZ;
        if (z > zMax) z -= SCENERY_SPAN;
        this.acaciaOffsetsZ[i] = z;

        const s = this.acaciaScales[i];
        _dummy.position.set(this.acaciaSideX[i], -0.02, z);
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(0, i * 0.85 + 0.4, 0);
        _dummy.updateMatrix();
        this.acaciaTrunksMesh.setMatrixAt(i, _dummy.matrix);
        this.acaciaCanopyMesh.setMatrixAt(i, _dummy.matrix);
        this.acaciaBlossomsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.acaciaTrunksMesh.instanceMatrix.needsUpdate = true;
      this.acaciaCanopyMesh.instanceMatrix.needsUpdate = true;
      this.acaciaBlossomsMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.driftPetalsMesh) {
      for (let i = 0; i < DRIFT_PETAL_COUNT; i++) {
        let z = this.driftPetalOffsetsZ[i] + deltaZ * 1.05;
        if (z > zMax) z -= SCENERY_SPAN;
        this.driftPetalOffsetsZ[i] = z;

        const phase = this.driftPetalPhases[i];
        const rawY = this.driftPetalY[i] - this.riverTime * 0.36;
        const yLoop = 0.12 + (((rawY % 3.45) + 3.45) % 3.45);
        const driftX =
          this.driftPetalX[i] + Math.sin(this.riverTime * 1.4 + phase) * 0.35;
        _dummy.position.set(driftX, yLoop, z);
        _dummy.scale.setScalar(0.85 + (i % 3) * 0.25);
        _dummy.rotation.set(
          this.riverTime * 1.9 + phase,
          this.riverTime * 1.3 + phase * 1.4,
          Math.sin(this.riverTime * 2.2 + phase) * 0.8
        );
        _dummy.updateMatrix();
        this.driftPetalsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.driftPetalsMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.shrubsMesh) {
      for (let i = 0; i < SHRUB_COUNT; i++) {
        let z = this.shrubOffsetsZ[i] + deltaZ;
        if (z > zMax) z -= SCENERY_SPAN;
        this.shrubOffsetsZ[i] = z;

        const s = this.shrubScales[i];
        _dummy.position.set(this.shrubSideX[i], 0.16 * s, z);
        _dummy.scale.set(s * 1.4, s * 0.62, s * 1.3);
        _dummy.rotation.set(0, i * 1.1, 0);
        _dummy.updateMatrix();
        this.shrubsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.shrubsMesh.instanceMatrix.needsUpdate = true;
    }

    if (
      this.flowerStemsMesh &&
      this.flowerPetalsMesh &&
      this.flowerCentersMesh
    ) {
      for (let i = 0; i < FLOWER_COUNT; i++) {
        let z = this.flowerOffsetsZ[i] + deltaZ;
        while (z > zMax) z -= SCENERY_SPAN;
        while (z < zMin) z += SCENERY_SPAN;
        this.flowerOffsetsZ[i] = z;

        const s = this.flowerScales[i];
        const fx = this.flowerSideX[i];
        const phase = this.flowerPhases[i];
        const swayX = Math.sin(this.riverTime * 2.1 + phase) * 0.08;
        const swayZ = Math.cos(this.riverTime * 1.7 + phase) * 0.06;

        _dummy.position.set(fx, -0.02, z);
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(swayX, phase, swayZ);
        _dummy.updateMatrix();
        this.flowerStemsMesh.setMatrixAt(i, _dummy.matrix);

        // Blossom top sits at the tip of the 0.28m swayed stem
        const tipX = fx + Math.sin(swayZ) * -0.27 * s;
        const tipY = -0.02 + 0.275 * s;
        const tipZ = z + Math.sin(swayX) * 0.27 * s;
        _dummy.position.set(tipX, tipY, tipZ);
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(swayX + 0.12, phase, swayZ);
        _dummy.updateMatrix();
        this.flowerPetalsMesh.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(tipX, tipY + 0.015 * s, tipZ);
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(swayX + 0.12, phase, swayZ);
        _dummy.updateMatrix();
        this.flowerCentersMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.flowerStemsMesh.instanceMatrix.needsUpdate = true;
      this.flowerPetalsMesh.instanceMatrix.needsUpdate = true;
      this.flowerCentersMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.lampsMesh && this.lampBulbsMesh) {
      for (let i = 0; i < LAMP_COUNT; i++) {
        let z = this.lampOffsetsZ[i] + deltaZ;
        if (z > zMax) z -= SCENERY_SPAN;
        this.lampOffsetsZ[i] = z;

        _dummy.position.set(-1.95, 2.1, z);
        _dummy.scale.set(1, 1, 1);
        _dummy.rotation.set(0, 0, 0);
        _dummy.updateMatrix();
        this.lampsMesh.setMatrixAt(i, _dummy.matrix);

        _dummy.position.set(-1.68, 4.18, z);
        _dummy.updateMatrix();
        this.lampBulbsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.lampsMesh.instanceMatrix.needsUpdate = true;
      this.lampBulbsMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.bollardsMesh) {
      for (let i = 0; i < BOLLARD_COUNT; i++) {
        let z = this.bollardOffsetsZ[i] + deltaZ;
        if (z > zMax) z -= SCENERY_SPAN;
        this.bollardOffsetsZ[i] = z;

        _dummy.position.set(2.22, 0.36, z);
        _dummy.scale.set(1, 1, 1);
        _dummy.rotation.set(0, 0, 0);
        _dummy.updateMatrix();
        this.bollardsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.bollardsMesh.instanceMatrix.needsUpdate = true;
    }

    for (const sign of this.signposts) {
      sign.z += deltaZ;
      if (sign.z > zMax) {
        sign.z -= SCENERY_SPAN;
        sign.kmIndex =
          (sign.kmIndex + SIGNPOST_COUNT) % this.signpostTextures.length;
        const nextTex = this.signpostTextures[sign.kmIndex];
        sign.faceMat.map = nextTex;
        sign.faceMat.emissiveMap = nextTex;
        sign.faceMat.needsUpdate = true;
      }
      sign.group.position.z = sign.z;
    }

    void zMin;
  }

  private disablePointerEventsRecursively(root: THREE.Object3D): void {
    root.traverse((obj) => {
      obj.xb = {...obj.xb, pointerEvents: 'none'};
    });
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
    if (this.envMapTexture) {
      this.envMapTexture.dispose();
      this.envMapTexture = null;
    }
  }
}
