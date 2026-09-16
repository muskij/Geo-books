/**
 * Consolidated Backend Progression Module
 * Handles user progression, XP calculation, levels, tiers, and knowledge decay.
 */

// --- Model Utilities ---

/**
 * @typedef {"Neophyte" | "Scholar" | "Fellow" | "Polymath"} ScholarlyTier
 */

/**
 * @typedef {{
 *   xp: number;
 *   last_active: string;
 * }} MasteryEntry
 */

/**
 * @typedef {Record<string, MasteryEntry>} MasteryMap
 */

/**
 * @typedef {{
 *   user_id: string;
 *   breadth_xp: number;
 *   depth_xp: number;
 *   current_level: number;
 *   scholarly_tier: ScholarlyTier;
 *   mastery_map: MasteryMap;
 *   impact_factor: number;
 *   eureka_boost_until: string | null;
 *   created_at: string;
 *   updated_at: string;
 * }} UserProgression
 */

function createUserProgression(input) {
  const now = new Date().toISOString();
  return {
    user_id: input.user_id,
    breadth_xp: Math.max(0, Math.floor(input.breadth_xp || 0)),
    depth_xp: Math.max(0, Math.floor(input.depth_xp || 0)),
    current_level: Math.max(1, Math.floor(input.current_level || 1)),
    scholarly_tier: input.scholarly_tier || "Neophyte",
    mastery_map: input.mastery_map || {},
    impact_factor: Number.isFinite(input.impact_factor) ? Number(input.impact_factor) : 0,
    eureka_boost_until: input.eureka_boost_until || null,
    created_at: input.created_at || now,
    updated_at: input.updated_at || now
  };
}

function isUserProgression(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return (
    typeof v.user_id === "string" &&
    typeof v.breadth_xp === "number" &&
    typeof v.depth_xp === "number" &&
    typeof v.current_level === "number" &&
    typeof v.scholarly_tier === "string" &&
    typeof v.mastery_map === "object" &&
    typeof v.impact_factor === "number"
  );
}

// --- Progression Engine ---

const TIER_BY_LEVEL = [
  { minLevel: 60, tier: "Polymath" },
  { minLevel: 30, tier: "Fellow" },
  { minLevel: 10, tier: "Scholar" },
  { minLevel: 1, tier: "Neophyte" }
];

class ProgressionEngine {
  constructor(userProgression) {
    this.state = userProgression;
  }

  getTotalXP() {
    return this.state.breadth_xp + this.state.depth_xp;
  }

  xpRequiredForLevel(level) {
    return Math.floor(100 * Math.pow(Math.max(1, level), 1.5));
  }

  calculateLevel() {
    const totalXP = this.getTotalXP();
    let level = 1;
    while (this.xpRequiredForLevel(level + 1) <= totalXP) {
      level += 1;
    }
    return level;
  }

  getProgressToNextLevelPercent() {
    const totalXP = this.getTotalXP();
    const level = this.state.current_level;
    const currentFloor = this.xpRequiredForLevel(level);
    const nextFloor = this.xpRequiredForLevel(level + 1);
    const span = Math.max(1, nextFloor - currentFloor);
    const pct = ((totalXP - currentFloor) / span) * 100;
    return Math.max(0, Math.min(100, Number(pct.toFixed(2))));
  }

  applyActiveBoostMultiplier(amount) {
    if (!this.state.eureka_boost_until) return amount;
    const now = Date.now();
    const until = new Date(this.state.eureka_boost_until).getTime();
    if (Number.isNaN(until) || now > until) {
      this.state.eureka_boost_until = null;
      return amount;
    }
    return amount * 2;
  }

  addXP(amount, type, category) {
    const safeAmount = Math.max(0, Math.floor(amount));
    const appliedXP = Math.floor(this.applyActiveBoostMultiplier(safeAmount));
    const nowIso = new Date().toISOString();

    if (type === "consumption") {
      this.state.breadth_xp += appliedXP;
    } else {
      this.state.depth_xp += appliedXP;
    }

    if (!this.state.mastery_map[category]) {
      this.state.mastery_map[category] = { xp: 0, last_active: nowIso };
    }
    this.state.mastery_map[category].xp += appliedXP;
    this.state.mastery_map[category].last_active = nowIso;

    this.state.current_level = this.calculateLevel();
    const currentTier = TIER_BY_LEVEL.find(t => this.state.current_level >= t.minLevel);
    if (currentTier) this.state.scholarly_tier = currentTier.tier;

    this.state.updated_at = nowIso;

    return {
      appliedXP,
      level: this.state.current_level,
      tier: this.state.scholarly_tier,
      impact_factor: this.state.impact_factor
    };
  }
}

// --- Decay Logic ---

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DECAY_RATE = 0.02;

function calculateDecay(progression, now = new Date()) {
  const nowMs = now.getTime();
  const decayedCategories = [];

  Object.entries(progression.mastery_map).forEach(([category, entry]) => {
    const lastActiveMs = new Date(entry.last_active).getTime();
    if (Number.isNaN(lastActiveMs)) return;
    if (nowMs - lastActiveMs <= THIRTY_DAYS_MS) return;

    const reduced = Math.max(0, Math.floor(entry.xp * (1 - DECAY_RATE)));
    progression.mastery_map[category].xp = reduced;
    decayedCategories.push(category);
  });

  if (decayedCategories.length > 0) {
    progression.updated_at = now.toISOString();
  }

  return {
    decayedCategories,
    updatedMasteryMap: progression.mastery_map
  };
}

// --- Profile Builder ---

function buildUserProgressionProfile(progression) {
  const engine = new ProgressionEngine(progression);
  const totalXP = engine.getTotalXP();
  const currentLevel = progression.current_level;
  const nextLevel = currentLevel + 1;

  return {
    user_id: progression.user_id,
    xp: {
      breadth_xp: progression.breadth_xp,
      depth_xp: progression.depth_xp,
      total_xp: totalXP
    },
    progression: {
      current_level: currentLevel,
      scholarly_tier: progression.scholarly_tier,
      progress_to_next_level_percent: engine.getProgressToNextLevelPercent(),
      next_level_xp_requirement: engine.xpRequiredForLevel(nextLevel)
    },
    mastery_map: progression.mastery_map,
    impact_factor: progression.impact_factor,
    eureka_boost_until: progression.eureka_boost_until,
    timestamps: {
      created_at: progression.created_at,
      updated_at: progression.updated_at
    }
  };
}

module.exports = {
  createUserProgression,
  isUserProgression,
  ProgressionEngine,
  calculateDecay,
  buildUserProgressionProfile
};





