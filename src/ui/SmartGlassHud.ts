import * as THREE from 'three';
import * as xb from 'xrblocks';
import {BIKE_PROFILES} from '../physics/BikeBiomechanics.ts';
import {BikeModelId, BikeProfile, CyclingTelemetry} from '../types.ts';

interface MetricRefs {
  value: xb.UIText;
  sub: xb.UIText;
}

export interface SmartGlassHudCallbacks {
  onSelectBikeModel?: (id: BikeModelId) => void;
  onApplyOptimalGear?: () => void;
  onOpenOptimizer?: () => void;
}

type HudTab = 'dashboard' | 'bikeIntro';

const DEFAULT_HUD_WIDTH = 0.86;
const DEFAULT_HUD_OFFSET = new THREE.Vector3(-0.15, 0.14, -1.16);
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.4;

const _resetPos = new THREE.Vector3();

export class SmartGlassHud extends xb.Script {
  private callbacks: SmartGlassHudCallbacks;
  private card: xb.UICard | null = null;
  private followHead: xb.FollowHead | null = null;
  private activeTab: HudTab = 'dashboard';

  private dashboardTabBtn!: xb.UIButton;
  private bikeIntroTabBtn!: xb.UIButton;
  private activeBikeBadge!: xb.UIText;

  private dashboardPanel!: xb.UIPanel;
  private bikeIntroPanel!: xb.UIPanel;

  private speedMetric!: MetricRefs;
  private hrMetric!: MetricRefs;
  private ankleMetric!: MetricRefs;
  private fitMetric!: MetricRefs;
  private rivalMetric!: MetricRefs;
  private hudGearTitle!: xb.UIText;
  private hudGearDetail!: xb.UIText;
  private coachBanner!: xb.UIText;
  private zoomLabel!: xb.UIText;

  // Bike introduction & road optimal gear screen refs
  private bikeSelectButtons = new Map<BikeModelId, xb.UIButton>();
  private introTitleText!: xb.UIText;
  private introCategoryText!: xb.UIText;
  private introSummaryText!: xb.UIText;
  private introDrivetrainText!: xb.UIText;
  private introTireText!: xb.UIText;
  private introWeightText!: xb.UIText;
  private introOptimalGearHeadline!: xb.UIText;
  private introCurrentGearText!: xb.UIText;
  private introFlatGuideText!: xb.UIText;
  private introClimbGuideText!: xb.UIText;
  private introSprintGuideText!: xb.UIText;

  private lastReportedZoomPct = 100;
  private lastBikeId: BikeModelId = 'aero-road';

  private onWheel = (event: WheelEvent): void => {
    if (
      !this.visible ||
      !this.card ||
      !this.card.visible ||
      !xb.core.user?.isPointingAt(this.card)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    this.adjustZoom(factor);
  };

  constructor(callbacks: SmartGlassHudCallbacks = {}) {
    super();
    this.callbacks = callbacks;
  }

  public init(): void {
    const defaultBike = BIKE_PROFILES[0];

    this.speedMetric = this.createMetric('현재 속도', '21.4 km/h', '한강 순항');
    this.hrMetric = this.createMetric('예상 심박수', '167 BPM', 'Z5 과부하');
    this.ankleMetric = this.createMetric('발목 부담', '82%', '각도 28° 주의');
    this.fitMetric = this.createMetric('자전거 최적도', '38%', '조정 필요');
    this.rivalMetric = this.createMetric('선두 라이더', '+11.5 m', '27.5 km/h');

    this.zoomLabel = new xb.UIText({
      text: '100%',
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#e2e8f0',
        minWidth: 40,
        textAlign: 'center',
      },
    });

    this.hudGearTitle = new xb.UIText({
      text: `도로 최적 기어 (${defaultBike.shortName}): ${defaultBike.optimalGearLabel} · ${defaultBike.optimalCadenceRpm} RPM`,
      pointerEvents: 'none',
      style: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#7dd3fc',
      },
    });

