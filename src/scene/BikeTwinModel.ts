import * as THREE from 'three';
import * as xb from 'xrblocks';
import {BikeFocusPart, BikeSetupState, CyclingTelemetry} from '../types.ts';

const WHEEL_RADIUS = 0.235;
const CRANK_LENGTH = 0.115;
const WHEELBASE_HALF = 0.34;
const BB_POS = new THREE.Vector3(-0.02, WHEEL_RADIUS - 0.03, 0);
const SEAT_TUBE_TOP = new THREE.Vector3(-0.14, 0.56, 0);
const HEAD_TUBE_TOP = new THREE.Vector3(0.21, 0.57, 0);
const HEAD_TUBE_BOTTOM = new THREE.Vector3(0.24, 0.45, 0);

const THIGH_LEN = 0.295;
const SHIN_LEN = 0.29;
const UPPER_ARM_LEN = 0.2;
const FOREARM_LEN = 0.195;

const _targetColor = new THREE.Color();
const _pelvisCenter = new THREE.Vector3();
const _hipRight = new THREE.Vector3();
const _hipLeft = new THREE.Vector3();
const _pedalRight = new THREE.Vector3();
const _pedalLeft = new THREE.Vector3();
const _ankleRight = new THREE.Vector3();
const _ankleLeft = new THREE.Vector3();
const _kneeRight = new THREE.Vector3();
const _kneeLeft = new THREE.Vector3();
const _shoulderRight = new THREE.Vector3();
const _shoulderLeft = new THREE.Vector3();
const _elbowRight = new THREE.Vector3();
const _elbowLeft = new THREE.Vector3();
const _hoodRight = new THREE.Vector3();
const _hoodLeft = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _dirVec = new THREE.Vector3();

class BikeHotspot extends xb.MeshScript {
  private partId: BikeFocusPart;
  private onPick: (part: BikeFocusPart) => void;
  private baseColor: number;

  constructor(
    partId: BikeFocusPart,
    radius: number,
    baseColor: number,
    onPick: (part: BikeFocusPart) => void
  ) {
    super(
      new THREE.TorusGeometry(radius, 0.008, 12, 32),
      new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.78,
      })
    );
    this.partId = partId;
    this.baseColor = baseColor;
    this.onPick = onPick;
    this.name = `Bike hotspot ${partId}`;
  }

  public onObjectSelectStart(event: xb.SelectEvent): void {
    (this.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
    this.scale.setScalar(1.16);
    event.stopPropagation();
  }

  public onObjectSelectEnd(event: xb.SelectEvent): void {
    (this.material as THREE.MeshBasicMaterial).color.setHex(this.baseColor);
    this.scale.setScalar(1.0);
    this.onPick(this.partId);
    event.stopPropagation();
  }

  public dispose(): void {
    this.geometry.dispose();
    (this.material as THREE.Material).dispose();
  }
}

export class BikeTwinModel extends xb.Script {
  private bikeGroup = new THREE.Group();
  private frontWheelGroup = new THREE.Group();
  private rearWheelGroup = new THREE.Group();
  private rearTireMesh: THREE.Mesh | null = null;
  private crankGroup = new THREE.Group();
  private rightPedalGroup = new THREE.Group();
  private leftPedalGroup = new THREE.Group();
  private saddleGroup = new THREE.Group();
  private optimalSaddleGhost = new THREE.Group();

  // Full-body cyclist hierarchy
  private riderRoot = new THREE.Group();
  private torsoPivot = new THREE.Group();
  private rightThighMesh!: THREE.Mesh;
  private rightShinMesh!: THREE.Mesh;
  private leftThighMesh!: THREE.Mesh;
  private leftShinMesh!: THREE.Mesh;
  private rightUpperArmMesh!: THREE.Mesh;
  private rightForearmMesh!: THREE.Mesh;
  private leftUpperArmMesh!: THREE.Mesh;
  private leftForearmMesh!: THREE.Mesh;

  private rightShoeGroup = new THREE.Group();
  private leftShoeGroup = new THREE.Group();

  // Biomechanical ankle highlight (viewer-facing right ankle)
  private ankleJointMesh: THREE.Mesh | null = null;
  private ankleAuraMesh: THREE.Mesh | null = null;
  private achillesLine: THREE.Line | null = null;
  private achillesPosAttr: THREE.BufferAttribute | null = null;
  private hrPulseNode: THREE.Mesh | null = null;
  private hrPulseMat: THREE.MeshStandardMaterial | null = null;

  // Holographic rings
  private tireResistanceRing: THREE.Mesh | null = null;
  private drivetrainRing: THREE.Mesh | null = null;
  private ankleMat: THREE.MeshStandardMaterial | null = null;
  private ankleAuraMat: THREE.MeshBasicMaterial | null = null;
  private tireHaloMat: THREE.MeshBasicMaterial | null = null;
  private drivetrainMat: THREE.MeshBasicMaterial | null = null;
  private frameAccentMat: THREE.MeshStandardMaterial | null = null;

  private handlebarHoodRightPos = new THREE.Vector3();
  private handlebarHoodLeftPos = new THREE.Vector3();

  private crankAngle = 0;
  private wheelAngle = 0;
  private pulseTime = 0;

  private setup: BikeSetupState = {
    saddleOffsetMm: 18,
    cadenceRpm: 62,
    tirePsi: 70,
    cleatOffsetMm: 8,
  };
  private telemetry: CyclingTelemetry | null = null;
  private onHotspotSelect?: (part: BikeFocusPart) => void;

