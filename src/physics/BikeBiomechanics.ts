import {
  BikeModelId,
  BikeProfile,
  BikeSetupState,
  CyclingTelemetry,
  OvertakingState,
} from '../types.ts';

export const BIKE_PROFILES: BikeProfile[] = [
  {
    id: 'aero-road',
    shortName: '에어로 로드 22단',
    fullName: '카본 에어로 로드바이크 (22단)',
    category: '고속 한강 순항형',
    drivetrain: 'Shimano 105 2×11단 (52/36T · 11-28T)',
    tires: '700×25C 로드 슬릭',
    weightKg: 7.9,
    frameColorHex: 0x0284c7,
    summary: '공기저항을 줄여 한강 직선 자전거도로에서 최고 속도를 내는 카본 로드바이크입니다.',
    optimalGearLabel: '앞 2단(52T) × 뒤 6단(17T)',
    optimalGearRatio: '3.06',
    optimalCadenceRpm: 88,
    optimalTirePsi: 98,
    flatRoadGuide: '한강 평지 도로 최적: 앞 2단(52T) × 뒤 6단(17T) · 88 RPM 유지 (시속 31~32 km/h)',
    climbWindGuide: '맞바람·다리 오르막: 뒤 7~8단(19~21T) 또는 앞 1단(36T) × 뒤 6단',
    sprintGuide: '추월 가속 시: 뒤 4~5단(14~15T)으로 1~2단만 무겁게 변속',
  },
  {
    id: 'endurance-road',
    shortName: '엔듀런스 24단',
    fullName: '올라운드 엔듀런스 로드 (24단)',
    category: '발목·무릎 보호 장거리형',
    drivetrain: 'Ultegra 2×12단 (50/34T · 11-30T)',
    tires: '700×28C 컴포트 로드',
    weightKg: 8.3,
    frameColorHex: 0x0d9488,
    summary: '여유로운 기어비와 진동 흡수 설계로 발목과 무릎 피로를 낮춘 장거리 로드바이크입니다.',
    optimalGearLabel: '앞 2단(50T) × 뒤 7단(17T)',
    optimalGearRatio: '2.94',
    optimalCadenceRpm: 90,
    optimalTirePsi: 88,
    flatRoadGuide: '한강 평지 도로 최적: 앞 2단(50T) × 뒤 7단(17T) · 90 RPM 고회전 (발목 부담 최소)',
    climbWindGuide: '맞바람·다리 오르막: 앞 1단(34T) × 뒤 6~7단(16~18T)으로 부드럽게 회전',
    sprintGuide: '추월 가속 시: 앞 2단(50T) × 뒤 5단(14T)으로 리듬 유지',
  },
  {
    id: 'hybrid-gravel',
    shortName: '그래블 투어 18단',
    fullName: '한강 그래블 · 하이브리드 (18단)',
    category: '안정적 도심 투어링형',
    drivetrain: 'GRX 2×9단 (46/30T · 11-34T)',
    tires: '700×35C 올라운드 투어',
    weightKg: 10.4,
    frameColorHex: 0xd97706,
    summary: '넓은 타이어와 안정적인 핸들링으로 한강 공원 전 구간을 편안하게 달리는 투어러입니다.',
    optimalGearLabel: '앞 2단(46T) × 뒤 5단(15T)',
    optimalGearRatio: '3.07',
    optimalCadenceRpm: 84,
    optimalTirePsi: 72,
    flatRoadGuide: '한강 평지 도로 최적: 앞 2단(46T) × 뒤 5단(15T) · 84 RPM 안정 순항',
    climbWindGuide: '맞바람·다리 오르막: 앞 1단(30T) × 뒤 5~6단(16~18T) 저부하 등판',
    sprintGuide: '추월 가속 시: 앞 2단(46T) × 뒤 3~4단(12~13T)',
  },
];

export const PROBLEM_BIKE_SETUP: BikeSetupState = {
  saddleOffsetMm: 18,
  cadenceRpm: 62,
  tirePsi: 70,
  cleatOffsetMm: 8,
};

export const OPTIMAL_BIKE_SETUP: BikeSetupState = {
  saddleOffsetMm: 0,
  cadenceRpm: 88,
  tirePsi: 98,
  cleatOffsetMm: -2,
};

export const RIVAL_CRUISE_SPEED_KMH = 27.5;

