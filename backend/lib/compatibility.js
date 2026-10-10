// Roommate compatibility. Each factor is 0–100. Missing answers are skipped
// so an unfinished profile is not punished. The result never includes the
// other person's raw answers, budget, or contact details.

const WEIGHTS = {
  budget: 12,
  room: 8,
  sleep: 10,
  cleanliness: 10,
  noise: 10,
  smoking: 12,
  drinking: 8,
  study: 8,
  social: 8,
  pets: 8,
  interests: 6,
};

const MATCH_THRESHOLD = 60;

function ordinalScore(a, b, order) {
  if (!a || !b) return null;
  const left = order.indexOf(a);
  const right = order.indexOf(b);
  if (left < 0 || right < 0) return null;
  const distance = Math.abs(left - right);
  if (distance === 0) return 100;
  if (distance === 1) return 60;
  return 20;
}

function cleanlinessScore(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const distance = Math.abs(a - b);
  if (distance === 0) return 100;
  if (distance === 1) return 75;
  if (distance === 2) return 45;
  return 15;
}

function sameAnswerScore(a, b) {
  if (typeof a !== "boolean" || typeof b !== "boolean") return null;
  return a === b ? 100 : 0;
}

function budgetScore(aMax, bMax, rent) {
  if (aMax == null || bMax == null || !Number.isFinite(aMax) || !Number.isFinite(bMax) || aMax < 0 || bMax < 0) {
    return null;
  }
  const larger = Math.max(aMax, bMax);
  if (larger === 0) return 100;
  let score = Math.round((Math.min(aMax, bMax) / larger) * 100);
  const rentKnown = Number.isFinite(rent) && rent > 0;
  if (rentKnown && (aMax < rent || bMax < rent)) score = Math.min(score, 40);
  return score;
}

function roomScore(a, b, capacity) {
  if (!a || !b) return null;
  if (a === b) return 100;
  const sharedRoom = Number(capacity) > 1;
  const acceptsShared = (value) => value === "shared" || value === "either";
  const acceptsPrivate = (value) => value === "private" || value === "either";
  if (sharedRoom && acceptsShared(a) && acceptsShared(b)) return 80;
  if (!sharedRoom && acceptsPrivate(a) && acceptsPrivate(b)) return 80;
  if ((a === "private" && b === "shared") || (a === "shared" && b === "private")) return 15;
  return 50;
}

function interestScore(aList, bList) {
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const left = new Set((aList || []).map(normalize).filter(Boolean));
  const right = new Set((bList || []).map(normalize).filter(Boolean));
  if (left.size === 0 || right.size === 0) return { score: null, shared: [] };
  const shared = [];
  for (const item of left) {
    if (right.has(item)) shared.push(item);
  }
  const union = left.size + right.size - shared.length;
  return { score: union === 0 ? null : Math.round((shared.length / union) * 100), shared };
}

function factorStatus(score) {
  if (score >= 80) return "match";
  if (score >= 50) return "partial";
  return "differ";
}

function scoreLabel(score) {
  if (score >= 80) return "Strong match";
  if (score >= MATCH_THRESHOLD) return "Match";
  return "Low match";
}

function scoreCompatibility(viewer, other, context = {}) {
  if (!viewer || !other) {
    return { comparable: false, score: null, label: null, factors: [] };
  }

  const interest = interestScore(viewer.interests, other.interests);
  const pieces = [
    { key: "budget", label: "Budget", score: budgetScore(viewer.budgetMax, other.budgetMax, context.rent) },
    { key: "room", label: "Room type", score: roomScore(viewer.roomShare, other.roomShare, context.capacity) },
    { key: "sleep", label: "Sleep schedule", score: ordinalScore(viewer.sleepSchedule, other.sleepSchedule, ["early", "flexible", "late"]) },
    { key: "cleanliness", label: "Cleanliness", score: cleanlinessScore(viewer.cleanliness, other.cleanliness) },
    { key: "noise", label: "Noise", score: ordinalScore(viewer.noiseTolerance, other.noiseTolerance, ["quiet", "moderate", "lively"]) },
    { key: "smoking", label: "Smoking", score: sameAnswerScore(viewer.nonSmoker, other.nonSmoker) },
    { key: "drinking", label: "Drinking", score: sameAnswerScore(viewer.nonDrinker, other.nonDrinker) },
    { key: "study", label: "Study habits", score: ordinalScore(viewer.studyHabit, other.studyHabit, ["alone", "mixed", "group"]) },
    { key: "social", label: "Social style", score: ordinalScore(viewer.socialPreference, other.socialPreference, ["private", "balanced", "social"]) },
    { key: "pets", label: "Pets", score: ordinalScore(viewer.petPreference, other.petPreference, ["no_pets", "ok_with_pets", "has_pets"]) },
    { key: "interests", label: "Shared interests", score: interest.score, shared: interest.shared.slice(0, 3) },
  ];

  const comparable = pieces.filter((piece) => piece.score != null);
  if (comparable.length === 0) {
    return { comparable: false, score: null, label: null, factors: [] };
  }

  const weightTotal = comparable.reduce((sum, piece) => sum + WEIGHTS[piece.key], 0);
  const weighted = comparable.reduce((sum, piece) => sum + piece.score * WEIGHTS[piece.key], 0);
  const score = Math.round(weighted / weightTotal);

  return {
    comparable: true,
    score,
    label: scoreLabel(score),
    factors: comparable.map((piece) => ({
      key: piece.key,
      label: piece.label,
      status: factorStatus(piece.score),
      ...(piece.key === "interests" && piece.shared.length ? { shared: piece.shared } : {}),
    })),
  };
}

module.exports = {
  MATCH_THRESHOLD,
  scoreCompatibility,
};
