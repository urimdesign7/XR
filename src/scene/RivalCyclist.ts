import * as THREE from 'three';
import * as xb from 'xrblocks';
import {CyclingTelemetry} from '../types.ts';

export class RivalCyclist extends xb.Script {
  private riderGroup = new THREE.Group();
  private frontWheel = new THREE.Group();
  private rearWheel = new THREE.Group();
  private leftLeg = new THREE.Mesh();
  private rightLeg = new THREE.Mesh();

  private labelCard: xb.UICard | null = null;
  private labelTitle: xb.UIText | null = null;
  private labelDetail: xb.UIText | null = null;

  private wheelAngle = 0;
  private pedalPhase = 0;
  private currentGapMeters = 11.5;
  private rivalSpeedKmh = 27.5;

  private disposables: Array<{dispose: () => void}> = [];

  public init(): void {
    this.buildCyclistMesh();
    this.riderGroup.position.set(1.08, 0, -9.5);
    this.add(this.riderGroup);

    this.riderGroup.traverse((obj) => {
      obj.xb = {...obj.xb, pointerEvents: 'none'};
    });

    this.buildFloatingLabel();
  }

  public setTelemetry(telemetry: CyclingTelemetry): void {
    this.currentGapMeters = telemetry.rivalGapMeters;
    this.rivalSpeedKmh = telemetry.rivalSpeedKmh;

    if (!this.labelTitle || !this.labelDetail || !this.labelCard) return;

    if (telemetry.overtakingState === 'overtaken') {
      this.labelTitle.text = '추월 성공!';
      this.labelTitle.style.color = '#34d399';
      this.labelDetail.text = `선두 확보 (${Math.abs(telemetry.rivalGapMeters).toFixed(1)}m 뒤)`;
    } else if (telemetry.overtakingState === 'catching') {
      this.labelTitle.text = `추격 중 (${telemetry.rivalSpeedKmh.toFixed(1)} km/h)`;
      this.labelTitle.style.color = '#38bdf8';
      this.labelDetail.text = `거리차 +${telemetry.rivalGapMeters.toFixed(1)}m 좁혀짐`;
    } else {
      this.labelTitle.text = `선두 라이더 (${telemetry.rivalSpeedKmh.toFixed(1)} km/h)`;
      this.labelTitle.style.color = '#fbbf24';
      this.labelDetail.text = `거리차 +${telemetry.rivalGapMeters.toFixed(1)}m (벌어지는 중)`;
    }
  }

