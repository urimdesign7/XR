import * as THREE from 'three';
import * as xb from 'xrblocks';
import {CyclingTelemetry} from '../types.ts';

const DEFAULT_WIDTH = 0.42;
const DEFAULT_OFFSET = new THREE.Vector3(0.54, 0.14, -1.14);
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.2;

const _resetPos = new THREE.Vector3();

export class RightStatusGlassCard extends xb.Script {
  private card: xb.UICard | null = null;
  private followHead: xb.FollowHead | null = null;

  private weatherBadgeText!: xb.UIText;
  private tempValueText!: xb.UIText;
  private humidityValueText!: xb.UIText;
  private windValueText!: xb.UIText;

  private destinationText!: xb.UIText;
  private remainingKmText!: xb.UIText;
  private etaText!: xb.UIText;
  private progressPctText!: xb.UIText;
  private progressFillPanel!: xb.UIPanel;
  private progressSubText!: xb.UIText;
  private zoomLabel!: xb.UIText;

  private lastReportedZoomPct = 100;

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

  public init(): void {
    this.weatherBadgeText = new xb.UIText({
      text: '맑음 · 한강 낮',
      pointerEvents: 'none',
      style: {fontSize: 15, fontWeight: 'bold', color: '#fde68a'},
    });

    this.tempValueText = new xb.UIText({
      text: '19°C',
      pointerEvents: 'none',
      style: {fontSize: 20, fontWeight: 'bold', color: '#ffffff', textAlign: 'center'},
    });

    this.humidityValueText = new xb.UIText({
      text: '46%',
      pointerEvents: 'none',
      style: {fontSize: 20, fontWeight: 'bold', color: '#7dd3fc', textAlign: 'center'},
    });

    this.windValueText = new xb.UIText({
      text: '북서 2.8m/s',
      pointerEvents: 'none',
      style: {fontSize: 16, fontWeight: 'bold', color: '#a7f3d0', textAlign: 'center'},
    });

    this.destinationText = new xb.UIText({
      text: '반포 한강공원',
      pointerEvents: 'none',
      style: {fontSize: 19, fontWeight: 'bold', color: '#ffffff'},
    });

    this.remainingKmText = new xb.UIText({
      text: '4.85 km',
      pointerEvents: 'none',
      style: {fontSize: 26, fontWeight: 'bold', color: '#38bdf8'},
    });

    this.etaText = new xb.UIText({
      text: '도착 약 14분',
      pointerEvents: 'none',
      style: {fontSize: 13, color: '#cbd5e1'},
    });

    this.progressPctText = new xb.UIText({
      text: '39%',
      pointerEvents: 'none',
      style: {fontSize: 22, fontWeight: 'bold', color: '#34d399'},
    });

    this.progressFillPanel = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '39%',
        height: '100%',
        borderRadius: 6,
        backgroundColor: '#34d399',
      },
    });

    this.progressSubText = new xb.UIText({
      text: '전체 8.0 km 중 3.15 km 주행',
      pointerEvents: 'none',
      style: {fontSize: 12, color: '#94a3b8'},
    });

    this.zoomLabel = new xb.UIText({
      text: '100%',
      pointerEvents: 'none',
      style: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#e2e8f0',
        minWidth: 36,
        textAlign: 'center',
      },
    });

    const headerBar = new xb.UIPanel({
      style: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      },
      children: [
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {flexDirection: 'row', alignItems: 'center', gap: 6},
          children: [
            new xb.UIIcon({
              icon: 'wb_sunny',
              pointerEvents: 'none',
              style: {width: 18, height: 18, color: '#facc15'},
            }),
            this.weatherBadgeText,
          ],
        }),
        new xb.UIPanel({
          style: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 14,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          },
          children: [
            new xb.UIButton({
              icon: 'zoom_out',
              ariaLabel: '우측 글라스 축소',
              pointerEvents: 'auto',
              style: {width: 26, height: 26, padding: 0, borderRadius: 13},
              onClick: () => this.adjustZoom(1 / 1.15),
            }),
            this.zoomLabel,
            new xb.UIButton({
              icon: 'zoom_in',
              ariaLabel: '우측 글라스 확대',
              pointerEvents: 'auto',
              style: {width: 26, height: 26, padding: 0, borderRadius: 13},
              onClick: () => this.adjustZoom(1.15),
            }),
          ],
        }),
      ],
    });

    const weatherGrid = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'row',
        gap: 6,
      },
      children: [
        this.createMiniTile('온도', this.tempValueText),
        this.createMiniTile('습도', this.humidityValueText),
        this.createMiniTile('바람', this.windValueText),
      ],
    });

    const weatherSection = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [headerBar, weatherGrid],
    });

    const progressTrack = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: 11,
        borderRadius: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
        overflow: 'hidden',
      },
      children: [this.progressFillPanel],
    });

    const routeSection = new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        width: '100%',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        borderRadius: 16,
        backgroundColor: 'rgba(14, 165, 233, 0.12)',
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
          children: [
            new xb.UIPanel({
              pointerEvents: 'none',
              style: {flexDirection: 'row', alignItems: 'center', gap: 6},
              children: [
                new xb.UIIcon({
                  icon: 'flag',
                  pointerEvents: 'none',
                  style: {width: 18, height: 18, color: '#38bdf8'},
                }),
                new xb.UIText({
                  text: '목적지',
                  pointerEvents: 'none',
                  style: {fontSize: 13, color: '#94a3b8'},
                }),
              ],
            }),
            this.etaText,
          ],
        }),
        this.destinationText,
        new xb.UIPanel({
          pointerEvents: 'none',
          style: {
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
          },
          children: [
            new xb.UIPanel({
              pointerEvents: 'none',
              style: {flexDirection: 'column', gap: 2},
              children: [
                new xb.UIText({
                  text: '남은 거리',
                  pointerEvents: 'none',
                  style: {fontSize: 12, color: '#94a3b8'},
                }),
                this.remainingKmText,
              ],
            }),
            new xb.UIPanel({
              pointerEvents: 'none',
              style: {flexDirection: 'column', alignItems: 'flex-end', gap: 2},
              children: [
                new xb.UIText({
                  text: '진행률',
                  pointerEvents: 'none',
                  style: {fontSize: 12, color: '#94a3b8'},
                }),
                this.progressPctText,
              ],
            }),
          ],
        }),
        progressTrack,
        this.progressSubText,
      ],
    });

    this.card = new xb.UICard({
      size: {width: DEFAULT_WIDTH, height: 'auto'},
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
            minSize: {width: 0.34},
            maxSize: {width: 0.72},
          },
        },
      },
      edge: {translateFromSurface: true},
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 22,
        backgroundColor: 'rgba(9, 14, 26, 0.82)',
      },
      children: [weatherSection, routeSection],
    });
    this.card.name = 'Right Weather & Route Smart Glass';
    this.card.position.set(
      DEFAULT_OFFSET.x,
      1.6 + DEFAULT_OFFSET.y,
      DEFAULT_OFFSET.z
    );

    this.followHead = new xb.FollowHead({
      offset: DEFAULT_OFFSET.clone(),
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

  private createMiniTile(label: string, valueText: xb.UIText): xb.UIPanel {
    return new xb.UIPanel({
      pointerEvents: 'none',
      style: {
        flexGrow: 1,
        flexBasis: 0,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: 8,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
      },
      children: [
        new xb.UIText({
          text: label,
          pointerEvents: 'none',
          style: {fontSize: 12, color: '#94a3b8', textAlign: 'center'},
        }),
        valueText,
      ],
    });
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

  public resetPoseAndZoom(): void {
    if (!this.card) return;
    this.followHead?.suspend();
    const cam = xb.core.camera;
    if (cam) {
      _resetPos
        .copy(DEFAULT_OFFSET)
        .applyQuaternion(cam.quaternion)
        .add(cam.position);
      this.card.position.copy(_resetPos);
    } else {
      this.card.position.set(
        DEFAULT_OFFSET.x,
        1.6 + DEFAULT_OFFSET.y,
        DEFAULT_OFFSET.z
      );
    }
    this.card.scale.setScalar(1);
    this.card.size = {width: DEFAULT_WIDTH, height: 'auto'};
    this.lastReportedZoomPct = 100;
    this.zoomLabel.text = '100%';
    this.followHead?.resume();
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

    this.weatherBadgeText.text = t.weatherCondition;
    this.tempValueText.text = `${t.temperatureC}°C`;
    this.humidityValueText.text = `${t.humidityPct}%`;
    this.windValueText.text = `${t.windSpeedMs.toFixed(1)} m/s`;

    this.destinationText.text = t.destinationName;
    this.remainingKmText.text = `${t.remainingKm.toFixed(2)} km`;
    this.etaText.text = `도착 약 ${t.etaMinutes}분`;

    this.progressPctText.text = `${t.routeProgressPct}%`;
    this.progressFillPanel.style.width = `${Math.max(4, t.routeProgressPct)}%`;
    const traveledKm = Math.max(0, t.totalRouteKm - t.remainingKm);
    this.progressSubText.text = `전체 ${t.totalRouteKm.toFixed(1)} km 중 ${traveledKm.toFixed(2)} km 주행 · ${t.windLabel}`;
  }

  public dispose(): void {
    window.removeEventListener('wheel', this.onWheel, true);
  }
}
