// "A crowd is relative to the room."
//
// The number of agreeing viewers needed for a Crowd Voice grows with the
// number of active chatters, but sub-linearly: a 9-person room can speak with
// 3 voices, a 400-person room needs ~32, a 5,000-person room ~113.
//   minVoices(room) = max(floor, min(roomFrac * room, sqrtK * sqrt(room)))
// Fixed mode (ablation / baselines) uses one constant for every room size.

export function minVoices(room, cfg) {
  if (!cfg.adaptive) return cfg.fixedMinVoices;
  const v = Math.min(cfg.roomFrac * room, cfg.sqrtK * Math.sqrt(Math.max(room, 0)));
  return Math.max(cfg.minFloor, Math.ceil(v));
}

/** Minimum share of the active room that must take part in a decision. */
export function minParticipation(cfg) {
  return cfg.adaptive ? cfg.minParticipation : 0;
}
