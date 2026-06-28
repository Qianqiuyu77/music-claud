export const AI_TAG_TAXONOMY = [
  "scene:focus",
  "scene:commute",
  "scene:workout",
  "scene:sleep",
  "scene:study",
  "scene:party",
  "scene:walk",
  "scene:travel",
  "scene:alone",
  "scene:background",
  "mood:calm",
  "mood:focused",
  "mood:bright",
  "mood:melancholy",
  "mood:romantic",
  "mood:nostalgic",
  "mood:healing",
  "mood:lonely",
  "mood:confident",
  "mood:dreamy",
  "energy:low",
  "energy:medium",
  "energy:high",
  "energy:rising",
  "energy:steady",
  "vocal:less_vocal",
  "vocal:vocal_ok",
  "vocal:instrumental",
  "vocal:strong_vocal",
  "lang:zh",
  "lang:en",
  "lang:ja",
  "lang:ko",
  "lang:mixed",
  "genre:pop",
  "genre:rock",
  "genre:folk",
  "genre:electronic",
  "genre:rap",
  "genre:rnb",
  "genre:acg",
  "genre:ost",
  "genre:live",
  "genre:remix"
] as const;

const taxonomySet = new Set<string>(AI_TAG_TAXONOMY);

export function filterAiTags(tags: string[]) {
  return Array.from(new Set(tags.filter((tag) => taxonomySet.has(tag))));
}

export function namespaceAiTags(tags: string[]) {
  return filterAiTags(tags).map((tag) => `ai:${tag}`);
}
