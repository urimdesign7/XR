import * as THREE from 'three';
import * as xb from 'xrblocks';
import {BIKE_PROFILES} from '../physics/BikeBiomechanics.ts';
import {
  BikeFocusPart,
  BikeModelId,
  BikeSetupState,
  CyclingTelemetry,
} from '../types.ts';

const WHEEL_RADIUS = 0.24;
const CRANK_LENGTH = 0.115;
const WHEELBASE_HALF = 0.345;
const BB_POS = new THREE.Vector3(-0.02, WHEEL_RADIUS - 0.03, 0);
const SEAT_TUBE_TOP = new THREE.Vector3(-0.14, 0.565, 0);
const HEAD_TUBE_TOP = new THREE.Vector3(0.215, 0.575, 0);
const HEAD_TUBE_BOTTOM = new THREE.Vector3(0.245, 0.455, 0);

const DEFAULT_VIEWER_POS = new THREE.Vector3(0.36, 1.33, -1.26);
const DEFAULT_CONTROLS_POS = new THREE.Vector3(0.36, 0.72, -1.1);
const DEFAULT_VIEWER_SCALE = 1.38;
const MIN_VIEWER_SCALE = 0.72;
const MAX_VIEWER_SCALE = 2.05;

const _upVec = new THREE.Vector3(0, 1, 0);
const _dirVec = new THREE.Vector3();
const _targetColor = new THREE.Color();

export interface BikeShowroomCallbacks {
  onSelectBikeModel?: (id: BikeModelId) => void;
  onFocusPart?: (part: BikeFocusPart) => void;
  onBackToRiding?: () => void;
}

export class BikeShowroomViewer extends xb.Script {
  private callbacks: BikeShowroomCallbacks;
  private modelViewer!: xb.ModelViewer;
  private bikeContentRoot = new THREE.Group();
  private tiltPivot = new THREE.Group();
  private bikeAssembly = new THREE.Group();

  private frontWheelGroup = new THREE.Group();
  private rearWheelGroup = new THREE.Group();
  private rearTireMesh: THREE.Mesh | null = null;
  private crankGroup = new THREE.Group();
  private rightPedalGroup = new THREE.Group();
  private leftPedalGroup = new THREE.Group();
  private rightCleatMarker: THREE.Mesh | null = null;
  private leftCleatMarker: THREE.Mesh | null = null;
  private saddleGroup = new THREE.Group();
  private optimalSaddleGhost = new THREE.Group();

  private frameAccentMat: THREE.MeshStandardMaterial | null = null;
  private tireHaloMat: THREE.MeshBasicMaterial | null = null;
  private tireResistanceRing: THREE.Mesh | null = null;
  private drivetrainMat: THREE.MeshBasicMaterial | null = null;
  private drivetrainRing: THREE.Mesh | null = null;
  private saddleHighlightMat: THREE.MeshBasicMaterial | null = null;
  private saddleHighlightRing: THREE.Mesh | null = null;

  private controlsCard!: xb.UICard;
  private bikeModelButtons = new Map<BikeModelId, xb.UIButton>();
  private autoRotateBtn!: xb.UIButton;
  private zoomLabel!: xb.UIText;
  private angleLabel!: xb.UIText;

  private setup: BikeSetupState = {
    saddleOffsetMm: 18,
    cadenceRpm: 62,
    tirePsi: 70,
    cleatOffsetMm: 8,
  };
  private telemetry: CyclingTelemetry | null = null;
  private lastBikeId: BikeModelId = 'aero-road';

  private crankAngle = 0;
  private wheelAngle = 0;
  private pulseTime = 0;

  private autoRotate = true;
  private targetYawOffset = 0.55; // Start at flattering 3/4 view
  private currentYawOffset = 0.55;
  private targetPitch = 0.1;
  private currentPitch = 0.1;
  private lastZoomPct = 100;
  private activeFocusPart: BikeFocusPart = 'all';

  private disposables: Array<{dispose: () => void}> = [];

  private onWheel = (event: WheelEvent): void => {
    if (!this.visible) return;
    const pointingViewer =
      Boolean(this.modelViewer) && xb.core.user?.isPointingAt(this.modelViewer);
    const pointingControls =
      Boolean(this.controlsCard) && xb.core.user?.isPointingAt(this.controlsCard);
    if (!pointingViewer && !pointingControls) return;

    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    this.adjustZoom(factor);
  };

  constructor(callbacks: BikeShowroomCallbacks = {}) {
    super();
    this.callbacks = callbacks;
    this.name = 'Bike 3D Showroom';
  }