  public update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);

    // Map gap meters to a clear, visible 3D range along the Hangang lane
    const targetZ =
      this.currentGapMeters >= 0
        ? -2.5 - this.currentGapMeters * 0.72
        : -2.5 - this.currentGapMeters * 0.25;
    const clampedZ = THREE.MathUtils.clamp(targetZ, -18.0, 0.8);
    this.riderGroup.position.z += (clampedZ - this.riderGroup.position.z) * 0.1;

    // Spin wheels & pedal rhythm
    const wheelRate = ((this.rivalSpeedKmh * 1000) / 3600) / 0.34;
    this.wheelAngle -= wheelRate * dt;
    this.frontWheel.rotation.x = this.wheelAngle;
    this.rearWheel.rotation.x = this.wheelAngle;

    this.pedalPhase += dt * 9.0;
    this.leftLeg.rotation.x = Math.sin(this.pedalPhase) * 0.45 - 0.3;
    this.rightLeg.rotation.x = Math.sin(this.pedalPhase + Math.PI) * 0.45 - 0.3;

    // Hide world label when rival passes behind user camera
    if (this.labelCard) {
      this.labelCard.visible = this.riderGroup.position.z < -1.1;
    }
  }

  private buildCyclistMesh(): void {
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      metalness: 0.55,
      roughness: 0.28,
    });
    const kitMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.1,
    });
    const jerseyMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      roughness: 0.55,
      metalness: 0.15,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.85,
    });
    const helmetMat = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.2,
      clearcoat: 0.8,
    });
    const tailLightMat = new THREE.MeshBasicMaterial({color: 0xff2a55});

    this.disposables.push(frameMat, kitMat, jerseyMat, tireMat, helmetMat, tailLightMat);

    // Wheels (aligned along Z forward axis: -Z is forward)
    const tireGeo = new THREE.TorusGeometry(0.34, 0.025, 10, 28);
    tireGeo.rotateY(Math.PI / 2);
    const rimGeo = new THREE.TorusGeometry(0.29, 0.015, 8, 28);
    rimGeo.rotateY(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({color: 0x334155, metalness: 0.7, roughness: 0.25});

    this.rearWheel.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(rimGeo, rimMat));
    this.rearWheel.position.set(0, 0.34, 0.52);

    this.frontWheel.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(rimGeo, rimMat));
    this.frontWheel.position.set(0, 0.34, -0.52);
    this.riderGroup.add(this.rearWheel, this.frontWheel);

    // Frame spine
    const frameGeo = new THREE.BoxGeometry(0.055, 0.06, 0.92);
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(0, 0.76, 0.0);
    frameMesh.rotation.x = 0.08;
    frameMesh.castShadow = true;

    const seatPostGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.55, 10);
    const seatPost = new THREE.Mesh(seatPostGeo, frameMat);
    seatPost.position.set(0, 0.62, 0.24);
    seatPost.rotation.x = -0.22;

    const forkGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.56, 10);
    const fork = new THREE.Mesh(forkGeo, frameMat);
    fork.position.set(0, 0.61, -0.42);
    fork.rotation.x = 0.25;

    // Glowing red rear tail light
    const lightGeo = new THREE.BoxGeometry(0.04, 0.055, 0.02);
    const tailLight = new THREE.Mesh(lightGeo, tailLightMat);
    tailLight.position.set(0, 0.86, 0.35);

    this.riderGroup.add(frameMesh, seatPost, fork, tailLight);

    // Handlebars
    const barGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.4, 8);
    barGeo.rotateZ(Math.PI / 2);
    const barMesh = new THREE.Mesh(barGeo, kitMat);
    barMesh.position.set(0, 0.92, -0.36);

    // Rider pelvis, torso, head, helmet, arms, and legs
    const pelvisGeo = new THREE.CapsuleGeometry(0.11, 0.14, 6, 12);
    pelvisGeo.rotateZ(Math.PI / 2);
    const pelvis = new THREE.Mesh(pelvisGeo, kitMat);
    pelvis.position.set(0, 0.96, 0.25);

    const torsoGeo = new THREE.CapsuleGeometry(0.13, 0.36, 6, 12);
    const torso = new THREE.Mesh(torsoGeo, jerseyMat);
    torso.position.set(0, 1.15, 0.08);
    torso.rotation.x = -0.95; // Aero tuck posture
    torso.castShadow = true;

    const rivalBibTex = this.createBibTexture('01');
    const rivalBibGeo = new THREE.CylinderGeometry(
      0.134,
      0.134,
      0.17,
      14,
      1,
      true,
      -0.55,
      1.1
    );
    const rivalBibMat = new THREE.MeshStandardMaterial({
      map: rivalBibTex,
      roughness: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const rivalBibMesh = new THREE.Mesh(rivalBibGeo, rivalBibMat);
    rivalBibMesh.position.set(0, -0.02, 0);
    torso.add(rivalBibMesh);

    const headGeo = new THREE.SphereGeometry(0.1, 14, 12);
    const skinMat = new THREE.MeshStandardMaterial({color: 0xe8be9e, roughness: 0.65});
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.29, -0.2);

    const helmetGeo = new THREE.SphereGeometry(0.115, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.set(0, 1.33, -0.21);
    helmet.scale.set(0.92, 0.9, 1.25);

    const armGeo = new THREE.CapsuleGeometry(0.038, 0.34, 6, 10);
    const leftArm = new THREE.Mesh(armGeo, jerseyMat);
    leftArm.position.set(-0.17, 1.07, -0.22);
    leftArm.rotation.x = 0.68;
    const rightArm = new THREE.Mesh(armGeo, jerseyMat);
    rightArm.position.set(0.17, 1.07, -0.22);
    rightArm.rotation.x = 0.68;

    const legGeo = new THREE.CapsuleGeometry(0.052, 0.38, 6, 10);
    this.leftLeg = new THREE.Mesh(legGeo, kitMat);
    this.leftLeg.position.set(-0.11, 0.68, 0.14);
    this.rightLeg = new THREE.Mesh(legGeo, kitMat);
    this.rightLeg.position.set(0.11, 0.68, 0.14);

    this.riderGroup.add(
      barMesh,
      pelvis,
      torso,
      head,
      helmet,
      leftArm,
      rightArm,
      this.leftLeg,
      this.rightLeg
    );

    this.disposables.push(
      tireGeo,
      rimGeo,
      rimMat,
      frameGeo,
      seatPostGeo,
      forkGeo,
      lightGeo,
      barGeo,
      pelvisGeo,
      torsoGeo,
      rivalBibTex,
      rivalBibGeo,
      rivalBibMat,
      headGeo,
      skinMat,
      helmetGeo,
      armGeo,
      legGeo
    );
  }

  private createBibTexture(bibNumber: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 256, 192);
      ctx.fillStyle = '#e11d48';
      ctx.fillRect(6, 6, 244, 38);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PACE LEADER', 128, 25);
      ctx.fillStyle = '#0f172a';
      ctx.font = '900 96px sans-serif';
      ctx.fillText(bibNumber, 128, 114);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(18, 166, 220, 10);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildFloatingLabel(): void {
    this.labelTitle = new xb.UIText({
      text: '선두 라이더 (27.5 km/h)',
      pointerEvents: 'none',
      style: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fbbf24',
        textAlign: 'center',
      },
    });
    this.labelDetail = new xb.UIText({
      text: '거리차 +11.5m',
      pointerEvents: 'none',
      style: {
        fontSize: 15,
        color: '#e2e8f0',
        textAlign: 'center',
      },
    });

    this.labelCard = new xb.UICard({
      size: {width: 0.42, height: 'auto'},
      pointerEvents: 'none',
      style: {
        padding: 12,
        gap: 4,
        borderRadius: 18,
        backgroundColor: 'rgba(15, 23, 42, 0.82)',
      },
      children: [this.labelTitle, this.labelDetail],
    });
    this.labelCard.name = 'Rival pacer label';

    this.labelCard.add(
      new xb.FollowObject({
        target: this.riderGroup,
        mode: 'position',
        positionOffset: new THREE.Vector3(0, 1.72, 0),
      }),
      new xb.FaceCamera({mode: 'spherical', smoothing: 0.18})
    );
    this.add(this.labelCard);
  }

  public dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
