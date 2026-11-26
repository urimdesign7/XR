import * as THREE from 'three';
import * as xb from 'xrblocks';
import {BikeFocusPart, BikeSetupState, CyclingTelemetry} from '../types.ts';

export interface BikeOptimizerCallbacks {
  onSetupChange: <K extends keyof BikeSetupState>(
    key: K,
    value: BikeSetupState[K]
  ) => void;
  onAutoOptimize: () => void;
  onResetProblem: () => void;
  onToggleMode: () => void;
  onBackToRiding?: () => void;
}

export class BikeOptimizerCard extends xb.Script {
  private card!: xb.UICard;
  private scoreBadge!: xb.UIText;
  private recommendationText!: xb.UIText;

  private saddleValueText!: xb.UIText;
  private saddleSlider!: xb.UISlider;

  private cadenceValueText!: xb.UIText;
  private cadenceSlider!: xb.UISlider;

  private psiValueText!: xb.UIText;
  private psiSlider!: xb.UISlider;

  private cleatValueText!: xb.UIText;
  private cleatSlider!: xb.UISlider;

  private modeButton!: xb.UIButton;
  private callbacks: BikeOptimizerCallbacks;

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
    const nextScale = THREE.MathUtils.clamp(this.card.scale.x * factor, 0.65, 2.2);
    this.card.scale.setScalar(nextScale);
  };

  constructor(callbacks: BikeOptimizerCallbacks) {
    super();
    this.callbacks = callbacks;
  }

  public init(): void {
    window.addEventListener('wheel', this.onWheel, {
      passive: false,
      capture: true,
    });
    this.scoreBadge = new xb.UIText({
      text: '최적도 38%',
      style: {fontSize: 18, fontWeight: 'bold', color: '#fbbf24'},
    });

    this.recommendationText = new xb.UIText({
      text: '안장을 18mm 내려 발목 꺾임을 줄이세요',
      style: {
        width: '100%',
        fontSize: 15,
        lineHeight: 1.35,
        color: '#e2e8f0',
        padding: 10,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.07)',
      },
    });

    this.saddleValueText = new xb.UIText({
      text: '+18 mm (최적 0)',
      style: {fontSize: 14, fontWeight: 'bold', color: '#fbbf24'},
    });
    this.saddleSlider = new xb.UISlider({
      ariaLabel: '안장 높이 조정',
      min: -25,
      max: 25,
      step: 1,
      value: 18,
      style: {width: '100%', height: 34},
      onInput: (val) => this.callbacks.onSetupChange('saddleOffsetMm', val),
      onChange: (val) => this.callbacks.onSetupChange('saddleOffsetMm', val),
    });

    this.cadenceValueText = new xb.UIText({
      text: '62 RPM (최적 88)',
      style: {fontSize: 14, fontWeight: 'bold', color: '#fbbf24'},
    });
    this.cadenceSlider = new xb.UISlider({
      ariaLabel: '기어 케이던스 조정',
      min: 60,
      max: 100,
      step: 1,
      value: 62,
      style: {width: '100%', height: 34},
      onInput: (val) => this.callbacks.onSetupChange('cadenceRpm', val),
      onChange: (val) => this.callbacks.onSetupChange('cadenceRpm', val),
    });

    this.psiValueText = new xb.UIText({
      text: '70 PSI (최적 98)',
      style: {fontSize: 14, fontWeight: 'bold', color: '#fbbf24'},
    });
    this.psiSlider = new xb.UISlider({
      ariaLabel: '타이어 공기압 조정',
      min: 65,
      max: 115,
      step: 1,
      value: 70,
      style: {width: '100%', height: 34},
      onInput: (val) => this.callbacks.onSetupChange('tirePsi', val),
      onChange: (val) => this.callbacks.onSetupChange('tirePsi', val),
    });

    this.cleatValueText = new xb.UIText({
      text: '+8 mm (최적 -2)',
      style: {fontSize: 14, fontWeight: 'bold', color: '#fbbf24'},
    });
    this.cleatSlider = new xb.UISlider({
      ariaLabel: '클릿 위치 조정',
      min: -10,
      max: 10,
      step: 1,
      value: 8,
      style: {width: '100%', height: 34},
      onInput: (val) => this.callbacks.onSetupChange('cleatOffsetMm', val),
      onChange: (val) => this.callbacks.onSetupChange('cleatOffsetMm', val),
    });

    const autoOptimizeBtn = new xb.UIButton({
      label: '최적 상태 맞춤',
      icon: 'auto_fix_high',
      style: {flexGrow: 1},
      onClick: () => this.callbacks.onAutoOptimize(),
    });

    const resetBtn = new xb.UIButton({
      label: '문제 상태',
      icon: 'restart_alt',
      style: {flexGrow: 1},
      onClick: () => this.callbacks.onResetProblem(),
    });

    this.modeButton = new xb.UIButton({
      label: 'AR 패스스루',
      icon: 'view_in_ar',
      style: {width: '100%'},
      onClick: () => this.callbacks.onToggleMode(),
    });

    this.card = new xb.UICard({
      size: {width: 0.6, height: 'auto'},
      manipulation: {
        actions: {
          translate: {
            faceCamera: true,
            scaleWithDistance: true,
            minDistance: 0.45,
            maxDistance: 2.8,
          },
          scale: {
            minScale: 0.65,
            maxScale: 2.2,
          },
          resize: {
            anchor: 'center',
            minSize: {width: 0.44},
            maxSize: {width: 1.15},
          },
        },
      },
      edge: {translateFromSurface: true},
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 18,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          },
          children: [
            new xb.UIButton({
              label: '주행 화면 (ESC)',
              icon: 'arrow_back',
              pointerEvents: 'auto',
              style: {
                height: 34,
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: 14,
                backgroundColor: 'rgba(2, 132, 199, 0.85)',
              },
              onClick: () => this.callbacks.onBackToRiding?.(),
            }),
            new xb.UIText({
              text: '자전거 최적화 코치',
              style: {fontSize: 20, fontWeight: 'bold'},
            }),
            this.scoreBadge,
          ],
        }),
        this.recommendationText,
        this.createSliderRow('안장 높이 (발목/무릎)', this.saddleValueText),
        this.saddleSlider,
        this.createSliderRow('기어 · 케이던스', this.cadenceValueText),
        this.cadenceSlider,
        this.createSliderRow('타이어 공기압', this.psiValueText),
        this.psiSlider,
        this.createSliderRow('클릿 앞뒤 위치', this.cleatValueText),
        this.cleatSlider,
        new xb.UIPanel({
          style: {width: '100%', flexDirection: 'row', gap: 10, marginTop: 4},
          children: [autoOptimizeBtn, resetBtn],
        }),
        this.modeButton,
      ],
    });

    this.card.name = 'Bike Optimization Controls';
    this.card.position.set(-0.54, 1.24, -1.14);
    this.card.rotation.y = 0.22;
    this.add(this.card);
  }

  public getCardRoot(): xb.UICard {
    return this.card;
  }

  public setScreenVisible(visible: boolean): void {
    this.visible = visible;
    if (this.card) {
      this.card.visible = visible;
    }
  }

  public setArModeLabel(isArMode: boolean): void {
    if (!this.modeButton) return;
    this.modeButton.label = isArMode ? '한강 VR 보기' : 'AR 패스스루';
  }

  public highlightFocusPart(part: BikeFocusPart): void {
    if (part === 'saddle') {
      this.recommendationText.text =
        '안장 높이 진단: 높으면 페달 하단에서 발목이 꺾여 아킬레스건 통증이 심해집니다. (목표: 0mm)';
    } else if (part === 'ankle') {
      this.recommendationText.text =
        '발목 & 기어 진단: 무거운 기어(62 RPM)와 앞쏠린 클릿(+8mm)을 88 RPM / -2mm로 맞추세요.';
    } else if (part === 'tire') {
      this.recommendationText.text =
        '타이어 공기압 진단: 70 PSI는 한강 아스팔트 구름 저항을 크게 높입니다. (목표: 98 PSI)';
    }
  }

  public syncState(setup: BikeSetupState, telemetry: CyclingTelemetry): void {
    const saddleRounded = Math.round(setup.saddleOffsetMm);
    const cadenceRounded = Math.round(setup.cadenceRpm);
    const psiRounded = Math.round(setup.tirePsi);
    const cleatRounded = Math.round(setup.cleatOffsetMm);

    const optCadence = telemetry.bikeProfile.optimalCadenceRpm;
    const optPsi = telemetry.bikeProfile.optimalTirePsi;

    this.saddleSlider.value = saddleRounded;
    this.cadenceSlider.value = cadenceRounded;
    this.psiSlider.value = psiRounded;
    this.cleatSlider.value = cleatRounded;

    this.saddleValueText.text = `${saddleRounded > 0 ? '+' : ''}${saddleRounded} mm (최적 0)`;
    this.saddleValueText.style.color = Math.abs(saddleRounded) <= 3 ? '#34d399' : '#fbbf24';

    this.cadenceValueText.text = `${cadenceRounded} RPM (최적 ${optCadence})`;
    this.cadenceValueText.style.color =
      Math.abs(cadenceRounded - optCadence) <= 4 ? '#34d399' : '#fbbf24';

    this.psiValueText.text = `${psiRounded} PSI (최적 ${optPsi})`;
    this.psiValueText.style.color =
      Math.abs(psiRounded - optPsi) <= 4 ? '#34d399' : '#fbbf24';

    this.cleatValueText.text = `${cleatRounded > 0 ? '+' : ''}${cleatRounded} mm (최적 -2)`;
    this.cleatValueText.style.color = Math.abs(cleatRounded + 2) <= 2 ? '#34d399' : '#fbbf24';

    this.scoreBadge.text = `최적도 ${telemetry.optimizationScore}%`;
    this.scoreBadge.style.color =
      telemetry.optimizationScore >= 90 ? '#22d3ee' : '#fbbf24';

    this.recommendationText.text = telemetry.ankleRecommendation;
  }

  private createSliderRow(title: string, valueText: xb.UIText): xb.UIPanel {
    return new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
      children: [
        new xb.UIText({
          text: title,
          style: {fontSize: 15, color: '#cbd5e1'},
        }),
        valueText,
      ],
    });
  }

  public dispose(): void {
    window.removeEventListener('wheel', this.onWheel, true);
  }
}
