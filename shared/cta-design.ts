import { z } from 'zod';
import type { SceneKey } from './schema/project-keys';

/** s7-band: 既存のS7（映像下端の帯＋独立Brand Lockup＋フェード）。s4-block: 短尺S4の統合CTA。 */
export const ctaDesignSchema = z.enum(['s7-band', 's4-block']);
export type CtaDesign = z.infer<typeof ctaDesignSchema>;

export const CTA_DESIGN_OPTIONS: { id: CtaDesign; label: string; detail: string }[] = [
  {
    id: 's7-band',
    label: 'S7 ループ帯（既存）',
    detail: 'S7の映像下端に帯とCTAを重ね、その下にBrand Lockupを出します',
  },
  {
    id: 's4-block',
    label: 'S4 末尾CTA（短尺）',
    detail: 'S4の末尾2秒。目的に応じて、映像上の高評価か、映像直下のClutchVault案内を出します',
  },
];

export const ctaDesignLabel = (design: CtaDesign): string =>
  CTA_DESIGN_OPTIONS.find((option) => option.id === design)?.label ?? design;

/** 新しいブロックCTAはS4（発動イメージ）。既存の帯CTAはS7（ループ）。 */
export const ctaHostScene = (design: CtaDesign): SceneKey =>
  design === 's4-block' ? 'throw' : 'loop';