  private disposables: Array<{dispose: () => void}> = [];

  constructor(onHotspotSelect?: (part: BikeFocusPart) => void) {
    super();
    this.onHotspotSelect = onHotspotSelect;
    this.name = 'Bike Twin Optimizer';
    // Sit flush on the Hangang left bike lane (y = 0), heading straight forward (-Z)
    this.position.set(-0.52, 0, -2.35);
    this.rotation.y = Math.PI / 2;
    this.scale.setScalar(1.25);
    this.xb = {manipulation: true};
  }

  public init(): void {
    this.buildPedestalAndShadow();
    this.buildFrameAndHandlebars();
    this.buildWheels();
    this.buildSaddleAndGhost();
    this.buildDrivetrainAndPedals();
    this.buildFullCyclist();
    this.buildHotspots();

    this.add(this.bikeGroup);
  }

  public setState(setup: BikeSetupState, telemetry: CyclingTelemetry): void {
    this.setup = setup;
    this.telemetry = telemetry;
  }

  public update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    this.pulseTime += dt;

    const rpm = this.setup.cadenceRpm;
    const speedKmh = this.telemetry?.speedKmh ?? 22;
    const ankleStrain = (this.telemetry?.ankleStrainPct ?? 75) / 100;
    const optScore = (this.telemetry?.optimizationScore ?? 40) / 100;
    const hrBpm = this.telemetry?.estimatedHrBpm ?? 165;

    // Spin crank and wheels
    const crankRadPerSec = (rpm / 60) * Math.PI * 2;
    this.crankAngle -= crankRadPerSec * dt;
    this.crankGroup.rotation.z = this.crankAngle;

    // Right and left pedal levelness + ankling tilt
    const anklingAmp = 0.14 + Math.max(0, this.setup.saddleOffsetMm / 25) * 0.24;
    const rightAnkleTilt =
      Math.sin(this.crankAngle - 0.5) * anklingAmp -
      Math.max(0, this.setup.saddleOffsetMm / 25) * 0.22;
    const leftAnkleTilt =
      Math.sin(this.crankAngle + Math.PI - 0.5) * anklingAmp -
      Math.max(0, this.setup.saddleOffsetMm / 25) * 0.22;

    this.rightPedalGroup.rotation.z = -this.crankAngle + rightAnkleTilt;
    this.leftPedalGroup.rotation.z = -this.crankAngle + leftAnkleTilt;

    const wheelSpeedRad = ((speedKmh * 1000) / 3600) / WHEEL_RADIUS;
    this.wheelAngle -= wheelSpeedRad * dt;
    this.frontWheelGroup.rotation.z = this.wheelAngle;
    this.rearWheelGroup.rotation.z = this.wheelAngle;

    // Saddle height displacement
    const saddleShift = (this.setup.saddleOffsetMm / 25) * 0.045;
    this.saddleGroup.position.set(
      SEAT_TUBE_TOP.x - saddleShift * 0.32,
      SEAT_TUBE_TOP.y + 0.08 + saddleShift,
      0
    );
    this.optimalSaddleGhost.visible = Math.abs(this.setup.saddleOffsetMm) > 3;

    // Cleat fore/aft offset on both shoes
    const cleatShift = (this.setup.cleatOffsetMm / 10) * 0.025;
    this.rightShoeGroup.position.set(-0.025 - cleatShift, 0.022, 0);
    this.leftShoeGroup.position.set(-0.025 - cleatShift, 0.022, 0);

    // Update full-body cyclist kinematics (pelvis, torso, head, both arms, both legs)
    this.updateFullBodyKinematics(saddleShift, optScore);

    if (this.frameAccentMat && this.telemetry?.bikeProfile) {
      _targetColor.setHex(this.telemetry.bikeProfile.frameColorHex);
      this.frameAccentMat.color.lerp(_targetColor, 0.12);
    }

    // Rear tire squash when under-inflated + rolling resistance halo
    const optPsi = this.telemetry?.bikeProfile?.optimalTirePsi ?? 98;
    if (this.rearTireMesh) {
      const psiDeficit = Math.max(0, (optPsi - this.setup.tirePsi) / 33);
      this.rearTireMesh.scale.set(
        1 + psiDeficit * 0.02,
        1 - psiDeficit * 0.045,
        1 + psiDeficit * 0.03
      );
    }
    if (this.tireResistanceRing && this.tireHaloMat) {
      const psiDeficit = Math.max(0, (optPsi - this.setup.tirePsi) / 33);
      const pulse = 1 + Math.sin(this.pulseTime * 4.5) * 0.06 * psiDeficit;
      this.tireResistanceRing.scale.setScalar((0.85 + psiDeficit * 0.45) * pulse);
      _targetColor.setHex(psiDeficit > 0.25 ? 0xf59e0b : 0x22d3ee);
      this.tireHaloMat.color.lerp(_targetColor, 0.12);
      this.tireHaloMat.opacity = 0.28 + psiDeficit * 0.42;
    }

