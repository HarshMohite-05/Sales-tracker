import { SlabMode } from '@prisma/client';

export interface SlabTier {
  minAchievementPercent: number;
  maxAchievementPercent: number;
  incentivePercent: number;
}

export interface IncentiveCalculationInput {
  targetAmount: number;
  achievedAmount: number;
  baseRatePercent: number;
  minThresholdPercent: number;
  slabMode: SlabMode;
  slabs: SlabTier[];
}

export interface IncentiveCalculationResult {
  achievementPercent: number;
  isEligible: boolean;
  applicableRatePercent: number;
  calculatedIncentive: number;
  breakdown: {
    description: string;
    targetAmount: number;
    achievedAmount: number;
    achievementPercent: number;
    thresholdMet: boolean;
    slabMode: string;
    tiersCalculated?: Array<{
      range: string;
      applicableAmount: number;
      ratePercent: number;
      tierIncentive: number;
    }>;
  };
}

export function calculateIncentive(input: IncentiveCalculationInput): IncentiveCalculationResult {
  const { targetAmount, achievedAmount, baseRatePercent, minThresholdPercent, slabMode, slabs } = input;

  // Handle zero or negative target
  const achievementPercent = targetAmount > 0 
    ? Math.round((achievedAmount / targetAmount) * 100 * 100) / 100 
    : achievedAmount > 0 ? 100 : 0;

  // Check minimum threshold
  if (minThresholdPercent > 0 && achievementPercent < minThresholdPercent) {
    return {
      achievementPercent,
      isEligible: false,
      applicableRatePercent: 0,
      calculatedIncentive: 0,
      breakdown: {
        description: `Achievement of ${achievementPercent}% is below the minimum threshold of ${minThresholdPercent}%. No incentive earned.`,
        targetAmount,
        achievedAmount,
        achievementPercent,
        thresholdMet: false,
        slabMode,
      },
    };
  }

  // If no slabs are defined, use baseRatePercent on the entire achieved amount
  if (!slabs || slabs.length === 0) {
    const calculatedIncentive = Math.round((achievedAmount * (baseRatePercent / 100)) * 100) / 100;
    return {
      achievementPercent,
      isEligible: true,
      applicableRatePercent: baseRatePercent,
      calculatedIncentive,
      breakdown: {
        description: `Base rate of ${baseRatePercent}% applied to entire eligible amount.`,
        targetAmount,
        achievedAmount,
        achievementPercent,
        thresholdMet: true,
        slabMode: 'FLAT_BASE',
      },
    };
  }

  // Sorted slabs ascending
  const sortedSlabs = [...slabs].sort((a, b) => a.minAchievementPercent - b.minAchievementPercent);

  if (slabMode === SlabMode.FLAT_ON_TOTAL) {
    // Find highest matching slab
    let matchedRate = baseRatePercent;
    for (const slab of sortedSlabs) {
      if (achievementPercent >= slab.minAchievementPercent) {
        matchedRate = slab.incentivePercent;
      }
    }

    const calculatedIncentive = Math.round((achievedAmount * (matchedRate / 100)) * 100) / 100;
    return {
      achievementPercent,
      isEligible: true,
      applicableRatePercent: matchedRate,
      calculatedIncentive,
      breakdown: {
        description: `Flat slab rate of ${matchedRate}% applied to entire achieved amount of ${achievedAmount}.`,
        targetAmount,
        achievedAmount,
        achievementPercent,
        thresholdMet: true,
        slabMode: SlabMode.FLAT_ON_TOTAL,
      },
    };
  } else {
    // Marginal slabs calculation
    let totalIncentive = 0;
    const tiersCalculated: Array<{
      range: string;
      applicableAmount: number;
      ratePercent: number;
      tierIncentive: number;
    }> = [];

    let previousMaxTargetAmount = 0;

    for (const slab of sortedSlabs) {
      const slabMinAmount = (targetAmount * slab.minAchievementPercent) / 100;
      const slabMaxAmount = (targetAmount * slab.maxAchievementPercent) / 100;

      if (achievedAmount > slabMinAmount) {
        const tierUpper = Math.min(achievedAmount, slabMaxAmount);
        const tierApplicable = Math.max(0, tierUpper - slabMinAmount);
        const tierIncentive = Math.round((tierApplicable * (slab.incentivePercent / 100)) * 100) / 100;

        totalIncentive += tierIncentive;
        tiersCalculated.push({
          range: `${slab.minAchievementPercent}% - ${slab.maxAchievementPercent}%`,
          applicableAmount: Math.round(tierApplicable * 100) / 100,
          ratePercent: slab.incentivePercent,
          tierIncentive,
        });
      }
    }

    // If achieved amount exceeded all slabs, or didn't fall into any, apply base rate or highest tier
    if (tiersCalculated.length === 0 && achievedAmount > 0) {
      totalIncentive = Math.round((achievedAmount * (baseRatePercent / 100)) * 100) / 100;
      tiersCalculated.push({
        range: 'Base Rate',
        applicableAmount: achievedAmount,
        ratePercent: baseRatePercent,
        tierIncentive: totalIncentive,
      });
    }

    const effectiveRate = achievedAmount > 0 ? Math.round((totalIncentive / achievedAmount) * 100 * 100) / 100 : 0;

    return {
      achievementPercent,
      isEligible: true,
      applicableRatePercent: effectiveRate,
      calculatedIncentive: Math.round(totalIncentive * 100) / 100,
      breakdown: {
        description: `Marginal tiered slab calculation for ${achievementPercent}% achievement.`,
        targetAmount,
        achievedAmount,
        achievementPercent,
        thresholdMet: true,
        slabMode: SlabMode.MARGINAL_SLABS,
        tiersCalculated,
      },
    };
  }
}