    this.hudGearDetail = new xb.UIText({
      text: `현재: 앞 2단(52T) × 뒤 2단(12T) · 62 RPM → 뒤 기어 3~4단 낮춰 ${defaultBike.optimalGearLabel} 권장`,
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        color: '#fde68a',
      },
    });

    this.coachBanner = new xb.UIText({
      text: '스마트 글라스 진단 중: 안장 높이와 무거운 기어가 발목 부담과 속도 저하를 유발하고 있습니다.',
      pointerEvents: 'none',
      style: {
        width: '100%',
        fontSize: 15,
        lineHeight: 1.3,
        color: '#e2e8f0',
        textAlign: 'center',
      },
    });

    const zoomOutBtn = new xb.UIButton({
      icon: 'zoom_out',
      ariaLabel: '글라스 축소',
      pointerEvents: 'auto',
      style: {
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: 16,
      },
      onClick: () => this.adjustZoom(1 / 1.15),
    });

    const zoomInBtn = new xb.UIButton({
      icon: 'zoom_in',
      ariaLabel: '글라스 확대',
      pointerEvents: 'auto',
      style: {
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: 16,
      },
      onClick: () => this.adjustZoom(1.15),
    });

    const resetBtn = new xb.UIButton({
      icon: 'center_focus_strong',
      ariaLabel: '글라스 위치 및 크기 초기화',
      pointerEvents: 'auto',
      style: {
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: 16,
      },
      onClick: () => this.resetPoseAndZoom(),
    });

    const headerBar = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      },
      children: [
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          },
          children: [
            new xb.UIExitButton({
              pointerEvents: 'auto',
              style: {
                position: 'relative',
                top: 0,
                left: 0,
                width: 32,
                height: 32,
              },
            }),
            new xb.UIIcon({
              icon: 'directions_bike',
              pointerEvents: 'none',
              style: {width: 20, height: 20, color: '#38bdf8'},
            }),
            new xb.UIText({
              text: '한강 XR 스마트 글라스 · 주행 핏 코치',
              pointerEvents: 'none',
              style: {
                fontSize: 16,
                fontWeight: 'bold',
                color: '#f8fafc',
              },
            }),
          ],
        }),
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 6,
            paddingRight: 6,
            paddingTop: 3,
            paddingBottom: 3,
            borderRadius: 18,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          },
          children: [zoomOutBtn, this.zoomLabel, zoomInBtn, resetBtn],
        }),
      ],
    });

    // Tab navigation row: Driving HUD vs Bike Introduction & Optimal Gear Guide
    this.dashboardTabBtn = new xb.UIButton({
      label: '주행 계기판',
      icon: 'speed',
      pointerEvents: 'auto',
      style: {
        height: 36,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 18,
        backgroundColor: 'rgba(2, 132, 199, 0.85)',
      },
      onClick: () => this.setActiveTab('dashboard'),
    });

    this.bikeIntroTabBtn = new xb.UIButton({
      label: '자전거 소개 · 최적 기어',
      icon: 'pedal_bike',
      pointerEvents: 'auto',
      style: {
        height: 36,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 18,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
      },
      onClick: () => this.setActiveTab('bikeIntro'),
    });

    this.activeBikeBadge = new xb.UIText({
      text: `탑승 기종: ${defaultBike.shortName}`,
      pointerEvents: 'none',
      style: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#a5f3fc',
      },
    });

    const openOptimizerBtn = new xb.UIButton({
      label: '자전거 최적화 · 3D 회전',
      icon: 'tune',
      pointerEvents: 'auto',
      style: {
        height: 36,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 18,
        backgroundColor: 'rgba(5, 150, 105, 0.85)',
      },
      onClick: () => this.callbacks.onOpenOptimizer?.(),
    });

    const tabBar = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      },
      children: [
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          },
          children: [this.dashboardTabBtn, this.bikeIntroTabBtn, openOptimizerBtn],
        }),
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 14,
            backgroundColor: 'rgba(14, 165, 233, 0.16)',
          },
          children: [this.activeBikeBadge],
        }),
      ],
    });

    // 1) Dashboard Tab Content
    const metricsRow = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
      },
      children: [
        this.createMetricTile(this.speedMetric),
        this.createMetricTile(this.hrMetric),
        this.createMetricTile(this.ankleMetric),
        this.createMetricTile(this.fitMetric),
        this.createMetricTile(this.rivalMetric),
      ],
    });

    const hudGearStrip = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 3,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 14,
        backgroundColor: 'rgba(14, 165, 233, 0.12)',
      },
      children: [this.hudGearTitle, this.hudGearDetail],
    });

    this.dashboardPanel = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 10,
        display: 'flex',
      },
      children: [metricsRow, hudGearStrip, this.coachBanner],
    });

    // 2) Bike Introduction & Optimal Road Gear Guide Tab Content
    this.bikeIntroPanel = this.buildBikeIntroPanel(defaultBike);

    const interactionHint = new xb.UIText({
      text: '마우스로 글라스를 드래그해 이동 · 모서리 드래그 / 휠 / + - 버튼으로 확대·축소',
      pointerEvents: 'none',
      style: {
        width: '100%',
        fontSize: 12,
        color: '#94a3b8',
        textAlign: 'center',
      },
    });

    this.card = new xb.UICard({
      size: {width: DEFAULT_HUD_WIDTH, height: 'auto'},
      manipulation: {
        actions: {
          translate: {
            faceCamera: true,
            scaleWithDistance: true,
            minDistance: 0.45,
            maxDistance: 2.8,
          },
          scale: {
            minScale: MIN_ZOOM,
            maxScale: MAX_ZOOM,
          },
          resize: {
            anchor: 'center',
            minSize: {width: 0.58},
            maxSize: {width: 1.55},
          },
        },
      },
      edge: {translateFromSurface: true},
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        borderRadius: 24,
        backgroundColor: 'rgba(9, 14, 26, 0.82)',
      },
      children: [
        headerBar,
        tabBar,
        this.dashboardPanel,
        this.bikeIntroPanel,
        interactionHint,
      ],
    });
    this.card.name = 'Smart Glass Cycling HUD';
    this.card.position.set(
      DEFAULT_HUD_OFFSET.x,
      1.6 + DEFAULT_HUD_OFFSET.y,
      DEFAULT_HUD_OFFSET.z
    );

    this.followHead = new xb.FollowHead({
      offset: DEFAULT_HUD_OFFSET.clone(),
      smoothing: 0.12,
    });
    this.card.add(
      this.followHead,
      new xb.FaceCamera({mode: 'capsule', smoothing: 0.14})
    );
    this.add(this.card);

    window.addEventListener('wheel', this.onWheel, {
      passive: false,
      capture: true,
    });
  }

  private buildBikeIntroPanel(initialBike: BikeProfile): xb.UIPanel {
    const bikeButtons: xb.UIButton[] = BIKE_PROFILES.map((profile, idx) => {
      const btn = new xb.UIButton({
        label: profile.shortName,
        icon: 'directions_bike',
        pointerEvents: 'auto',
        style: {
          flexGrow: 1,
          height: 36,
          borderRadius: 14,
          backgroundColor:
            idx === 0 ? 'rgba(2, 132, 199, 0.85)' : 'rgba(255, 255, 255, 0.08)',
        },
        onClick: () => {
          this.callbacks.onSelectBikeModel?.(profile.id);
        },
      });
      this.bikeSelectButtons.set(profile.id, btn);
      return btn;
    });

    const bikeSelectorRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
      },
      children: bikeButtons,
    });

    this.introTitleText = new xb.UIText({
      text: initialBike.fullName,
      pointerEvents: 'none',
      style: {fontSize: 20, fontWeight: 'bold', color: '#ffffff'},
    });

    this.introCategoryText = new xb.UIText({
      text: initialBike.category,
      pointerEvents: 'none',
      style: {fontSize: 13, fontWeight: 'bold', color: '#38bdf8'},
    });

    this.introSummaryText = new xb.UIText({
      text: initialBike.summary,
      pointerEvents: 'none',
      style: {width: '100%', fontSize: 14, lineHeight: 1.35, color: '#cbd5e1'},
    });

    this.introDrivetrainText = new xb.UIText({
      text: initialBike.drivetrain,
      pointerEvents: 'none',
      style: {fontSize: 13, fontWeight: 'bold', color: '#f8fafc'},
    });

    this.introTireText = new xb.UIText({
      text: `${initialBike.tires} · 최적 ${initialBike.optimalTirePsi} PSI`,
      pointerEvents: 'none',
      style: {fontSize: 13, fontWeight: 'bold', color: '#f8fafc'},
    });

    this.introWeightText = new xb.UIText({
      text: `${initialBike.weightKg.toFixed(1)} kg`,
      pointerEvents: 'none',
      style: {fontSize: 13, fontWeight: 'bold', color: '#f8fafc'},
    });

    const specGrid = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
      },
      children: [
        this.createSpecTile('구동계 · 기어', this.introDrivetrainText),
        this.createSpecTile('타이어 · 공기압', this.introTireText),
        this.createSpecTile('차체 무게', this.introWeightText, 0.55),
      ],
    });

    const overviewCard = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          },
          children: [this.introTitleText, this.introCategoryText],
        }),
        this.introSummaryText,
        specGrid,
      ],
    });

    this.introOptimalGearHeadline = new xb.UIText({
      text: `도로 최적 기어변속: ${initialBike.optimalGearLabel} (기어비 ${initialBike.optimalGearRatio} · 목표 ${initialBike.optimalCadenceRpm} RPM)`,
      pointerEvents: 'none',
      style: {
        width: '100%',
        fontSize: 16,
        fontWeight: 'bold',
        color: '#22d3ee',
      },
    });

    this.introCurrentGearText = new xb.UIText({
      text: `현재 주행 기어: 앞 2단(52T) × 뒤 2단(12T) · 62 RPM → 뒤 기어를 ${initialBike.optimalGearLabel}로 낮추세요`,
      pointerEvents: 'none',
      style: {width: '100%', fontSize: 13, color: '#fde68a'},
    });

    this.introFlatGuideText = new xb.UIText({
      text: `• 평지 도로: ${initialBike.flatRoadGuide}`,
      pointerEvents: 'none',
      style: {width: '100%', fontSize: 13, color: '#e2e8f0'},
    });

    this.introClimbGuideText = new xb.UIText({
      text: `• 맞바람·다리 오르막: ${initialBike.climbWindGuide}`,
      pointerEvents: 'none',
      style: {width: '100%', fontSize: 13, color: '#cbd5e1'},
    });

    this.introSprintGuideText = new xb.UIText({
      text: `• 추월·가속 구간: ${initialBike.sprintGuide}`,
      pointerEvents: 'none',
      style: {width: '100%', fontSize: 13, color: '#cbd5e1'},
    });

    const gearGuideCard = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 6,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(14, 165, 233, 0.14)',
      },
      children: [
        this.introOptimalGearHeadline,
        this.introCurrentGearText,
        this.introFlatGuideText,
        this.introClimbGuideText,
        this.introSprintGuideText,
      ],
    });

    const actionsRow = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 8,
      },
      children: [
        new xb.UIButton({
          label: '이 자전거 최적 기어·공기압 적용',
          icon: 'auto_fix_high',
          pointerEvents: 'auto',
          style: {flexGrow: 1, height: 38, borderRadius: 14},
          onClick: () => this.callbacks.onApplyOptimalGear?.(),
        }),
        new xb.UIButton({
          label: '3D 회전 · 세부 최적화',
          icon: '360',
          pointerEvents: 'auto',
          style: {
            height: 38,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 14,
            backgroundColor: 'rgba(5, 150, 105, 0.82)',
          },
          onClick: () => this.callbacks.onOpenOptimizer?.(),
        }),
        new xb.UIButton({
          label: '주행 계기판으로',
          icon: 'speed',
          pointerEvents: 'auto',
          style: {height: 38, paddingLeft: 14, paddingRight: 14, borderRadius: 14},
          onClick: () => this.setActiveTab('dashboard'),
        }),
      ],
    });

    const panel = new xb.UIPanel({
      visible: false,
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 10,
        display: 'none',
      },
      children: [bikeSelectorRow, overviewCard, gearGuideCard, actionsRow],
    });

    return panel;
  }

  private createSpecTile(
    label: string,
    valueText: xb.UIText,
    flexGrow = 1
  ): xb.UIPanel {
    return new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        flexGrow,
        flexBasis: 0,
        flexDirection: 'column',
        gap: 3,
        padding: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [
        new xb.UIText({
          text: label,
          pointerEvents: 'none',
          style: {fontSize: 12, color: '#94a3b8'},
        }),
        valueText,
      ],
    });
  }

  public setActiveTab(tab: HudTab): void {
    this.activeTab = tab;
    const isDashboard = tab === 'dashboard';

    this.dashboardPanel.visible = isDashboard;
    this.dashboardPanel.style.display = isDashboard ? 'flex' : 'none';

    this.bikeIntroPanel.visible = !isDashboard;
    this.bikeIntroPanel.style.display = isDashboard ? 'none' : 'flex';

    this.dashboardTabBtn.style.backgroundColor = isDashboard
      ? 'rgba(2, 132, 199, 0.85)'
      : 'rgba(255, 255, 255, 0.1)';
    this.bikeIntroTabBtn.style.backgroundColor = !isDashboard
      ? 'rgba(2, 132, 199, 0.85)'
      : 'rgba(255, 255, 255, 0.1)';
  }

  public getActiveTab(): HudTab {
    return this.activeTab;
  }

  public getCardRoot(): xb.UICard | null {
    return this.card;
  }

  public setScreenVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.card) return;
    this.card.visible = visible;
    if (visible) {
      this.resetPoseAndZoom();
    } else {
      this.followHead?.suspend();
    }
  }

  public update(): void {
    if (!this.visible || !this.card) return;
    const zoomPct = Math.round(this.card.scale.x * 100);
    if (zoomPct !== this.lastReportedZoomPct) {
      this.lastReportedZoomPct = zoomPct;
      this.zoomLabel.text = `${zoomPct}%`;
    }
  }

  public updateTelemetry(t: CyclingTelemetry): void {
    if (!this.card) return;

    this.speedMetric.value.text = `${t.speedKmh.toFixed(1)} km/h`;
    this.speedMetric.value.style.color =
      t.speedKmh >= 29 ? '#34d399' : t.speedKmh >= 25 ? '#38bdf8' : '#fbbf24';
    this.speedMetric.sub.text = `${t.powerWatts} W 출력`;

    this.hrMetric.value.text = `${t.estimatedHrBpm} BPM`;
    this.hrMetric.value.style.color =
      t.estimatedHrBpm >= 164 ? '#f87171' : t.estimatedHrBpm >= 153 ? '#fbbf24' : '#34d399';
    this.hrMetric.sub.text = t.hrZoneLabel;

    this.ankleMetric.value.text = `${t.ankleStrainPct}%`;
    this.ankleMetric.value.style.color =
      t.ankleStrainPct >= 55 ? '#f87171' : t.ankleStrainPct >= 30 ? '#fbbf24' : '#34d399';
    this.ankleMetric.sub.text =
      t.ankleStrainPct >= 45
        ? `각도 ${t.ankleAngleDeg}° 통증`
        : `각도 ${t.ankleAngleDeg}° 편안`;

    this.fitMetric.value.text = `${t.optimizationScore}%`;
    this.fitMetric.value.style.color =
      t.optimizationScore >= 88 ? '#22d3ee' : t.optimizationScore >= 65 ? '#fbbf24' : '#f87171';
    this.fitMetric.sub.text =
      t.optimizationScore >= 90 ? '최적 세팅 완료' : `손실 -${t.rollingLossW + t.drivetrainLossW}W`;

    if (t.overtakingState === 'overtaken') {
      this.rivalMetric.value.text = `-${Math.abs(t.rivalGapMeters).toFixed(1)} m`;
      this.rivalMetric.value.style.color = '#34d399';
      this.rivalMetric.sub.text = '추월 성공!';
    } else if (t.overtakingState === 'catching') {
      this.rivalMetric.value.text = `+${t.rivalGapMeters.toFixed(1)} m`;
      this.rivalMetric.value.style.color = '#38bdf8';
      this.rivalMetric.sub.text = '빠르게 추격 중';
    } else {
      this.rivalMetric.value.text = `+${t.rivalGapMeters.toFixed(1)} m`;
      this.rivalMetric.value.style.color = '#fbbf24';
      this.rivalMetric.sub.text = '상대 27.5 km/h';
    }

    const bike = t.bikeProfile;
    this.activeBikeBadge.text = `탑승 기종: ${bike.shortName}`;

    this.hudGearTitle.text = `도로 최적 기어 (${bike.shortName}): ${bike.optimalGearLabel} · ${bike.optimalCadenceRpm} RPM`;
    this.hudGearDetail.text = `현재: ${t.currentGearLabel} → ${t.gearAdvice}`;
    this.hudGearDetail.style.color = t.isGearOptimal ? '#6ee7b7' : '#fde68a';

    this.coachBanner.text = t.diagnosisSummary;
    this.coachBanner.style.color =
      t.optimizationScore >= 90 ? '#a7f3d0' : '#fef08a';

    // Update Bike Introduction & Optimal Gear Screen
    if (bike.id !== this.lastBikeId) {
      this.lastBikeId = bike.id;
      for (const [id, btn] of this.bikeSelectButtons.entries()) {
        btn.style.backgroundColor =
          id === bike.id ? 'rgba(2, 132, 199, 0.85)' : 'rgba(255, 255, 255, 0.08)';
      }
      this.introTitleText.text = bike.fullName;
      this.introCategoryText.text = bike.category;
      this.introSummaryText.text = bike.summary;
      this.introDrivetrainText.text = bike.drivetrain;
      this.introTireText.text = `${bike.tires} · 최적 ${bike.optimalTirePsi} PSI`;
      this.introWeightText.text = `${bike.weightKg.toFixed(1)} kg`;
      this.introOptimalGearHeadline.text = `도로 최적 기어변속: ${bike.optimalGearLabel} (기어비 ${bike.optimalGearRatio} · 목표 ${bike.optimalCadenceRpm} RPM)`;
      this.introFlatGuideText.text = `• 평지 도로: ${bike.flatRoadGuide}`;
      this.introClimbGuideText.text = `• 맞바람·다리 오르막: ${bike.climbWindGuide}`;
      this.introSprintGuideText.text = `• 추월·가속 구간: ${bike.sprintGuide}`;
    }

    this.introCurrentGearText.text = `현재 상태: ${t.currentGearLabel} — ${t.gearAdvice}`;
    this.introCurrentGearText.style.color = t.isGearOptimal ? '#6ee7b7' : '#fde68a';
  }

  private adjustZoom(factor: number): void {
    if (!this.card) return;
    const nextScale = THREE.MathUtils.clamp(
      this.card.scale.x * factor,
      MIN_ZOOM,
      MAX_ZOOM
    );
    this.card.scale.setScalar(nextScale);
    const pct = Math.round(nextScale * 100);
    this.lastReportedZoomPct = pct;
    this.zoomLabel.text = `${pct}%`;
  }

  private resetPoseAndZoom(): void {
    if (!this.card) return;
    this.followHead?.suspend();
    const cam = xb.core.camera;
    if (cam) {
      _resetPos
        .copy(DEFAULT_HUD_OFFSET)
        .applyQuaternion(cam.quaternion)
        .add(cam.position);
      this.card.position.copy(_resetPos);
    } else {
      this.card.position.set(
        DEFAULT_HUD_OFFSET.x,
        1.6 + DEFAULT_HUD_OFFSET.y,
        DEFAULT_HUD_OFFSET.z
      );
    }
    this.card.scale.setScalar(1);
    this.card.size = {width: DEFAULT_HUD_WIDTH, height: 'auto'};
    this.lastReportedZoomPct = 100;
    this.zoomLabel.text = '100%';
    this.followHead?.resume();
  }

  private createMetric(label: string, value: string, sub: string): MetricRefs {
    void label;
    return {
      value: new xb.UIText({
        text: value,
        pointerEvents: 'none',
        style: {fontSize: 22, fontWeight: 'bold', color: '#ffffff', textAlign: 'center'},
      }),
      sub: new xb.UIText({
        text: sub,
        pointerEvents: 'none',
        style: {fontSize: 13, color: '#94a3b8', textAlign: 'center'},
      }),
    };
  }

  private createMetricTile(refs: MetricRefs): xb.UIPanel {
    const labelMap = new Map<MetricRefs, string>([
      [this.speedMetric, '현재 속도'],
      [this.hrMetric, '예상 심박수'],
      [this.ankleMetric, '발목 부담'],
      [this.fitMetric, '자전거 최적도'],
      [this.rivalMetric, '선두 라이더'],
    ]);
    return new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        flexGrow: 1,
        flexBasis: 0,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 10,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [
        new xb.UIText({
          text: labelMap.get(refs) ?? '',
          pointerEvents: 'none',
          style: {fontSize: 13, color: '#cbd5e1', textAlign: 'center'},
        }),
        refs.value,
        refs.sub,
      ],
    });
  }

  public dispose(): void {
    window.removeEventListener('wheel', this.onWheel, true);
  }
}