    // Ankle pain / optimal glow
    if (this.ankleMat && this.ankleAuraMesh && this.ankleAuraMat) {
      if (ankleStrain > 0.55) {
        _targetColor.setHex(0xef4444);
      } else if (ankleStrain > 0.3) {
        _targetColor.setHex(0xf59e0b);
      } else {
        _targetColor.setHex(0x2dd4bf);
      }
      this.ankleMat.color.lerp(_targetColor, 0.12);
      this.ankleMat.emissive.lerp(_targetColor, 0.12);
      this.ankleMat.emissiveIntensity = 0.55 + ankleStrain * 1.1;

      const auraPulse =
        1 + Math.sin(this.pulseTime * (3 + ankleStrain * 5)) * (0.06 + ankleStrain * 0.16);
      this.ankleAuraMesh.scale.setScalar(auraPulse);
      this.ankleAuraMat.color.copy(this.ankleMat.color);
      this.ankleAuraMat.opacity = 0.28 + ankleStrain * 0.5;
    }

    // Chest heart-rate pulse indicator
    if (this.hrPulseNode && this.hrPulseMat) {
      const beatFreq = (hrBpm / 60) * Math.PI * 2;
      const beat = Math.pow(Math.max(0, Math.sin(this.pulseTime * beatFreq * 0.5)), 4);
      this.hrPulseNode.scale.setScalar(1 + beat * 0.28);
      _targetColor.setHex(hrBpm >= 162 ? 0xf43f5e : hrBpm >= 152 ? 0xf59e0b : 0x34d399);
      this.hrPulseMat.color.lerp(_targetColor, 0.12);
      this.hrPulseMat.emissive.lerp(_targetColor, 0.12);
    }