const HANGANG_DESTINATIONS = [
  {name: '반포 한강공원', totalKm: 8.0, initialRemainingKm: 4.85},
  {name: '잠실 한강공원', totalKm: 9.5, initialRemainingKm: 6.4},
  {name: '광나루 자전거공원', totalKm: 8.4, initialRemainingKm: 5.2},
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export class BikeBiomechanics {
  public targetSetup: BikeSetupState = {...PROBLEM_BIKE_SETUP};
  public currentSetup: BikeSetupState = {...PROBLEM_BIKE_SETUP};
  public activeBikeId: BikeModelId = 'aero-road';
  public rivalGapMeters = 11.5;
  public isAutoOptimizing = false;

  private destinationIndex = 0;
  private remainingKm = HANGANG_DESTINATIONS[0].initialRemainingKm;
  private elapsed = 0;
  private smoothedSpeed = 21.4;
  private smoothedHr = 167;

  public getActiveBikeProfile(): BikeProfile {
    return (
      BIKE_PROFILES.find((b) => b.id === this.activeBikeId) ?? BIKE_PROFILES[0]
    );
  }

  public getOptimalSetupForActiveBike(): BikeSetupState {
    const profile = this.getActiveBikeProfile();
    return {
      saddleOffsetMm: 0,
      cadenceRpm: profile.optimalCadenceRpm,
      tirePsi: profile.optimalTirePsi,
      cleatOffsetMm: -2,
    };
  }

  public setBikeModel(id: BikeModelId): void {
    this.activeBikeId = id;
    if (this.isAutoOptimizing) {
      this.targetSetup = this.getOptimalSetupForActiveBike();
    }
  }

  public applyPreset(preset: BikeSetupState, animate = true): void {
    this.targetSetup = {...preset};
    if (!animate) {
      this.currentSetup = {...preset};
      this.isAutoOptimizing = false;
    } else {
      this.isAutoOptimizing = true;
    }
  }

  public setParameter<K extends keyof BikeSetupState>(
    key: K,
    value: BikeSetupState[K]
  ): void {
    this.isAutoOptimizing = false;
    this.targetSetup[key] = value;
    this.currentSetup[key] = value;
  }

  public resetRivalGap(): void {
    this.rivalGapMeters = 11.5;
    this.destinationIndex = 0;
    this.remainingKm = HANGANG_DESTINATIONS[0].initialRemainingKm;
  }

  public step(dt: number): CyclingTelemetry {
    const safeDt = Math.min(Math.max(dt, 0.001), 0.05);
    this.elapsed += safeDt;

    if (this.isAutoOptimizing) {
      this.currentSetup.saddleOffsetMm = damp(
        this.currentSetup.saddleOffsetMm,
        this.targetSetup.saddleOffsetMm,
        4.5,
        safeDt
      );
      this.currentSetup.cadenceRpm = damp(
        this.currentSetup.cadenceRpm,
        this.targetSetup.cadenceRpm,
        4.5,
        safeDt
      );
      this.currentSetup.tirePsi = damp(
        this.currentSetup.tirePsi,
        this.targetSetup.tirePsi,
        4.5,
        safeDt
      );
      this.currentSetup.cleatOffsetMm = damp(
        this.currentSetup.cleatOffsetMm,
        this.targetSetup.cleatOffsetMm,
        4.5,
        safeDt
      );

      const maxDiff = Math.max(
        Math.abs(this.currentSetup.saddleOffsetMm - this.targetSetup.saddleOffsetMm),
        Math.abs(this.currentSetup.cadenceRpm - this.targetSetup.cadenceRpm),
        Math.abs(this.currentSetup.tirePsi - this.targetSetup.tirePsi),
        Math.abs(this.currentSetup.cleatOffsetMm - this.targetSetup.cleatOffsetMm)
      );
      if (maxDiff < 0.08) {
        this.currentSetup = {...this.targetSetup};
        this.isAutoOptimizing = false;
      }
    }

    const profile = this.getActiveBikeProfile();
    const optimal = this.getOptimalSetupForActiveBike();
    const {saddleOffsetMm, cadenceRpm, tirePsi, cleatOffsetMm} = this.currentSetup;

    // 1. Sub-component penalties (0 = optimal, 1 = severe penalty)
    const saddleErr = Math.abs(saddleOffsetMm - optimal.saddleOffsetMm) / 25;
    const highSaddlePenalty = saddleOffsetMm > 0 ? saddleOffsetMm / 25 : 0;
    const cadenceErr = Math.abs(cadenceRpm - optimal.cadenceRpm) / 28;
    const lowCadenceGrind = cadenceRpm < optimal.cadenceRpm - 8 ? (optimal.cadenceRpm - 8 - cadenceRpm) / 20 : 0;
    const psiErr = Math.abs(tirePsi - optimal.tirePsi) / 33;
    const lowPsiPenalty = tirePsi < optimal.tirePsi ? (optimal.tirePsi - tirePsi) / 33 : 0;
    const cleatErr = Math.abs(cleatOffsetMm - optimal.cleatOffsetMm) / 12;
    const forwardCleatPenalty = cleatOffsetMm > -2 ? (cleatOffsetMm + 2) / 12 : 0;

    // 2. Overall optimization score (0 - 100%)
    const weightedPenalty =
      saddleErr * 0.3 +
      cadenceErr * 0.3 +
      psiErr * 0.22 +
      cleatErr * 0.18;
    const optimizationScore = Math.round(clamp((1 - weightedPenalty) * 100, 12, 100));

    // 3. Ankle biomechanics: excessive plantarflexion/dorsiflexion angle & Achilles strain
    const ankleStrainRaw =
      highSaddlePenalty * 0.42 +
      saddleErr * 0.14 +
      lowCadenceGrind * 0.26 +
      forwardCleatPenalty * 0.24 +
      cleatErr * 0.06;
    const ankleStrainPct = Math.round(clamp(ankleStrainRaw * 100, 8, 96));
    const ankleAngleDeg = Math.round(
      clamp(14 + highSaddlePenalty * 14 + forwardCleatPenalty * 6 + lowCadenceGrind * 4, 12, 38)
    );

    // 4. Rolling & drivetrain power losses (Watts)
    const rollingLossW = Math.round(
      16 + lowPsiPenalty * 28 + Math.max(0, tirePsi - (optimal.tirePsi + 7)) * 0.6
    );
    const drivetrainLossW = Math.round(8 + lowCadenceGrind * 24 + saddleErr * 18);

    // 5. Effective speed along Hangang river bike path (km/h)
    const baseOptimalSpeed =
      profile.id === 'aero-road' ? 32.4 : profile.id === 'endurance-road' ? 30.8 : 28.9;
    const speedLoss =
      saddleErr * 3.8 +
      cadenceErr * 4.2 +
      lowPsiPenalty * 3.1 +
      cleatErr * 1.4;
    const targetSpeed = clamp(
      baseOptimalSpeed - speedLoss + Math.sin(this.elapsed * 0.9) * 0.2,
      18.5,
      34.0
    );
    this.smoothedSpeed = damp(this.smoothedSpeed, targetSpeed, 3.2, safeDt);

    // 6. Estimated heart rate (BPM): grinding & pain elevate HR despite lower speed
    const targetHr = clamp(
      143 +
        lowCadenceGrind * 16 +
        ankleStrainRaw * 12 +
        saddleErr * 7 +
        Math.sin(this.elapsed * 1.3) * 1.4,
      128,
      184
    );
    this.smoothedHr = damp(this.smoothedHr, targetHr, 2.5, safeDt);
    const estimatedHrBpm = Math.round(this.smoothedHr);

    const hrZoneLabel =
      estimatedHrBpm >= 165
        ? 'Z5 과부하'
        : estimatedHrBpm >= 153
          ? 'Z4 고강도'
          : 'Z3 최적 유산소';

    const powerWatts = Math.round(
      165 + (optimizationScore / 100) * 85 - drivetrainLossW * 0.4
    );

    // 7. Rival cyclist gap dynamics (m): positive = rival is ahead of you
    const speedDiffMs = ((RIVAL_CRUISE_SPEED_KMH - this.smoothedSpeed) * 1000) / 3600;
    this.rivalGapMeters = clamp(this.rivalGapMeters + speedDiffMs * safeDt * 2.2, -16, 22);

    let overtakingState: OvertakingState = 'behind';
    if (this.rivalGapMeters <= -0.5) {
      overtakingState = 'overtaken';
    } else if (this.smoothedSpeed > RIVAL_CRUISE_SPEED_KMH && this.rivalGapMeters < 9.0) {
      overtakingState = 'catching';
    }

    // 8. Destination remaining distance countdown (km), progress %, & Hangang weather
    const traveledKm = (this.smoothedSpeed / 3600) * safeDt * 2.5;
    this.remainingKm -= traveledKm;
    if (this.remainingKm <= 0.02) {
      this.destinationIndex = (this.destinationIndex + 1) % HANGANG_DESTINATIONS.length;
      this.remainingKm = HANGANG_DESTINATIONS[this.destinationIndex].totalKm;
    }
    const activeDest = HANGANG_DESTINATIONS[this.destinationIndex];
    const destinationName = activeDest.name;
    const totalRouteKm = activeDest.totalKm;
    const routeProgressPct = Math.round(
      clamp(((totalRouteKm - this.remainingKm) / totalRouteKm) * 100, 0, 100)
    );
    const etaMinutes = Math.max(
      1,
      Math.round((this.remainingKm / Math.max(this.smoothedSpeed, 10)) * 60)
    );

    // Hangang riverside daytime weather
    const windSpeedMs = Number((2.8 + Math.sin(this.elapsed * 0.25) * 0.3).toFixed(1));
    const temperatureC = 19;
    const humidityPct = Math.round(46 + Math.sin(this.elapsed * 0.12) * 1);
    const weatherCondition = '맑음 · 한강 낮';
    const windLabel = `북서풍 ${windSpeedMs.toFixed(1)} m/s`;

    // 9. Gear shift estimation & optimal road gear guidance
    const {currentGearLabel, gearAdvice, isGearOptimal} = this.buildGearGuidance(
      profile,
      cadenceRpm
    );

    // 10. Empathetic Korean diagnosis & recommendation
    const {diagnosisSummary, ankleRecommendation} = this.buildDiagnosis(
      profile,
      saddleOffsetMm,
      cadenceRpm,
      tirePsi,
      cleatOffsetMm,
      optimizationScore,
      overtakingState
    );

    return {
      speedKmh: Number(this.smoothedSpeed.toFixed(1)),
      estimatedHrBpm,
      hrZoneLabel,
      powerWatts,
      ankleStrainPct,
      ankleAngleDeg,
      rollingLossW,
      drivetrainLossW,
      optimizationScore,
      rivalSpeedKmh: RIVAL_CRUISE_SPEED_KMH,
      rivalGapMeters: Number(this.rivalGapMeters.toFixed(1)),
      overtakingState,
      weatherCondition,
      temperatureC,
      humidityPct,
      windSpeedMs,
      windLabel,
      destinationName,
      totalRouteKm,
      remainingKm: Number(this.remainingKm.toFixed(2)),
      routeProgressPct,
      etaMinutes,
      bikeProfile: profile,
      currentGearLabel,
      gearAdvice,
      isGearOptimal,
      diagnosisSummary,
      ankleRecommendation,
    };
  }

  private buildGearGuidance(
    profile: BikeProfile,
    cadenceRpm: number
  ): {currentGearLabel: string; gearAdvice: string; isGearOptimal: boolean} {
    const diff = cadenceRpm - profile.optimalCadenceRpm;
    if (Math.abs(diff) <= 4) {
      return {
        currentGearLabel: `${profile.optimalGearLabel} (${Math.round(cadenceRpm)} RPM)`,
        gearAdvice: `도로 최적 기어 유지 중! ${profile.optimalGearLabel} · 기어비 ${profile.optimalGearRatio}`,
        isGearOptimal: true,
      };
    }

    if (diff < -14) {
      const heavyGear =
        profile.id === 'aero-road'
          ? '앞 2단(52T) × 뒤 2단(12T)'
          : profile.id === 'endurance-road'
            ? '앞 2단(50T) × 뒤 3단(13T)'
            : '앞 2단(46T) × 뒤 2단(12T)';
      return {
        currentGearLabel: `${heavyGear} · 과중 (${Math.round(cadenceRpm)} RPM)`,
        gearAdvice: `기어가 너무 무겁습니다 → ${profile.optimalGearLabel}로 3~4단 낮춰 ${profile.optimalCadenceRpm} RPM 맞추세요`,
        isGearOptimal: false,
      };
    }

    if (diff < -4) {
      const midHeavyGear =
        profile.id === 'aero-road'
          ? '앞 2단(52T) × 뒤 4단(14T)'
          : profile.id === 'endurance-road'
            ? '앞 2단(50T) × 뒤 5단(14T)'
            : '앞 2단(46T) × 뒤 4단(13T)';
      return {
        currentGearLabel: `${midHeavyGear} · 약간 무거움 (${Math.round(cadenceRpm)} RPM)`,
        gearAdvice: `뒤 기어를 1~2단 낮춰 ${profile.optimalGearLabel} (${profile.optimalCadenceRpm} RPM) 권장`,
        isGearOptimal: false,
      };
    }

    const lightGear =
      profile.id === 'aero-road'
        ? '앞 2단(52T) × 뒤 8단(21T)'
        : profile.id === 'endurance-road'
          ? '앞 2단(50T) × 뒤 9단(21T)'
          : '앞 2단(46T) × 뒤 7단(20T)';
    return {
      currentGearLabel: `${lightGear} · 과회전 (${Math.round(cadenceRpm)} RPM)`,
      gearAdvice: `기어가 너무 가볍습니다 → 뒤 기어를 1~2단 높여 ${profile.optimalGearLabel} 권장`,
      isGearOptimal: false,
    };
  }

  private buildDiagnosis(
    profile: BikeProfile,
    saddleOffsetMm: number,
    cadenceRpm: number,
    tirePsi: number,
    cleatOffsetMm: number,
    optimizationScore: number,
    overtakingState: OvertakingState
  ): {diagnosisSummary: string; ankleRecommendation: string} {
    if (optimizationScore >= 92) {
      return {
        diagnosisSummary:
          overtakingState === 'overtaken'
            ? `최적 컨디션 달성! (${profile.optimalGearLabel}) 선두 추월 성공 · 심박·발목 안정`
            : `자전거 핏 최적화 완료! ${profile.optimalGearLabel} 변속으로 선두를 빠르게 추격 중입니다.`,
        ankleRecommendation: '발목 각도 14° 유지 · 아킬레스건 긴장 해소됨',
      };
    }

    const issues: string[] = [];
    if (saddleOffsetMm > 6) {
      issues.push(`안장 +${Math.round(saddleOffsetMm)}mm 과높음(발목 과신전)`);
    } else if (saddleOffsetMm < -6) {
      issues.push(`안장 ${Math.round(saddleOffsetMm)}mm 낮음(무릎·페달 손실)`);
    }
    if (cadenceRpm < profile.optimalCadenceRpm - 10) {
      issues.push(`무거운 기어(${Math.round(cadenceRpm)} RPM)`);
    } else if (cadenceRpm > profile.optimalCadenceRpm + 8) {
      issues.push(`과회전(${Math.round(cadenceRpm)} RPM)`);
    }
    if (tirePsi < profile.optimalTirePsi - 10) {
      issues.push(`공기압 부족(${Math.round(tirePsi)} PSI)`);
    }
    if (cleatOffsetMm > 2) {
      issues.push(`클릿 앞쏠림(+${Math.round(cleatOffsetMm)}mm)`);
    }

    const diagnosisSummary =
      issues.length > 0
        ? `원인 진단: ${issues.slice(0, 2).join(' · ')} → 속도 손실 및 심박 상승`
        : '미세 조정 중 — 목표 최적 수치에 거의 도달했습니다.';

    let ankleRecommendation = `안장을 낮추고 ${profile.optimalGearLabel}로 변속하세요`;
    if (saddleOffsetMm > 6) {
      ankleRecommendation = `안장을 ${Math.round(saddleOffsetMm)}mm 내려 발목 꺾임을 줄이세요`;
    } else if (cleatOffsetMm > 2) {
      ankleRecommendation = '클릿을 뒤로(-2mm) 옮겨 발목 지렛대 부담을 줄이세요';
    } else if (cadenceRpm < profile.optimalCadenceRpm - 10) {
      ankleRecommendation = `${profile.optimalGearLabel}(${profile.optimalCadenceRpm} RPM)로 가볍게 변속하세요`;
    } else if (tirePsi < profile.optimalTirePsi - 10) {
      ankleRecommendation = `타이어 공기압을 ${profile.optimalTirePsi} PSI로 맞춰 구름 저항을 줄이세요`;
    }

    return {diagnosisSummary, ankleRecommendation};
  }
}