  public init(): void {
    this.buildShowroomBike();

    // Wrap the 3D bicycle assembly in xb.ModelViewer for native turntable rotation,
    // platform drag translation, and multi-source scaling.
    this.modelViewer = new xb.ModelViewer({
      origin: 'center',
      platformMargin: {x: 0.24, y: 0.24},
      manipulation: {
        actions: {
          translate: true,
          rotate: {axis: 'y'},
          scale: {minScale: MIN_VIEWER_SCALE, maxScale: MAX_VIEWER_SCALE},
        },
        handle: {action: xb.ManipulationAction.Rotate},
      },
    });
    this.modelViewer.name = 'Rotatable 3D Bike';
    this.modelViewer.position.copy(DEFAULT_VIEWER_POS);
    this.modelViewer.scale.setScalar(DEFAULT_VIEWER_SCALE);
    this.add(this.modelViewer);

    this.tiltPivot.add(this.bikeAssembly);
    this.bikeContentRoot.add(this.tiltPivot);
    this.modelViewer.setContent(this.bikeContentRoot);

    this.buildControlsCard();

    window.addEventListener('wheel', this.onWheel, {
      passive: false,
      capture: true,
    });
  }

  public getControlsCardRoot(): xb.UICard {
    return this.controlsCard;
  }

  public setScreenVisible(visible: boolean): void {
    this.visible = visible;
    if (this.modelViewer) {
      this.modelViewer.visible = visible;
    }
    if (this.controlsCard) {
      this.controlsCard.visible = visible;
    }
  }

  public setState(setup: BikeSetupState, telemetry: CyclingTelemetry): void {
    this.setup = setup;
    this.telemetry = telemetry;
    if (telemetry.bikeProfile.id !== this.lastBikeId) {
      this.lastBikeId = telemetry.bikeProfile.id;
      this.refreshBikeModelButtons(this.lastBikeId);
    }
  }

  public highlightPart(part: BikeFocusPart): void {
    this.activeFocusPart = part;
    // Rotate smoothly toward the most informative angle for that component
    if (part === 'saddle') {
      this.autoRotate = false;
      this.targetYawOffset = 0.25;
      this.targetPitch = 0.14;
    } else if (part === 'ankle') {
      this.autoRotate = false;
      this.targetYawOffset = -0.15;
      this.targetPitch = 0.08;
    } else if (part === 'tire') {
      this.autoRotate = false;
      this.targetYawOffset = 0.72;
      this.targetPitch = -0.05;
    }
    this.updateAutoRotateButtonLabel();
  }

  public update(): void {
    if (!this.visible) return;
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    this.pulseTime += dt;

    // Pause automatic spin while user drags/rotates the 3D bike directly
    const isUserManipulating =
      Boolean(this.modelViewer) && xb.core.user?.isManipulating(this.modelViewer);
    if (this.autoRotate && !isUserManipulating) {
      this.targetYawOffset += dt * 0.42;
    }

    this.currentYawOffset = THREE.MathUtils.lerp(
      this.currentYawOffset,
      this.targetYawOffset,
      0.14
    );
    this.currentPitch = THREE.MathUtils.lerp(
      this.currentPitch,
      this.targetPitch,
      0.14
    );
    this.tiltPivot.rotation.set(this.currentPitch, this.currentYawOffset, 0);

    // Live mechanical animation synced to optimization state
    const rpm = this.setup.cadenceRpm;
    const speedKmh = this.telemetry?.speedKmh ?? 22;
    const optScore = (this.telemetry?.optimizationScore ?? 40) / 100;
    const optPsi = this.telemetry?.bikeProfile?.optimalTirePsi ?? 98;

    const crankRadPerSec = (rpm / 60) * Math.PI * 2;
    this.crankAngle -= crankRadPerSec * dt;
    this.crankGroup.rotation.z = this.crankAngle;
    this.rightPedalGroup.rotation.z = -this.crankAngle;
    this.leftPedalGroup.rotation.z = -this.crankAngle;

    const wheelSpeedRad = ((speedKmh * 1000) / 3600) / WHEEL_RADIUS;
    this.wheelAngle -= wheelSpeedRad * dt;
    this.frontWheelGroup.rotation.z = this.wheelAngle;
    this.rearWheelGroup.rotation.z = this.wheelAngle;

    // Saddle height + cyan optimal ghost
    const saddleShift = (this.setup.saddleOffsetMm / 25) * 0.045;
    this.saddleGroup.position.set(
      SEAT_TUBE_TOP.x - saddleShift * 0.32,
      SEAT_TUBE_TOP.y + 0.08 + saddleShift,
      0
    );
    this.optimalSaddleGhost.visible = Math.abs(this.setup.saddleOffsetMm) > 3;

    // Cleat marker fore/aft shift on pedals
    const cleatShift = (this.setup.cleatOffsetMm / 10) * 0.022;
    if (this.rightCleatMarker) {
      this.rightCleatMarker.position.x = -cleatShift;
    }
    if (this.leftCleatMarker) {
      this.leftCleatMarker.position.x = -cleatShift;
    }

    // Frame accent color synced with selected bike model
    if (this.frameAccentMat && this.telemetry?.bikeProfile) {
      _targetColor.setHex(this.telemetry.bikeProfile.frameColorHex);
      this.frameAccentMat.color.lerp(_targetColor, 0.14);
    }

    // Rear tire compression + rolling resistance halo
    const psiDeficit = Math.max(0, (optPsi - this.setup.tirePsi) / 33);
    if (this.rearTireMesh) {
      this.rearTireMesh.scale.set(
        1 + psiDeficit * 0.02,
        1 - psiDeficit * 0.048,
        1 + psiDeficit * 0.035
      );
    }
    if (this.tireResistanceRing && this.tireHaloMat) {
      const pulse = 1 + Math.sin(this.pulseTime * 4.5) * 0.07 * (psiDeficit + 0.25);
      this.tireResistanceRing.scale.setScalar((0.88 + psiDeficit * 0.45) * pulse);
      _targetColor.setHex(
        this.activeFocusPart === 'tire'
          ? 0xfef08a
          : psiDeficit > 0.25
            ? 0xf59e0b
            : 0x22d3ee
      );
      this.tireHaloMat.color.lerp(_targetColor, 0.14);
      this.tireHaloMat.opacity =
        this.activeFocusPart === 'tire' ? 0.78 : 0.32 + psiDeficit * 0.42;
    }

    if (this.drivetrainRing && this.drivetrainMat) {
      _targetColor.setHex(
        this.activeFocusPart === 'ankle'
          ? 0xfef08a
          : optScore >= 0.85
            ? 0x22d3ee
            : 0xf97316
      );
      this.drivetrainMat.color.lerp(_targetColor, 0.12);
      this.drivetrainMat.opacity = this.activeFocusPart === 'ankle' ? 0.85 : 0.52;
      this.drivetrainRing.rotation.z = this.crankAngle * 0.5;
    }

    if (this.saddleHighlightRing && this.saddleHighlightMat) {
      const saddleErr = Math.abs(this.setup.saddleOffsetMm);
      _targetColor.setHex(
        this.activeFocusPart === 'saddle'
          ? 0xfef08a
          : saddleErr <= 3
            ? 0x22d3ee
            : 0xf97316
      );
      this.saddleHighlightMat.color.lerp(_targetColor, 0.14);
      this.saddleHighlightRing.position.copy(this.saddleGroup.position);
      this.saddleHighlightRing.position.y += 0.015;
    }

    // Sync HUD labels cleanly
    const zoomPct = Math.round(
      (this.modelViewer.scale.x / DEFAULT_VIEWER_SCALE) * 100
    );
    if (zoomPct !== this.lastZoomPct) {
      this.lastZoomPct = zoomPct;
      this.zoomLabel.text = `${zoomPct}%`;
    }
    const deg =
      ((Math.round(
        THREE.MathUtils.radToDeg(
          this.currentYawOffset + this.modelViewer.rotation.y
        )
      ) %
        360) +
        360) %
      360;
    this.angleLabel.text = `회전 ${deg}° · 기울기 ${Math.round(THREE.MathUtils.radToDeg(this.currentPitch))}°`;
  }

