import { EXPLANATION_MAX_CHARS } from "../../config/constants.js";

// Bits both adapters need. Kept out of prompt.js so that file stays purely
// "what we ask the model", which is the thing worth reviewing carefully.

/** An AI call failed. services/explain.js catches this and falls back to a template. */
export class AIError extends Error {
  constructor(message, { provider, status, cause } = {}) {
    super(message);
    this.name = "AIError";
    this.provider = provider;
    this.status = status;
    this.cause = cause;
  }
}

/**
 * Normalizes model output into something safe to render under a score.
 *
 * Small models routinely wrap answers in quotes, prefix them with "Explanation:"
 * after being told not to, or run past the token cap and stop mid-word. None of
 * that should reach a renter, and none of it is worth a retry.
 *
 * @throws {AIError} when the model returned nothing usable — the caller falls
 *   back to the template rather than rendering an empty string.
 */
export function cleanExplanation(raw, provider) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AIError("model returned an empty explanation", { provider });
  }

  let text = raw.trim();

  // Strip a leading label the model added despite being asked not to.
  text = text.replace(/^(explanation|answer|response)\s*:\s*/i, "");
  // Strip symmetric wrapping quotes.
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Collapse newlines — this renders as one paragraph under a score.
  text = text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ");

  if (text.length > EXPLANATION_MAX_CHARS) {
    // Cut at the last sentence end inside the budget so we never show a
    // half-finished clause. Fall back to a hard cut if there is no sentence end.
    const clipped = text.slice(0, EXPLANATION_MAX_CHARS);
    const lastStop = Math.max(
      clipped.lastIndexOf(". "),
      clipped.lastIndexOf("! "),
      clipped.lastIndexOf("? ")
    );
    text =
      lastStop > EXPLANATION_MAX_CHARS * 0.5
        ? clipped.slice(0, lastStop + 1)
        : `${clipped.trimEnd()}…`;
  }

  if (text === "") {
    throw new AIError("model output was empty after cleanup", { provider });
  }
  return text;
}
