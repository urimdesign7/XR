import * as xb from 'xrblocks';
import {HangangCyclingApp} from './HangangCyclingApp.ts';

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.enableReticles();
  options.enableHands();
  options.setAppTitle('한강 XR 사이클링 핏 코치');
  options.setAppDescription(
    '스마트 글라스 속도·예상 심박수와 발목 통증 원인을 분석해 자전거 최적 상태를 안내합니다.'
  );
  options.xrButton.showEnterSimulatorButton = true;

  xb.add(new HangangCyclingApp());
  void xb.init(options);
});