  private buildControlsCard(): void {
    const modelButtons = BIKE_PROFILES.map((profile, idx) => {
      const btn = new xb.UIButton({
        label: profile.shortName,
        icon: 'directions_bike',
        pointerEvents: 'auto',
        style: {
          flexGrow: 1,
          height: 34,
          borderRadius: 14,
          backgroundColor:
            idx === 0 ? 'rgba(2, 132, 199, 0.88)' : 'rgba(255, 255, 255, 0.09)',
        },
        onClick: () => {
          this.callbacks.onSelectBikeModel?.(profile.id);
        },
      });
      this.bikeModelButtons.set(profile.id, btn);
      return btn;
    });

    this.angleLabel = new xb.UIText({
      text: '회전 32° · 기울기 6°',
      pointerEvents: 'none',
      style: {fontSize: 13, fontWeight: 'bold', color: '#7dd3fc'},
    });

    this.zoomLabel = new xb.UIText({
      text: '100%',
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#e2e8f0',
        minWidth: 42,
        textAlign: 'center',
      },
    });

    this.autoRotateBtn = new xb.UIButton({
      label: '자동 회전 ON',
      icon: '360',
      pointerEvents: 'auto',
      style: {
        flexGrow: 1,
        height: 34,
        borderRadius: 12,
        backgroundColor: 'rgba(2, 132, 199, 0.72)',
      },
      onClick: () => {
        this.autoRotate = !this.autoRotate;
        this.updateAutoRotateButtonLabel();
      },
    });

