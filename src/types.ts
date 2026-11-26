export interface BikeSetupState {
  /** Saddle height offset relative to optimal biomechanical height in millimeters (-25 to +25). */
  saddleOffsetMm: number;
  /** Target pedaling cadence controlled via gear selection in RPM (60 to 100). */
  cadenceRpm: number;
  /** Tire inflation pressure in PSI (65 to 115). */
  tirePsi: number;
  /** Cleat fore/aft offset in millimeters (-10 rear to +10 forward/toe). */
  cleatOffsetMm: number;
}

export type OvertakingState = 'behind' | 'catching' | 'overtaken';

export type BikeFocusPart = 'all' | 'saddle' | 'ankle' | 'tire';

export type AppScreenMode = 'riding' | 'optimizer';

export type BikeModelId = 'aero-road' | 'endurance-road' | 'hybrid-gravel';

export interface BikeProfile {
  id: BikeModelId;
  shortName: string;
  fullName: string;
  category: string;
  drivetrain: string;
  tires: string;
  weightKg: number;
  frameColorHex: number;
  summary: string;
  optimalGearLabel: string;
  optimalGearRatio: string;
  optimalCadenceRpm: number;
  optimalTirePsi: number;
  flatRoadGuide: string;
  climbWindGuide: string;
  sprintGuide: string;
}

export interface CyclingTelemetry {
  speedKmh: number;
  estimatedHrBpm: number;
  hrZoneLabel: string;
  powerWatts: number;
  ankleStrainPct: number;
  ankleAngleDeg: number;
  rollingLossW: number;
  drivetrainLossW: number;
  optimizationScore: number;
  rivalSpeedKmh: number;
  rivalGapMeters: number;
  overtakingState: OvertakingState;
  weatherCondition: string;
  temperatureC: number;
  humidityPct: number;
  windSpeedMs: number;
  windLabel: string;
  destinationName: string;
  totalRouteKm: number;
  remainingKm: number;
  routeProgressPct: number;
  etaMinutes: number;
  bikeProfile: BikeProfile;
  currentGearLabel: string;
  gearAdvice: string;
  isGearOptimal: boolean;
  diagnosisSummary: string;
  ankleRecommendation: string;
}
