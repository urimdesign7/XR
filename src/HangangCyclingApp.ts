import * as xb from 'xrblocks';
import {CyclingAudio} from './audio/CyclingAudio.ts';
import {
  BikeBiomechanics,
  PROBLEM_BIKE_SETUP,
} from './physics/BikeBiomechanics.ts';
import {BikeShowroomViewer} from './scene/BikeShowroomViewer.ts';
import {BikeTwinModel} from './scene/BikeTwinModel.ts';
import {HangangEnvironment} from './scene/HangangEnvironment.ts';
import {RivalCyclist} from './scene/RivalCyclist.ts';
import {
  AppScreenMode,
  BikeFocusPart,
  BikeModelId,
  BikeSetupState,
  OvertakingState,
} from './types.ts';
import {BikeOptimizerCard} from './ui/BikeOptimizerCard.ts';
import {RightStatusGlassCard} from './ui/RightStatusGlassCard.ts';
import {SmartGlassHud} from './ui/SmartGlassHud.ts';

export class HangangCyclingApp extends xb.Script {
  private biomechanics = new BikeBiomechanics();
  private audio = new CyclingAudio();

  private hangangEnv = new HangangEnvironment();
  private bikeTwin: BikeTwinModel;
  private bikeShowroom: BikeShowroomViewer;
  private rivalCyclist = new RivalCyclist();
  private hud: SmartGlassHud;
  private rightGlass = new RightStatusGlassCard();
  private optimizerCard: BikeOptimizerCard;

  private screenMode: AppScreenMode = 'riding';
  private isArMode = false;
  private wasOptimal = false;
  private lastOvertakingState: OvertakingState = 'behind';
  private hudValidated = false;
  private optimizerUiValidated = false;
  private frameCounter = 0;
  private optimizerValidationFrames = 0;