    // Drivetrain efficiency ring
    if (this.drivetrainRing && this.drivetrainMat) {
      _targetColor.setHex(optScore >= 0.85 ? 0x22d3ee : 0xf97316);
      this.drivetrainMat.color.lerp(_targetColor, 0.1);
      this.drivetrainRing.rotation.z = this.crankAngle * 0.5;
    }
  }

  private updateFullBodyKinematics(saddleShift: number, optScore: number): void {
    // 1. Pelvis sits on saddle; subtle rocking decreases as bike fit improves
    const rockAmp = (1 - optScore) * 0.035;
    const pelvisRoll = Math.sin(this.crankAngle) * rockAmp;

    _pelvisCenter.set(
      SEAT_TUBE_TOP.x - saddleShift * 0.32 - 0.015,
      SEAT_TUBE_TOP.y + 0.14 + saddleShift,
      0
    );
    this.riderRoot.position.copy(_pelvisCenter);
    this.riderRoot.rotation.x = pelvisRoll;

    // Torso leans forward into aerodynamic road cycling posture
    const aeroLean = -0.82 - optScore * 0.08 + Math.sin(this.crankAngle * 2) * rockAmp * 0.4;
    this.torsoPivot.rotation.z = aeroLean;

    // Compute world-in-bikeGroup shoulder positions from torsoPivot
    this.riderRoot.updateMatrixWorld(true);
    const torsoLen = 0.36;
    const torsoForwardX = -Math.sin(aeroLean) * torsoLen;
    const torsoUpY = Math.cos(aeroLean) * torsoLen;

    _shoulderRight.set(
      _pelvisCenter.x + torsoForwardX,
      _pelvisCenter.y + torsoUpY,
      0.11
    );
    _shoulderLeft.set(
      _pelvisCenter.x + torsoForwardX,
      _pelvisCenter.y + torsoUpY,
      -0.11
    );

    // 2. Two-bone Arm IK from shoulders to handlebar hoods
    _hoodRight.copy(this.handlebarHoodRightPos);
    _hoodLeft.copy(this.handlebarHoodLeftPos);

    this.solve2BoneIK(_shoulderRight, _hoodRight, UPPER_ARM_LEN, FOREARM_LEN, -1, _elbowRight);
    this.solve2BoneIK(_shoulderLeft, _hoodLeft, UPPER_ARM_LEN, FOREARM_LEN, -1, _elbowLeft);

    this.alignSegment(this.rightUpperArmMesh, _shoulderRight, _elbowRight);
    this.alignSegment(this.rightForearmMesh, _elbowRight, _hoodRight);
    this.alignSegment(this.leftUpperArmMesh, _shoulderLeft, _elbowLeft);
    this.alignSegment(this.leftForearmMesh, _elbowLeft, _hoodLeft);

    // 3. Two-bone Leg IK for BOTH Right & Left legs (180° out of phase)
    _hipRight.set(_pelvisCenter.x, _pelvisCenter.y, 0.068);
    _hipLeft.set(_pelvisCenter.x, _pelvisCenter.y, -0.068);

    const cleatShift = (this.setup.cleatOffsetMm / 10) * 0.025;

    // Right pedal & ankle
    const rpx = BB_POS.x + Math.cos(this.crankAngle) * CRANK_LENGTH;
    const rpy = BB_POS.y + Math.sin(this.crankAngle) * CRANK_LENGTH;
    _pedalRight.set(rpx, rpy, 0.068);
    const rightAnkleTilt = this.rightPedalGroup.rotation.z + this.crankAngle;
    _ankleRight.set(
      _pedalRight.x - 0.042 - cleatShift * 0.7,
      _pedalRight.y + 0.055 + Math.sin(rightAnkleTilt) * 0.015,
      0.068
    );

    // Left pedal & ankle (crankAngle + PI)
    const leftAngle = this.crankAngle + Math.PI;
    const lpx = BB_POS.x + Math.cos(leftAngle) * CRANK_LENGTH;
    const lpy = BB_POS.y + Math.sin(leftAngle) * CRANK_LENGTH;
    _pedalLeft.set(lpx, lpy, -0.068);
    const leftAnkleTilt = this.leftPedalGroup.rotation.z + leftAngle;
    _ankleLeft.set(
      _pedalLeft.x - 0.042 - cleatShift * 0.7,
      _pedalLeft.y + 0.055 + Math.sin(leftAnkleTilt) * 0.015,
      -0.068
    );

    // Knees bend forward (+X -> bendSign = +1)
    this.solve2BoneIK(_hipRight, _ankleRight, THIGH_LEN, SHIN_LEN, 1, _kneeRight);
    this.solve2BoneIK(_hipLeft, _ankleLeft, THIGH_LEN, SHIN_LEN, 1, _kneeLeft);

    this.alignSegment(this.rightThighMesh, _hipRight, _kneeRight);
    this.alignSegment(this.rightShinMesh, _kneeRight, _ankleRight);
    this.alignSegment(this.leftThighMesh, _hipLeft, _kneeLeft);
    this.alignSegment(this.leftShinMesh, _kneeLeft, _ankleLeft);

    // Highlighted right ankle joint + Achilles tendon line
    if (this.ankleJointMesh && this.ankleAuraMesh) {
      this.ankleJointMesh.position.copy(_ankleRight);
      this.ankleAuraMesh.position.copy(_ankleRight);
    }

    if (this.achillesLine && this.achillesPosAttr) {
      const calfX = (_kneeRight.x + _ankleRight.x) * 0.5 - 0.018;
      const calfY = (_kneeRight.y + _ankleRight.y) * 0.5;
      this.achillesPosAttr.setXYZ(0, calfX, calfY, _ankleRight.z + 0.005);
      this.achillesPosAttr.setXYZ(1, _ankleRight.x - 0.018, _ankleRight.y - 0.02, _ankleRight.z + 0.005);
      this.achillesPosAttr.needsUpdate = true;
    }
  }

  private solve2BoneIK(
    root: THREE.Vector3,
    target: THREE.Vector3,
    l1: number,
    l2: number,
    bendSign: number,
    outMid: THREE.Vector3
  ): void {
    const dx = target.x - root.x;
    const dy = target.y - root.y;
    const dist = Math.min(Math.max(Math.hypot(dx, dy), 0.08), l1 + l2 - 0.008);
    const baseAngle = Math.atan2(dy, dx);
    const cosA = THREE.MathUtils.clamp(
      (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist),
      -1,
      1
    );
    const jointAngle = baseAngle + bendSign * Math.acos(cosA);
    outMid.set(
      root.x + Math.cos(jointAngle) * l1,
      root.y + Math.sin(jointAngle) * l1,
      (root.z + target.z) * 0.5
    );
  }

  private alignSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    const len = start.distanceTo(end);
    mesh.scale.set(1, len, 1);
    _dirVec.copy(end).sub(start).normalize();
    mesh.quaternion.setFromUnitVectors(_upVec, _dirVec);
  }

  private buildPedestalAndShadow(): void {
    // Subtle flush road contact shadow & alignment guide on the asphalt
    const baseGeo = new THREE.RingGeometry(0.46, 0.52, 48);
    const baseMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const baseRing = new THREE.Mesh(baseGeo, baseMat);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.008;
    baseRing.xb = {pointerEvents: 'none'};
    this.bikeGroup.add(baseRing);
    this.disposables.push(baseGeo, baseMat);

    const shadowGeo = new THREE.PlaneGeometry(0.95, 0.34);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    shadow.xb = {pointerEvents: 'none'};
    this.bikeGroup.add(shadow);
    this.disposables.push(shadowGeo, shadowMat);
  }

  private buildFrameAndHandlebars(): void {
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      metalness: 0.55,
      roughness: 0.22,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.4,
      roughness: 0.3,
    });
    this.frameAccentMat = accentMat;
    const barTapeMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.disposables.push(frameMat, accentMat, barTapeMat);

    const rearAxle = new THREE.Vector3(-WHEELBASE_HALF, WHEEL_RADIUS, 0);
    const frontAxle = new THREE.Vector3(WHEELBASE_HALF + 0.02, WHEEL_RADIUS, 0);

    this.addTube(BB_POS, SEAT_TUBE_TOP, 0.017, frameMat);
    this.addTube(BB_POS, HEAD_TUBE_BOTTOM, 0.021, frameMat);
    this.addTube(SEAT_TUBE_TOP, HEAD_TUBE_TOP, 0.018, frameMat);
    this.addTube(HEAD_TUBE_BOTTOM, HEAD_TUBE_TOP, 0.019, accentMat);

    for (const zOff of [-0.028, 0.028]) {
      const axleSide = rearAxle.clone().setZ(zOff);
      const bbSide = BB_POS.clone().setZ(zOff * 0.55);
      const seatTopSide = SEAT_TUBE_TOP.clone().setY(SEAT_TUBE_TOP.y - 0.05).setZ(zOff * 0.45);
      this.addTube(bbSide, axleSide, 0.011, frameMat);
      this.addTube(seatTopSide, axleSide, 0.009, frameMat);
    }

    for (const zOff of [-0.028, 0.028]) {
      this.addTube(
        HEAD_TUBE_BOTTOM.clone().setZ(zOff * 0.5),
        frontAxle.clone().setZ(zOff),
        0.012,
        frameMat
      );
    }

    const stemTop = new THREE.Vector3(HEAD_TUBE_TOP.x - 0.01, HEAD_TUBE_TOP.y + 0.045, 0);
    const stemTip = new THREE.Vector3(stemTop.x + 0.075, stemTop.y + 0.01, 0);
    this.addTube(HEAD_TUBE_TOP, stemTop, 0.012, frameMat);
    this.addTube(stemTop, stemTip, 0.012, frameMat);

    const barWidthHalf = 0.14;
    const barLeft = new THREE.Vector3(stemTip.x, stemTip.y, -barWidthHalf);
    const barRight = new THREE.Vector3(stemTip.x, stemTip.y, barWidthHalf);
    this.addTube(barLeft, barRight, 0.01, barTapeMat);

    // Save brake hood grip targets for full-body arm IK
    this.handlebarHoodRightPos.set(stemTip.x + 0.04, stemTip.y + 0.005, barWidthHalf);
    this.handlebarHoodLeftPos.set(stemTip.x + 0.04, stemTip.y + 0.005, -barWidthHalf);

    // Drop curves + brake hoods
    const hoodGeo = new THREE.BoxGeometry(0.032, 0.036, 0.022);
    for (const z of [-barWidthHalf, barWidthHalf]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(stemTip.x, stemTip.y, z),
        new THREE.Vector3(stemTip.x + 0.055, stemTip.y - 0.015, z),
        new THREE.Vector3(stemTip.x + 0.06, stemTip.y - 0.075, z),
        new THREE.Vector3(stemTip.x + 0.005, stemTip.y - 0.09, z),
      ]);
      const dropGeo = new THREE.TubeGeometry(curve, 16, 0.01, 10, false);
      const dropMesh = new THREE.Mesh(dropGeo, barTapeMat);
      dropMesh.castShadow = true;
      this.bikeGroup.add(dropMesh);

      const hoodMesh = new THREE.Mesh(hoodGeo, barTapeMat);
      hoodMesh.position.set(stemTip.x + 0.045, stemTip.y + 0.008, z);
      hoodMesh.rotation.z = -0.35;
      this.bikeGroup.add(hoodMesh);
      this.disposables.push(dropGeo);
    }
    this.disposables.push(hoodGeo);

    // Handlebar bike computer screen glow
    const compGeo = new THREE.BoxGeometry(0.036, 0.008, 0.024);
    const compMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });
    const compMesh = new THREE.Mesh(compGeo, compMat);
    compMesh.position.set(stemTip.x + 0.025, stemTip.y + 0.014, 0);
    compMesh.rotation.z = -0.25;
    this.bikeGroup.add(compMesh);
    this.disposables.push(compGeo, compMat);
  }

  private buildWheels(): void {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.88,
      metalness: 0.05,
    });
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      roughness: 0.25,
      metalness: 0.45,
      clearcoat: 0.7,
    });
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.85,
      roughness: 0.2,
    });
    this.disposables.push(tireMat, rimMat, spokeMat);

    const buildWheel = (group: THREE.Group, isRear: boolean) => {
      const tireGeo = new THREE.TorusGeometry(WHEEL_RADIUS - 0.015, 0.016, 16, 48);
      const tireMesh = new THREE.Mesh(tireGeo, tireMat);
      tireMesh.castShadow = true;
      group.add(tireMesh);
      if (isRear) this.rearTireMesh = tireMesh;

      const rimGeo = new THREE.TorusGeometry(WHEEL_RADIUS - 0.036, 0.011, 12, 48);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      group.add(rimMesh);

      const hubGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.055, 16);
      hubGeo.rotateX(Math.PI / 2);
      const hubMesh = new THREE.Mesh(hubGeo, spokeMat);
      group.add(hubMesh);

      const spokeCount = 14;
      const spokeGeo = new THREE.CylinderGeometry(0.0022, 0.0022, (WHEEL_RADIUS - 0.04) * 2, 6);
      for (let i = 0; i < spokeCount; i++) {
        const spoke = new THREE.Mesh(spokeGeo, spokeMat);
        spoke.rotation.z = (i / spokeCount) * Math.PI;
        group.add(spoke);
      }
      this.disposables.push(tireGeo, rimGeo, hubGeo, spokeGeo);
    };

    buildWheel(this.rearWheelGroup, true);
    this.rearWheelGroup.position.set(-WHEELBASE_HALF, WHEEL_RADIUS, 0);
    this.bikeGroup.add(this.rearWheelGroup);

    buildWheel(this.frontWheelGroup, false);
    this.frontWheelGroup.position.set(WHEELBASE_HALF + 0.02, WHEEL_RADIUS, 0);
    this.bikeGroup.add(this.frontWheelGroup);

    const haloGeo = new THREE.RingGeometry(0.04, 0.085, 32);
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
    this.tireResistanceRing.xb = {pointerEvents: 'none'};
    this.bikeGroup.add(this.tireResistanceRing);
    this.disposables.push(haloGeo, this.tireHaloMat);
  }

  private buildSaddleAndGhost(): void {
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.6,
      roughness: 0.3,
    });
    const saddleMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.72,
      metalness: 0.1,
    });
    this.disposables.push(postMat, saddleMat);

    const postGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.14, 12);
    const postMesh = new THREE.Mesh(postGeo, postMat);
    postMesh.position.set(0.015, -0.06, 0);
    postMesh.rotation.z = 0.28;
    this.saddleGroup.add(postMesh);

    const saddleGeo = new THREE.BoxGeometry(0.16, 0.022, 0.078);
    const saddleMesh = new THREE.Mesh(saddleGeo, saddleMat);
    saddleMesh.castShadow = true;
    this.saddleGroup.add(saddleMesh);
    this.saddleGroup.position.set(SEAT_TUBE_TOP.x, SEAT_TUBE_TOP.y + 0.08, 0);
    this.bikeGroup.add(this.saddleGroup);
    this.disposables.push(postGeo, saddleGeo);

    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.38,
      wireframe: true,
    });
    const ghostGeo = new THREE.BoxGeometry(0.165, 0.024, 0.082);
    const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
    this.optimalSaddleGhost.add(ghostMesh);
    this.optimalSaddleGhost.position.set(SEAT_TUBE_TOP.x, SEAT_TUBE_TOP.y + 0.08, 0);
    this.optimalSaddleGhost.xb = {pointerEvents: 'none'};
    this.bikeGroup.add(this.optimalSaddleGhost);
    this.disposables.push(ghostMat, ghostGeo);
  }

  private buildDrivetrainAndPedals(): void {
    const alloyMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.22,
    });
    const chainringMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.75,
      roughness: 0.28,
    });
    const shoeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.15,
    });
    const soleMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.2,
    });
    this.disposables.push(alloyMat, chainringMat, shoeMat, soleMat);

    // Chainring
    const ringGeo = new THREE.TorusGeometry(0.068, 0.008, 10, 36);
    const ringMesh = new THREE.Mesh(ringGeo, chainringMat);
    ringMesh.position.z = 0.032;
    this.crankGroup.add(ringMesh);

    const armGeo = new THREE.BoxGeometry(CRANK_LENGTH, 0.018, 0.01);
    const pedalGeo = new THREE.BoxGeometry(0.05, 0.012, 0.038);
    const soleGeo = new THREE.BoxGeometry(0.135, 0.012, 0.048);
    const upperGeo = new THREE.CapsuleGeometry(0.022, 0.075, 6, 12);
    upperGeo.rotateZ(Math.PI / 2);

    // Right crank arm & pedal
    const rightArm = new THREE.Mesh(armGeo, alloyMat);
    rightArm.position.set(CRANK_LENGTH * 0.5, 0, 0.048);
    this.crankGroup.add(rightArm);

    this.rightPedalGroup.position.set(CRANK_LENGTH, 0, 0.068);
    this.rightPedalGroup.add(new THREE.Mesh(pedalGeo, alloyMat));

    const rSole = new THREE.Mesh(soleGeo, soleMat);
    const rUpper = new THREE.Mesh(upperGeo, shoeMat);
    rUpper.position.set(-0.01, 0.022, 0);
    this.rightShoeGroup.add(rSole, rUpper);
    this.rightShoeGroup.position.set(-0.025, 0.022, 0);
    this.rightPedalGroup.add(this.rightShoeGroup);
    this.crankGroup.add(this.rightPedalGroup);

    // Left crank arm & pedal (180° opposite)
    const leftArm = new THREE.Mesh(armGeo, alloyMat);
    leftArm.position.set(-CRANK_LENGTH * 0.5, 0, -0.048);
    this.crankGroup.add(leftArm);

    this.leftPedalGroup.position.set(-CRANK_LENGTH, 0, -0.068);
    this.leftPedalGroup.add(new THREE.Mesh(pedalGeo, alloyMat));

    const lSole = new THREE.Mesh(soleGeo, soleMat);
    const lUpper = new THREE.Mesh(upperGeo, shoeMat);
    lUpper.position.set(-0.01, 0.022, 0);
    this.leftShoeGroup.add(lSole, lUpper);
    this.leftShoeGroup.position.set(-0.025, 0.022, 0);
    this.leftPedalGroup.add(this.leftShoeGroup);
    this.crankGroup.add(this.leftPedalGroup);

    this.crankGroup.position.copy(BB_POS);
    this.bikeGroup.add(this.crankGroup);
    this.disposables.push(ringGeo, armGeo, pedalGeo, soleGeo, upperGeo);

    // Drivetrain torque halo
    const driveHaloGeo = new THREE.RingGeometry(0.09, 0.105, 6);
    this.drivetrainMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.drivetrainRing = new THREE.Mesh(driveHaloGeo, this.drivetrainMat);
    this.drivetrainRing.position.set(BB_POS.x, BB_POS.y, 0.025);
    this.drivetrainRing.xb = {pointerEvents: 'none'};
    this.bikeGroup.add(this.drivetrainRing);
    this.disposables.push(driveHaloGeo, this.drivetrainMat);
  }

  private buildFullCyclist(): void {
    const bibShortMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.72,
      metalness: 0.08,
    });
    const jerseyMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.55,
      metalness: 0.15,
    });
    const jerseyAccentMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      roughness: 0.35,
      metalness: 0.25,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe8be9e,
      roughness: 0.62,
      metalness: 0.02,
    });
    const bioOverlayMat = new THREE.MeshPhysicalMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.35,
      roughness: 0.25,
      depthWrite: false,
    });
    const helmetMat = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.2,
      metalness: 0.15,
      clearcoat: 0.85,
    });
    const glassVisorMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.55,
      roughness: 0.12,
      metalness: 0.4,
      transparent: true,
      opacity: 0.88,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
    });
    this.disposables.push(
      bibShortMat,
      jerseyMat,
      jerseyAccentMat,
      skinMat,
      bioOverlayMat,
      helmetMat,
      glassVisorMat,
      gloveMat
    );

    // 1. Pelvis / Hip block (bib shorts)
    const pelvisGeo = new THREE.CapsuleGeometry(0.072, 0.075, 8, 14);
    pelvisGeo.rotateX(Math.PI / 2);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, bibShortMat);
    pelvisMesh.castShadow = true;
    this.riderRoot.add(pelvisMesh);

    // 2. Torso + Shoulders + Neck + Head + Helmet + Smart Glasses
    const torsoGeo = new THREE.CapsuleGeometry(0.088, 0.22, 8, 16);
    const torsoMesh = new THREE.Mesh(torsoGeo, jerseyMat);
    torsoMesh.position.set(0, 0.21, 0);
    torsoMesh.castShadow = true;
    this.torsoPivot.add(torsoMesh);

    // Jersey aero stripe across chest/back
    const stripeGeo = new THREE.CylinderGeometry(0.091, 0.09, 0.045, 16);
    const stripeMesh = new THREE.Mesh(stripeGeo, jerseyAccentMat);
    stripeMesh.position.set(0, 0.24, 0);
    this.torsoPivot.add(stripeMesh);

    // Competition race bib number plate on the cyclist's back (-X side of torsoPivot)
    const bibTexture = this.createRaceBibTexture('204', '#1d4ed8', 'HANGANG XR');
    const bibGeo = new THREE.CylinderGeometry(
      0.093,
      0.093,
      0.125,
      16,
      1,
      true,
      Math.PI * 1.5 - 0.56,
      1.12
    );
    const bibMat = new THREE.MeshStandardMaterial({
      map: bibTexture,
      roughness: 0.42,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const bibMesh = new THREE.Mesh(bibGeo, bibMat);
    bibMesh.position.set(0, 0.185, 0);
    this.torsoPivot.add(bibMesh);

    // Heart-rate pulse indicator on rider chest side (visible to viewer)
    const hrGeo = new THREE.SphereGeometry(0.022, 16, 12);
    this.hrPulseMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xf43f5e,
      emissiveIntensity: 1.0,
      roughness: 0.25,
    });
    this.hrPulseNode = new THREE.Mesh(hrGeo, this.hrPulseMat);
    this.hrPulseNode.position.set(0.055, 0.26, 0.078);
    this.torsoPivot.add(this.hrPulseNode);

    // Shoulder caps
    const shoulderGeo = new THREE.SphereGeometry(0.046, 14, 12);
    const rShoulder = new THREE.Mesh(shoulderGeo, jerseyMat);
    rShoulder.position.set(0, 0.34, 0.105);
    const lShoulder = new THREE.Mesh(shoulderGeo, jerseyMat);
    lShoulder.position.set(0, 0.34, -0.105);
    this.torsoPivot.add(rShoulder, lShoulder);

    // Neck + Head tilted forward to look ahead along Hangang!
    const headGroup = new THREE.Group();
    headGroup.position.set(0.025, 0.42, 0);
    headGroup.rotation.z = 0.65; // Counter-rotate so face looks forward despite aero lean

    const neckGeo = new THREE.CylinderGeometry(0.032, 0.038, 0.07, 12);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(-0.01, -0.02, 0);

    const headGeo = new THREE.SphereGeometry(0.076, 18, 16);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.position.set(0.01, 0.048, 0);
    headMesh.scale.set(1.06, 1.08, 0.94);
    headMesh.castShadow = true;

    // Aero road cycling helmet
    const helmetGeo = new THREE.SphereGeometry(0.086, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58);
    const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
    helmetMesh.position.set(0.0, 0.055, 0);
    helmetMesh.scale.set(1.22, 0.96, 1.0);
    helmetMesh.rotation.z = 0.18;
    helmetMesh.castShadow = true;

    const helmetStripeGeo = new THREE.BoxGeometry(0.12, 0.018, 0.032);
    const helmetStripe = new THREE.Mesh(helmetStripeGeo, jerseyAccentMat);
    helmetStripe.position.set(-0.01, 0.132, 0);
    helmetStripe.rotation.z = 0.18;

    // Smart Glasses visor across the eyes!
    const visorGeo = new THREE.BoxGeometry(0.035, 0.028, 0.132);
    const visorMesh = new THREE.Mesh(visorGeo, glassVisorMat);
    visorMesh.position.set(0.075, 0.055, 0);

    headGroup.add(neckMesh, headMesh, helmetMesh, helmetStripe, visorMesh);
    this.torsoPivot.add(headGroup);

    this.riderRoot.add(this.torsoPivot);
    this.bikeGroup.add(this.riderRoot);

    // 3. Arms (upper arm jersey sleeve + skin forearm + cycling gloves)
    const upperArmGeo = new THREE.CylinderGeometry(0.026, 0.032, 1, 12);
    const forearmGeo = new THREE.CylinderGeometry(0.02, 0.025, 1, 12);
    this.rightUpperArmMesh = new THREE.Mesh(upperArmGeo, jerseyMat);
    this.rightForearmMesh = new THREE.Mesh(forearmGeo, skinMat);
    this.leftUpperArmMesh = new THREE.Mesh(upperArmGeo, jerseyMat);
    this.leftForearmMesh = new THREE.Mesh(forearmGeo, skinMat);

    // Cycling gloves on the handlebar hoods
    const gloveGeo = new THREE.SphereGeometry(0.026, 12, 10);
    const rGlove = new THREE.Mesh(gloveGeo, gloveMat);
    rGlove.position.copy(this.handlebarHoodRightPos);
    const lGlove = new THREE.Mesh(gloveGeo, gloveMat);
    lGlove.position.copy(this.handlebarHoodLeftPos);

    this.bikeGroup.add(
      this.rightUpperArmMesh,
      this.rightForearmMesh,
      this.leftUpperArmMesh,
      this.leftForearmMesh,
      rGlove,
      lGlove
    );

    // 4. Both Legs (bib-short thighs + calves/shins, with translucent biomechanics on right ankle)
    const thighGeo = new THREE.CylinderGeometry(0.036, 0.048, 1, 14);
    const shinGeo = new THREE.CylinderGeometry(0.023, 0.031, 1, 14);

    this.leftThighMesh = new THREE.Mesh(thighGeo, bibShortMat);
    this.leftShinMesh = new THREE.Mesh(shinGeo, skinMat);
    this.rightThighMesh = new THREE.Mesh(thighGeo, bibShortMat);
    // Viewer-facing right shin stays slightly translucent cyan-tinted so ankle tendon & bone alignment stay legible
    this.rightShinMesh = new THREE.Mesh(shinGeo, bioOverlayMat);

    this.leftThighMesh.castShadow = true;
    this.rightThighMesh.castShadow = true;

    this.bikeGroup.add(
      this.leftThighMesh,
      this.leftShinMesh,
      this.rightThighMesh,
      this.rightShinMesh
    );

    // 5. Right Ankle Pain / Optimal Biomechanics Joint + Aura + Achilles Line
    this.ankleMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.0,
      roughness: 0.25,
    });
    const ankleGeo = new THREE.SphereGeometry(0.027, 20, 16);
    this.ankleJointMesh = new THREE.Mesh(ankleGeo, this.ankleMat);

    this.ankleAuraMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const auraGeo = new THREE.RingGeometry(0.037, 0.054, 28);
    this.ankleAuraMesh = new THREE.Mesh(auraGeo, this.ankleAuraMat);

    const achillesPositions = new Float32Array(6);
    this.achillesPosAttr = new THREE.BufferAttribute(achillesPositions, 3);
    const achillesGeo = new THREE.BufferGeometry();
    achillesGeo.setAttribute('position', this.achillesPosAttr);
    const achillesMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.9,
    });
    this.achillesLine = new THREE.Line(achillesGeo, achillesMat);

    this.bikeGroup.add(this.ankleJointMesh, this.ankleAuraMesh, this.achillesLine);

    // Keep all non-hotspot rider meshes pass-through for clean raycasting
    const riderMeshes: THREE.Object3D[] = [
      this.riderRoot,
      this.rightUpperArmMesh,
      this.rightForearmMesh,
      this.leftUpperArmMesh,
      this.leftForearmMesh,
      rGlove,
      lGlove,
      this.leftThighMesh,
      this.leftShinMesh,
      this.rightThighMesh,
      this.rightShinMesh,
      this.ankleJointMesh,
      this.ankleAuraMesh,
      this.achillesLine,
    ];
    for (const m of riderMeshes) {
      m.traverse((obj) => {
        obj.xb = {...obj.xb, pointerEvents: 'none'};
      });
    }

    this.disposables.push(
      pelvisGeo,
      torsoGeo,
      stripeGeo,
      bibTexture,
      bibGeo,
      bibMat,
      hrGeo,
      this.hrPulseMat,
      shoulderGeo,
      neckGeo,
      headGeo,
      helmetGeo,
      helmetStripeGeo,
      visorGeo,
      upperArmGeo,
      forearmGeo,
      gloveGeo,
      thighGeo,
      shinGeo,
      this.ankleMat,
      ankleGeo,
      this.ankleAuraMat,
      auraGeo,
      achillesGeo,
      achillesMat
    );
  }

  private createRaceBibTexture(
    bibNumber: string,
    accentColor: string,
    eventTitle: string
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Crisp white bib card
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 256, 192);

      // Outer border
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 250, 186);

      // Header band
      ctx.fillStyle = accentColor;
      ctx.fillRect(6, 6, 244, 38);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(eventTitle, 128, 25);

      // Bold competition bib number
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 94px sans-serif';
      ctx.fillText(bibNumber, 128, 114);

      // Bottom sponsor/category bar
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(18, 166, 220, 10);

      // Four corner safety-pin grommets
      ctx.fillStyle = '#64748b';
      for (const [px, py] of [
        [18, 18],
        [238, 18],
        [18, 174],
        [238, 174],
      ]) {
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildHotspots(): void {
    const pick = (part: BikeFocusPart) => {
      this.onHotspotSelect?.(part);
    };

    const saddleSpot = new BikeHotspot('saddle', 0.055, 0x38bdf8, pick);
    saddleSpot.position.set(SEAT_TUBE_TOP.x, SEAT_TUBE_TOP.y + 0.11, 0.11);
    this.bikeGroup.add(saddleSpot);

    const ankleSpot = new BikeHotspot('ankle', 0.06, 0xf87171, pick);
    ankleSpot.position.set(BB_POS.x + 0.05, BB_POS.y + 0.06, 0.12);
    this.bikeGroup.add(ankleSpot);

    const tireSpot = new BikeHotspot('tire', 0.065, 0xfbbf24, pick);
    tireSpot.position.set(-WHEELBASE_HALF, WHEEL_RADIUS - 0.09, 0.06);
    this.bikeGroup.add(tireSpot);
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
    this.bikeGroup.add(mesh);
    this.disposables.push(geo);
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
