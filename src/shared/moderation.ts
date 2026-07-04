import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

// Built once per isolate: compiling the dataset into matcher regexes isn't
// free, and the matcher is stateless/reusable across messages.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** Flags common profanity, including leetspeak/character-substitution variants. */
export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}