  private handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat) return;
    if (this.screenMode === 'optimizer') {
      event.preventDefault();
      event.stopPropagation();
      this.setScreenMode('riding');
      return;
    }
    if (this.hud.getActiveTab() === 'bikeIntro') {
      event.preventDefault();
      event.stopPropagation();
      this.hud.setActiveTab('dashboard');
      this.audio.playShiftClick();
    }
  };

  constructor() {
    super();
    this.bikeTwin = new BikeTwinModel((part) => this.handleBikeHotspot(part));
    this.bikeShowroom = new BikeShowroomViewer({
      onSelectBikeModel: (id) => this.handleSelectBikeModel(id),
      onFocusPart: (part) => this.handleBikeHotspot(part),
      onBackToRiding: () => this.setScreenMode('riding'),
    });
    this.hud = new SmartGlassHud({
      onSelectBikeModel: (id) => this.handleSelectBikeModel(id),
      onApplyOptimalGear: () => this.handleAutoOptimize(),
      onOpenOptimizer: () => this.setScreenMode('optimizer'),
    });
    this.optimizerCard = new BikeOptimizerCard({
      onSetupChange: (key, value) => this.handleSetupChange(key, value),
      onAutoOptimize: () => this.handleAutoOptimize(),
      onResetProblem: () => this.handleResetProblem(),
      onToggleMode: () => this.handleToggleMode(),
      onBackToRiding: () => this.setScreenMode('riding'),
    });
  }

  public init(): void {
    xb.ui.theme = 'grayGlass';

    this.add(this.hangangEnv);
    this.add(this.bikeTwin);
    this.add(this.rivalCyclist);
    this.add(this.bikeShowroom);
    this.add(this.hud);
    this.add(this.rightGlass);
    this.add(this.optimizerCard);

    this.hangangEnv.setArPassthrough(false);
    this.optimizerCard.setArModeLabel(false);
    this.applyScreenModeVisibility('riding');

    window.addEventListener('keydown', this.handleWindowKeyDown, {capture: true});
  }

  public update(): void {
    const dt = Math.min(xb.getDeltaTime() || 0.016, 0.05);
    const telemetry = this.biomechanics.step(dt);

    this.hangangEnv.setTelemetry(
      this.screenMode === 'riding' ? telemetry.speedKmh : 0,
      telemetry.optimizationScore
    );
    this.bikeTwin.setState(this.biomechanics.currentSetup, telemetry);
    this.bikeShowroom.setState(this.biomechanics.currentSetup, telemetry);
    this.rivalCyclist.setTelemetry(telemetry);
    this.hud.updateTelemetry(telemetry);
    this.rightGlass.updateTelemetry(telemetry);
    this.optimizerCard.syncState(this.biomechanics.currentSetup, telemetry);

    const isNowOptimal = telemetry.optimizationScore >= 92;
    if (isNowOptimal && !this.wasOptimal) {
      this.audio.playOptimalLockChime();
    }
    this.wasOptimal = isNowOptimal;

    if (
      telemetry.overtakingState === 'overtaken' &&
      this.lastOvertakingState !== 'overtaken'
    ) {
      this.audio.playOvertakeChime();
    }
    this.lastOvertakingState = telemetry.overtakingState;

    // Run one-shot UI layout validation after initial frames settle for each screen
    this.frameCounter++;
    if (
      this.screenMode === 'riding' &&
      !this.hudValidated &&
      this.frameCounter === 25
    ) {
      this.hudValidated = true;
      this.validateHudUi();
    }
    if (this.screenMode === 'optimizer' && !this.optimizerUiValidated) {
      this.optimizerValidationFrames++;
      if (this.optimizerValidationFrames === 15) {
        this.optimizerUiValidated = true;
        this.validateOptimizerUi();
      }
    }
  }

  public setScreenMode(mode: AppScreenMode): void {
    if (this.screenMode === mode) return;
    this.screenMode = mode;
    this.applyScreenModeVisibility(mode);
    this.audio.playShiftClick();
  }

  private applyScreenModeVisibility(mode: AppScreenMode): void {
    const isRiding = mode === 'riding';

    this.hud.setScreenVisible(isRiding);
    this.rightGlass.setScreenVisible(isRiding);
    this.bikeTwin.visible = isRiding;
    this.rivalCyclist.visible = isRiding;

    this.optimizerCard.setScreenVisible(!isRiding);
    this.bikeShowroom.setScreenVisible(!isRiding);
  }

  private handleSelectBikeModel(id: BikeModelId): void {
    this.biomechanics.setBikeModel(id);
    this.audio.playShiftClick();
  }

  private handleSetupChange<K extends keyof BikeSetupState>(
    key: K,
    value: BikeSetupState[K]
  ): void {
    this.biomechanics.setParameter(key, value);
    this.audio.playShiftClick();
  }

  private handleAutoOptimize(): void {
    this.biomechanics.applyPreset(
      this.biomechanics.getOptimalSetupForActiveBike(),
      true
    );
    this.audio.playShiftClick();
  }

  private handleResetProblem(): void {
    this.biomechanics.applyPreset(PROBLEM_BIKE_SETUP, true);
    this.biomechanics.resetRivalGap();
    this.wasOptimal = false;
    this.lastOvertakingState = 'behind';
    this.audio.playShiftClick();
  }

  private handleToggleMode(): void {
    this.isArMode = !this.isArMode;
    this.hangangEnv.setArPassthrough(this.isArMode);
    this.optimizerCard.setArModeLabel(this.isArMode);
    this.audio.playShiftClick();
  }

  private handleBikeHotspot(part: BikeFocusPart): void {
    if (this.screenMode !== 'optimizer') {
      this.setScreenMode('optimizer');
    }
    this.optimizerCard.highlightFocusPart(part);
    this.bikeShowroom.highlightPart(part);
    this.audio.playShiftClick();
  }

  private validateHudUi(): void {
    const hudRoot = this.hud.getCardRoot();
    if (hudRoot) {
      const hudReport = xb.ui.validate(hudRoot);
      if (hudReport.ready && !hudReport.ok) {
        console.warn('SmartGlassHud UI validation issues:', hudReport.issues);
      }
    }
    const rightRoot = this.rightGlass.getCardRoot();
    if (rightRoot) {
      const rightReport = xb.ui.validate(rightRoot);
      if (rightReport.ready && !rightReport.ok) {
        console.warn('RightStatusGlassCard UI validation issues:', rightReport.issues);
      }
    }
  }

  private validateOptimizerUi(): void {
    const cardRoot = this.optimizerCard.getCardRoot();
    const controlsRoot = this.bikeShowroom.getControlsCardRoot();
    if (cardRoot) {
      const cardReport = xb.ui.validate(cardRoot);
      if (cardReport.ready && !cardReport.ok) {
        console.warn('BikeOptimizerCard UI validation issues:', cardReport.issues);
      }
    }
    if (controlsRoot) {
      const dockReport = xb.ui.validate(controlsRoot);
      if (dockReport.ready && !dockReport.ok) {
        console.warn('BikeShowroomViewer controls validation issues:', dockReport.issues);
      }
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.handleWindowKeyDown, true);
    this.audio.dispose();
  }
}
