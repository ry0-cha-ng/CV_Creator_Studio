export const SOVA_BOUNCE_VALUES = [0, 1, 2] as const;
export const SOVA_CHARGE_VALUES = [0, 1, 2, 3] as const;

export type BounceChargeLabel = { ja: string; en: string };

const chargeLabel = (charge: number): BounceChargeLabel =>
  charge === 3
    ? { ja: 'フルチャージ', en: 'FULL CHARGE' }
    : { ja: `${charge}チャージ`, en: `${charge} CHARGE` };

export const bounceChargeLabel = (
  bounce: number,
  charge: number,
  crouch = false,
): BounceChargeLabel => {
  const chargeText = chargeLabel(charge);
  const base: BounceChargeLabel = {
    ja: `${bounce}バウンス・${chargeText.ja}`,
    en: `${bounce} BOUNCE · ${chargeText.en}`,
  };
  if (!crouch) return base;
  return {
    ja: `しゃがみ + ${base.ja}`,
    en: `CROUCH + ${base.en}`,
  };
};

export const bounceChargeOptions = (
  crouch = false,
): Array<{
  bounce: number;
  charge: number;
  label: BounceChargeLabel;
}> =>
  SOVA_BOUNCE_VALUES.flatMap((bounce) =>
    SOVA_CHARGE_VALUES.map((charge) => ({
      bounce,
      charge,
      label: bounceChargeLabel(bounce, charge, crouch),
    })),
  );

const compactId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const isSovaChargeLineup = (agent: string, ability: string): boolean => {
  const abilityId = compactId(ability);
  return (
    compactId(agent) === 'sova' &&
    (abilityId === 'shockbolt' || abilityId === 'reconbolt')
  );
};
