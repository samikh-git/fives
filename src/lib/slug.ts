const ADJECTIVES = [
  "amber", "brave", "calm", "clever", "cosmic", "eager", "fierce", "gentle",
  "golden", "happy", "hidden", "humble", "jolly", "keen", "lively", "lucky",
  "mighty", "nimble", "noble", "quiet", "quick", "rapid", "royal", "sharp",
  "shiny", "silent", "silver", "sleek", "sly", "smooth", "snappy", "solid",
  "spry", "steady", "stellar", "stormy", "sturdy", "sunny", "swift", "tidy",
  "tough", "vivid", "warm", "wild", "windy", "wise", "witty", "zesty",
  "bold", "crisp",
] as const;

const NOUNS = [
  "arrow", "badger", "beacon", "bison", "canyon", "cobra", "comet", "condor",
  "coyote", "crane", "eagle", "ember", "falcon", "ferret", "fox", "gecko",
  "glacier", "harbor", "hawk", "heron", "ibex", "jaguar", "kestrel", "lantern",
  "lynx", "meadow", "meteor", "otter", "panther", "phoenix", "puma",
  "quartz", "raven", "reef", "ridge", "river", "rocket", "summit", "tiger",
  "timber", "tundra", "viper", "vortex", "walrus", "willow", "wolf", "wren",
  "zebra", "zephyr",
] as const;

/** Two-word slug like "swift-otter", human-readable for sharing in a game URL. */
export function generateGameSlug(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective}-${noun}`;
}