    const rotLeftBtn = new xb.UIButton({
      label: '◀ 45°',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 34, borderRadius: 12},
      onClick: () => {
        this.autoRotate = false;
        this.updateAutoRotateButtonLabel();
        this.targetYawOffset -= Math.PI / 4;
      },
    });

    const rotRightBtn = new xb.UIButton({
      label: '45° ▶',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 34, borderRadius: 12},
      onClick: () => {
        this.autoRotate = false;
        this.updateAutoRotateButtonLabel();
        this.targetYawOffset += Math.PI / 4;
      },
    });

    const tiltUpBtn = new xb.UIButton({
      label: '위 ▲',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 34, borderRadius: 12},
      onClick: () => {
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + 0.16, -0.55, 0.62);
      },
    });

    const tiltDownBtn = new xb.UIButton({
      label: '아래 ▼',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 34, borderRadius: 12},
      onClick: () => {
        this.targetPitch = THREE.MathUtils.clamp(this.targetPitch - 0.16, -0.55, 0.62);
      },
    });

    const sidePresetBtn = new xb.UIButton({
      label: '측면',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 32, borderRadius: 12},
      onClick: () => this.setViewPreset(0, 0.04),
    });

    const frontPresetBtn = new xb.UIButton({
      label: '정면',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 32, borderRadius: 12},
      onClick: () => this.setViewPreset(-Math.PI / 2, 0.08),
    });

    const rearPresetBtn = new xb.UIButton({
      label: '후면',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 32, borderRadius: 12},
      onClick: () => this.setViewPreset(Math.PI / 2, 0.1),
    });

    const drivePresetBtn = new xb.UIButton({
      label: '구동계(우)',
      pointerEvents: 'auto',
      style: {flexGrow: 1, height: 32, borderRadius: 12},
      onClick: () => this.setViewPreset(0.15, 0.08),
    });

    const zoomOutBtn = new xb.UIButton({
      icon: 'zoom_out',
      ariaLabel: '자전거 축소',
      pointerEvents: 'auto',
      style: {width: 32, height: 32, padding: 0, borderRadius: 16},
      onClick: () => this.adjustZoom(1 / 1.15),
    });

    const zoomInBtn = new xb.UIButton({
      icon: 'zoom_in',
      ariaLabel: '자전거 확대',
      pointerEvents: 'auto',
      style: {width: 32, height: 32, padding: 0, borderRadius: 16},
      onClick: () => this.adjustZoom(1.15),
    });

    const resetViewBtn = new xb.UIButton({
      label: '초기화',
      icon: 'restart_alt',
      pointerEvents: 'auto',
      style: {height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 12},
      onClick: () => this.resetView(),
    });

    const headerRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
      children: [
        new xb.UIText({
          text: '3D 자전거 회전 뷰어',
          pointerEvents: 'none',
          style: {fontSize: 18, fontWeight: 'bold', color: '#ffffff'},
        }),
        this.angleLabel,
      ],
    });

    const modelRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 8},
      children: modelButtons,
    });

    const rotateRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [rotLeftBtn, rotRightBtn, tiltUpBtn, tiltDownBtn, this.autoRotateBtn],
    });

    const presetRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      },
      children: [
        sidePresetBtn,
        drivePresetBtn,
        frontPresetBtn,
        rearPresetBtn,
        zoomOutBtn,
        this.zoomLabel,
        zoomInBtn,
        resetViewBtn,
      ],
    });

    const partRow = new xb.UIPanel({
      style: {width: '100%', flexDirection: 'row', gap: 6},
      children: [
        new xb.UIButton({
          label: '안장 확대·확인',
          icon: 'airline_seat_recline_normal',
          pointerEvents: 'auto',
          style: {flexGrow: 1, height: 32, borderRadius: 12},
          onClick: () => {
            this.highlightPart('saddle');
            this.callbacks.onFocusPart?.('saddle');
          },
        }),
        new xb.UIButton({
          label: '기어·클릿 확인',
          icon: 'settings',
          pointerEvents: 'auto',
          style: {flexGrow: 1, height: 32, borderRadius: 12},
          onClick: () => {
            this.highlightPart('ankle');
            this.callbacks.onFocusPart?.('ankle');
          },
        }),
        new xb.UIButton({
          label: '타이어 공기압',
          icon: 'tire_repair',
          pointerEvents: 'auto',
          style: {flexGrow: 1, height: 32, borderRadius: 12},
          onClick: () => {
            this.highlightPart('tire');
            this.callbacks.onFocusPart?.('tire');
          },
        }),
      ],
    });

    const hintText = new xb.UIText({
      text: '3D 자전거 드래그 360° 회전 · 하단 원판 이동 · 휠 확대/축소 · ESC 키로 주행 복귀',
      pointerEvents: 'none',
      style: {
        width: '100%',
        fontSize: 12,
        color: '#94a3b8',
        textAlign: 'center',
      },
    });

    this.controlsCard = new xb.UICard({
      size: {width: 0.92, height: 'auto'},
      manipulation: {
        actions: {
          translate: {
            faceCamera: true,
            scaleWithDistance: true,
            minDistance: 0.45,
            maxDistance: 2.8,
          },
          scale: {minScale: 0.65, maxScale: 1.8},
        },
      },
      edge: {translateFromSurface: true},
      style: {
        flexDirection: 'column',
        gap: 8,
        padding: 14,
        borderRadius: 20,
        backgroundColor: 'rgba(9, 14, 26, 0.86)',
      },
      children: [headerRow, modelRow, rotateRow, presetRow, partRow, hintText],
    });

    this.controlsCard.name = '3D Bike Controls Dock';
    this.controlsCard.position.copy(DEFAULT_CONTROLS_POS);
    this.controlsCard.rotation.set(-0.14, -0.14, 0);
    this.add(this.controlsCard);
  }

  private setViewPreset(yaw: number, pitch: number): void {
    this.autoRotate = false;
    this.updateAutoRotateButtonLabel();
    this.modelViewer.rotation.y = 0;
    this.targetYawOffset = yaw;
    this.targetPitch = pitch;
  }

  private resetView(): void {
    this.activeFocusPart = 'all';
    this.autoRotate = true;
    this.updateAutoRotateButtonLabel();
    this.modelViewer.position.copy(DEFAULT_VIEWER_POS);
    this.modelViewer.rotation.set(0, 0, 0);
    this.modelViewer.scale.setScalar(DEFAULT_VIEWER_SCALE);
    this.targetYawOffset = 0.55;
    this.targetPitch = 0.1;
  }

  private adjustZoom(factor: number): void {
    if (!this.modelViewer) return;
    const minAbs = DEFAULT_VIEWER_SCALE * MIN_VIEWER_SCALE;
    const maxAbs = DEFAULT_VIEWER_SCALE * MAX_VIEWER_SCALE;
    const nextScale = THREE.MathUtils.clamp(
      this.modelViewer.scale.x * factor,
      minAbs,
      maxAbs
    );
    this.modelViewer.scale.setScalar(nextScale);
  }

  private updateAutoRotateButtonLabel(): void {
    if (!this.autoRotateBtn) return;
    this.autoRotateBtn.label = this.autoRotate ? '자동 회전 ON' : '자동 회전 OFF';
    this.autoRotateBtn.style.backgroundColor = this.autoRotate
      ? 'rgba(2, 132, 199, 0.72)'
      : 'rgba(255, 255, 255, 0.09)';
  }

  private refreshBikeModelButtons(activeId: BikeModelId): void {
    for (const [id, btn] of this.bikeModelButtons.entries()) {
      btn.style.backgroundColor =
        id === activeId ? 'rgba(2, 132, 199, 0.88)' : 'rgba(255, 255, 255, 0.09)';
    }
  }

  private buildShowroomBike(): void {
    this.buildTurntableRing();
    this.buildFrameAndCockpit();
    this.buildWheelsAndDiscBrakes();
    this.buildSaddleAndGhost();
    this.buildDetailedDrivetrain();
    this.buildBottlesAndCages();
  }

  private buildTurntableRing(): void {
    const ringGeo = new THREE.RingGeometry(0.47, 0.51, 56);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.bikeAssembly.add(ring);

    const tickGeo = new THREE.BoxGeometry(0.012, 0.004, 0.045);
    for (let i = 0; i < 8; i++) {
      const tick = new THREE.Mesh(tickGeo, ringMat);
      const a = (i / 8) * Math.PI * 2;
      tick.position.set(Math.sin(a) * 0.49, 0.006, Math.cos(a) * 0.49);
      tick.rotation.y = a;
      this.bikeAssembly.add(tick);
    }

    this.disposables.push(ringGeo, ringMat, tickGeo);
  }

  private buildFrameAndCockpit(): void {
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      metalness: 0.58,
      roughness: 0.2,
      clearcoat: 0.92,
      clearcoatRoughness: 0.1,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.45,
      roughness: 0.26,
    });
    this.frameAccentMat = accentMat;

    const barTapeMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05,
    });
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.85,
      roughness: 0.2,
    });
    this.disposables.push(frameMat, accentMat, barTapeMat, alloyMat);

    const rearAxle = new THREE.Vector3(-WHEELBASE_HALF, WHEEL_RADIUS, 0);
    const frontAxle = new THREE.Vector3(WHEELBASE_HALF + 0.02, WHEEL_RADIUS, 0);

    // Main carbon triangle
    this.addTube(BB_POS, SEAT_TUBE_TOP, 0.018, frameMat);
    this.addTube(BB_POS, HEAD_TUBE_BOTTOM, 0.023, frameMat);
    this.addTube(SEAT_TUBE_TOP, HEAD_TUBE_TOP, 0.019, accentMat);
    this.addTube(HEAD_TUBE_BOTTOM, HEAD_TUBE_TOP, 0.021, accentMat);

    // Rear stays
    for (const zOff of [-0.032, 0.032]) {
      const axleSide = rearAxle.clone().setZ(zOff);
      const bbSide = BB_POS.clone().setZ(zOff * 0.55);
      const seatTopSide = SEAT_TUBE_TOP.clone()
        .setY(SEAT_TUBE_TOP.y - 0.05)
        .setZ(zOff * 0.45);
      this.addTube(bbSide, axleSide, 0.011, frameMat);
      this.addTube(seatTopSide, axleSide, 0.0095, accentMat);
    }

    // Front aero fork blades
    for (const zOff of [-0.03, 0.03]) {
      this.addTube(
        HEAD_TUBE_BOTTOM.clone().setZ(zOff * 0.5),
        frontAxle.clone().setZ(zOff),
        0.013,
        frameMat
      );
    }

    // Stem & aero drop bars
    const stemTop = new THREE.Vector3(
      HEAD_TUBE_TOP.x - 0.01,
      HEAD_TUBE_TOP.y + 0.048,
      0
    );
    const stemTip = new THREE.Vector3(stemTop.x + 0.08, stemTop.y + 0.01, 0);
    this.addTube(HEAD_TUBE_TOP, stemTop, 0.013, frameMat);
    this.addTube(stemTop, stemTip, 0.013, frameMat);

    const barWidthHalf = 0.145;
    this.addTube(
      new THREE.Vector3(stemTip.x, stemTip.y, -barWidthHalf),
      new THREE.Vector3(stemTip.x, stemTip.y, barWidthHalf),
      0.0105,
      barTapeMat
    );

    const hoodGeo = new THREE.BoxGeometry(0.034, 0.04, 0.022);
    const leverGeo = new THREE.BoxGeometry(0.012, 0.058, 0.01);
    for (const z of [-barWidthHalf, barWidthHalf]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(stemTip.x, stemTip.y, z),
        new THREE.Vector3(stemTip.x + 0.058, stemTip.y - 0.016, z),
        new THREE.Vector3(stemTip.x + 0.062, stemTip.y - 0.078, z),
        new THREE.Vector3(stemTip.x + 0.005, stemTip.y - 0.094, z),
      ]);
      const dropGeo = new THREE.TubeGeometry(curve, 18, 0.0105, 10, false);
      const dropMesh = new THREE.Mesh(dropGeo, barTapeMat);
      dropMesh.castShadow = true;
      this.bikeAssembly.add(dropMesh);

      const hoodMesh = new THREE.Mesh(hoodGeo, barTapeMat);
      hoodMesh.position.set(stemTip.x + 0.046, stemTip.y + 0.01, z);
      hoodMesh.rotation.z = -0.35;
      this.bikeAssembly.add(hoodMesh);

      const leverMesh = new THREE.Mesh(leverGeo, alloyMat);
      leverMesh.position.set(stemTip.x + 0.064, stemTip.y - 0.03, z);
      leverMesh.rotation.z = 0.12;
      this.bikeAssembly.add(leverMesh);

      this.disposables.push(dropGeo);
    }
    this.disposables.push(hoodGeo, leverGeo);

    // Handlebar cycling computer
    const compGeo = new THREE.BoxGeometry(0.042, 0.01, 0.028);
    const compMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const compMesh = new THREE.Mesh(compGeo, compMat);
    compMesh.position.set(stemTip.x + 0.03, stemTip.y + 0.015, 0);
    compMesh.rotation.z = -0.22;
    this.bikeAssembly.add(compMesh);
    this.disposables.push(compGeo, compMat);
  }

  private buildWheelsAndDiscBrakes(): void {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.88,
      metalness: 0.05,
    });
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.22,
      metalness: 0.5,
      clearcoat: 0.78,
    });
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.88,
      roughness: 0.18,
    });
    const rotorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.18,
      side: THREE.DoubleSide,
    });
    const caliperMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.65,
      roughness: 0.35,
    });
    this.disposables.push(tireMat, rimMat, spokeMat, rotorMat, caliperMat);

    const buildWheel = (group: THREE.Group, isRear: boolean) => {
      const tireGeo = new THREE.TorusGeometry(WHEEL_RADIUS - 0.015, 0.017, 16, 48);
      const tireMesh = new THREE.Mesh(tireGeo, tireMat);
      tireMesh.castShadow = true;
      group.add(tireMesh);
      if (isRear) this.rearTireMesh = tireMesh;

      const rimGeo = new THREE.TorusGeometry(WHEEL_RADIUS - 0.04, 0.015, 14, 48);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      group.add(rimMesh);

      const hubGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.062, 16);
      hubGeo.rotateX(Math.PI / 2);
      const hubMesh = new THREE.Mesh(hubGeo, spokeMat);
      group.add(hubMesh);

      // Left-side disc brake rotor (-Z) so inspecting the back/left side shows full hardware!
      const rotorGeo = new THREE.RingGeometry(0.025, 0.064, 24);
      const rotorMesh = new THREE.Mesh(rotorGeo, rotorMat);
      rotorMesh.position.z = -0.027;
      group.add(rotorMesh);

      const spokeCount = 16;
      const spokeGeo = new THREE.CylinderGeometry(
        0.0022,
        0.0022,
        (WHEEL_RADIUS - 0.042) * 2,
        6
      );
      for (let i = 0; i < spokeCount; i++) {
        const spoke = new THREE.Mesh(spokeGeo, spokeMat);
        spoke.rotation.z = (i / spokeCount) * Math.PI;
        group.add(spoke);
      }
      this.disposables.push(tireGeo, rimGeo, hubGeo, rotorGeo, spokeGeo);
    };

    buildWheel(this.rearWheelGroup, true);
    this.rearWheelGroup.position.set(-WHEELBASE_HALF, WHEEL_RADIUS, 0);
    this.bikeAssembly.add(this.rearWheelGroup);

    buildWheel(this.frontWheelGroup, false);
    this.frontWheelGroup.position.set(WHEELBASE_HALF + 0.02, WHEEL_RADIUS, 0);
    this.bikeAssembly.add(this.frontWheelGroup);

    // Static brake calipers on left stays/fork
    const caliperGeo = new THREE.BoxGeometry(0.028, 0.024, 0.02);
    const rearCaliper = new THREE.Mesh(caliperGeo, caliperMat);
    rearCaliper.position.set(-WHEELBASE_HALF + 0.048, WHEEL_RADIUS + 0.028, -0.028);
    const frontCaliper = new THREE.Mesh(caliperGeo, caliperMat);
    frontCaliper.position.set(WHEELBASE_HALF - 0.028, WHEEL_RADIUS + 0.032, -0.028);
    this.bikeAssembly.add(rearCaliper, frontCaliper);

    // Rear tire rolling resistance halo
    const haloGeo = new THREE.RingGeometry(0.05, 0.11, 36);
    this.tireHaloMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.tireResistanceRing = new THREE.Mesh(haloGeo, this.tireHaloMat);
    this.tireResistanceRing.rotation.x = -Math.PI / 2;
    this.tireResistanceRing.position.set(-WHEELBASE_HALF, 0.008, 0);
    this.bikeAssembly.add(this.tireResistanceRing);

    this.disposables.push(caliperGeo, haloGeo, this.tireHaloMat);
  }

  private buildSaddleAndGhost(): void {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.65,
      roughness: 0.25,
    });
    const saddleMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.68,
      metalness: 0.12,
    });
    this.disposables.push(postMat, saddleMat);

    const postGeo = new THREE.CylinderGeometry(0.0115, 0.0115, 0.15, 12);
    const postMesh = new THREE.Mesh(postGeo, postMat);
    postMesh.position.set(0.015, -0.065, 0);
    postMesh.rotation.z = 0.28;
    this.saddleGroup.add(postMesh);

    const saddleGeo = new THREE.BoxGeometry(0.165, 0.024, 0.082);
    const saddleMesh = new THREE.Mesh(saddleGeo, saddleMat);
    saddleMesh.castShadow = true;
    this.saddleGroup.add(saddleMesh);
    this.saddleGroup.position.set(SEAT_TUBE_TOP.x, SEAT_TUBE_TOP.y + 0.08, 0);
    this.bikeAssembly.add(this.saddleGroup);

    // Cyan optimal saddle wireframe ghost
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.45,
      wireframe: true,
    });
    const ghostGeo = new THREE.BoxGeometry(0.172, 0.026, 0.086);
    const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
    this.optimalSaddleGhost.add(ghostMesh);
    this.optimalSaddleGhost.position.set(
      SEAT_TUBE_TOP.x,
      SEAT_TUBE_TOP.y + 0.08,
      0
    );
    this.bikeAssembly.add(this.optimalSaddleGhost);

    // Saddle diagnostic ring
    const saddleRingGeo = new THREE.TorusGeometry(0.095, 0.005, 8, 32);
    saddleRingGeo.rotateX(Math.PI / 2);
    this.saddleHighlightMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.55,
    });
    this.saddleHighlightRing = new THREE.Mesh(
      saddleRingGeo,
      this.saddleHighlightMat
    );
    this.saddleHighlightRing.position.copy(this.saddleGroup.position);
    this.bikeAssembly.add(this.saddleHighlightRing);

    this.disposables.push(
      postGeo,
      saddleGeo,
      ghostMat,
      ghostGeo,
      saddleRingGeo,
      this.saddleHighlightMat
    );
  }

  private buildDetailedDrivetrain(): void {
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.88,
      roughness: 0.2,
    });
    const darkRingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.78,
      roughness: 0.26,
    });
    const cleatMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.4,
      roughness: 0.35,
    });
    const chainMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.28,
    });
    this.disposables.push(alloyMat, darkRingMat, cleatMat, chainMat);

    // Dual front chainrings (52T outer + 36T inner)
    const bigRingGeo = new THREE.TorusGeometry(0.072, 0.007, 10, 36);
    const smallRingGeo = new THREE.TorusGeometry(0.05, 0.006, 10, 32);
    const bigRing = new THREE.Mesh(bigRingGeo, darkRingMat);
    bigRing.position.z = 0.036;
    const smallRing = new THREE.Mesh(smallRingGeo, alloyMat);
    smallRing.position.z = 0.026;
    this.crankGroup.add(bigRing, smallRing);

    // 7-speed rear cassette cogs on rearWheelGroup
    for (let c = 0; c < 6; c++) {
      const cogRadius = 0.044 - c * 0.0045;
      const cogGeo = new THREE.CylinderGeometry(cogRadius, cogRadius, 0.003, 18);
      cogGeo.rotateX(Math.PI / 2);
      const cog = new THREE.Mesh(cogGeo, c % 2 === 0 ? alloyMat : darkRingMat);
      cog.position.z = 0.022 + c * 0.0045;
      this.rearWheelGroup.add(cog);
      this.disposables.push(cogGeo);
    }

    // Rear derailleur cage + jockey pulleys
    const derArmGeo = new THREE.BoxGeometry(0.012, 0.058, 0.012);
    const derArm = new THREE.Mesh(derArmGeo, darkRingMat);
    derArm.position.set(-WHEELBASE_HALF + 0.01, WHEEL_RADIUS - 0.048, 0.038);
    derArm.rotation.z = 0.25;
    this.bikeAssembly.add(derArm);

    // Upper & lower chain spans connecting chainring to rear cassette
    const chainRadius = 0.0032;
    this.addTube(
      new THREE.Vector3(BB_POS.x, BB_POS.y + 0.068, 0.036),
      new THREE.Vector3(-WHEELBASE_HALF, WHEEL_RADIUS + 0.036, 0.034),
      chainRadius,
      chainMat
    );
    this.addTube(
      new THREE.Vector3(BB_POS.x, BB_POS.y - 0.068, 0.036),
      new THREE.Vector3(-WHEELBASE_HALF + 0.012, WHEEL_RADIUS - 0.072, 0.038),
      chainRadius,
      chainMat
    );

    // Crank arms + pedals + sliding yellow cleat position markers
    const armGeo = new THREE.BoxGeometry(CRANK_LENGTH, 0.019, 0.011);
    const pedalGeo = new THREE.BoxGeometry(0.056, 0.012, 0.042);
    const cleatGeo = new THREE.BoxGeometry(0.024, 0.01, 0.032);

    const rightArm = new THREE.Mesh(armGeo, alloyMat);
    rightArm.position.set(CRANK_LENGTH * 0.5, 0, 0.048);
    this.crankGroup.add(rightArm);
    this.rightPedalGroup.position.set(CRANK_LENGTH, 0, 0.068);
    this.rightPedalGroup.add(new THREE.Mesh(pedalGeo, darkRingMat));
    this.rightCleatMarker = new THREE.Mesh(cleatGeo, cleatMat);
    this.rightCleatMarker.position.set(0, 0.01, 0);
    this.rightPedalGroup.add(this.rightCleatMarker);
    this.crankGroup.add(this.rightPedalGroup);

    const leftArm = new THREE.Mesh(armGeo, alloyMat);
    leftArm.position.set(-CRANK_LENGTH * 0.5, 0, -0.048);
    this.crankGroup.add(leftArm);
    this.leftPedalGroup.position.set(-CRANK_LENGTH, 0, -0.068);
    this.leftPedalGroup.add(new THREE.Mesh(pedalGeo, darkRingMat));
    this.leftCleatMarker = new THREE.Mesh(cleatGeo, cleatMat);
    this.leftCleatMarker.position.set(0, 0.01, 0);
    this.leftPedalGroup.add(this.leftCleatMarker);
    this.crankGroup.add(this.leftPedalGroup);

    this.crankGroup.position.copy(BB_POS);
    this.bikeAssembly.add(this.crankGroup);

    // Drivetrain diagnostic ring
    const driveHaloGeo = new THREE.RingGeometry(0.095, 0.112, 6);
    this.drivetrainMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.drivetrainRing = new THREE.Mesh(driveHaloGeo, this.drivetrainMat);
    this.drivetrainRing.position.set(BB_POS.x, BB_POS.y, 0.045);
    this.bikeAssembly.add(this.drivetrainRing);

    this.disposables.push(
      bigRingGeo,
      smallRingGeo,
      derArmGeo,
      armGeo,
      pedalGeo,
      cleatGeo,
      driveHaloGeo,
      this.drivetrainMat
    );
  }

  private buildBottlesAndCages(): void {
    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.08,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
    });
    const bottleGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.11, 14);
    const capGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.022, 12);

    const dtBottle = new THREE.Group();
    const b1 = new THREE.Mesh(bottleGeo, bottleMat);
    const c1 = new THREE.Mesh(capGeo, capMat);
    c1.position.y = 0.065;
    dtBottle.add(b1, c1);
    dtBottle.position.set(0.085, 0.345, 0);
    dtBottle.rotation.z = -0.82;
    this.bikeAssembly.add(dtBottle);

    const stBottle = new THREE.Group();
    const b2 = new THREE.Mesh(bottleGeo, bottleMat);
    const c2 = new THREE.Mesh(capGeo, capMat);
    c2.position.y = 0.065;
    stBottle.add(b2, c2);
    stBottle.position.set(-0.045, 0.38, 0);
    stBottle.rotation.z = 0.32;
    this.bikeAssembly.add(stBottle);

    this.disposables.push(bottleMat, capMat, bottleGeo, capGeo);
  }

  private addTube(
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius: number,
    mat: THREE.Material
  ): void {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(radius, radius, len, 12);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      _upVec,
      _dirVec.copy(b).sub(a).normalize()
    );
    mesh.castShadow = true;
    this.bikeAssembly.add(mesh);
    this.disposables.push(geo);
  }

  public dispose(): void {
    window.removeEventListener('wheel', this.onWheel, true);
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
