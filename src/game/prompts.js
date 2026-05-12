const LOOP_LENGTH = 245;
const COURSE_START_Z = 6;

const LOOP_PROMPT_PLANS = Object.freeze([
  Object.freeze({
    sectionLabel: "Learning Trail",
    prompts: Object.freeze([
      { localStart: 0, localEnd: 14, text: "Hold ↑ to build Elephant Charge.", cues: ["start"] },
      { localStart: 14, localEnd: 42, text: "Follow the golden fruit and feel the big pink rhythm.", cues: ["fruit"] },
      { localStart: 42, localEnd: 64, text: "Monkey patrol ahead — tap E for a Spin Attack.", cues: ["monkey"] },
      { localStart: 64, localEnd: 96, text: "Use ← → to sway through the jungle trail.", cues: ["fruit"] },
      { localStart: 96, localEnd: 116, text: "Tap Space to leap the log. Watch the shadow, not the ears.", cues: ["log"] },
      { localStart: 116, localEnd: 142, text: "Tap Space again in the air for a BIG Bounce.", cues: ["fruit"] },
      { localStart: 142, localEnd: 162, text: "Low vines ahead — hold Space to Belly-Slide.", cues: ["branch"] },
      { localStart: 162, localEnd: 192, text: "Wooden crate ahead — press Z for a Trunk-Smash.", cues: ["crate"] },
      { localStart: 192, localEnd: 224, text: "Crocodile creek ahead. Stop, read the jaws, then charge.", cues: ["river"] },
      { localStart: 224, localEnd: 245, text: "Sugar cane restores energy after a jungle bump.", cues: ["health"] },
    ]),
  }),
  Object.freeze({
    sectionLabel: "Practice Grove",
    prompts: Object.freeze([
      { localStart: 0, localEnd: 42, text: "Practice Grove: build a braver Elephant Charge.", cues: ["start"] },
      { localStart: 42, localEnd: 64, text: "Monkey patrol returning — tap E to Spin Attack.", cues: ["monkey"] },
      { localStart: 64, localEnd: 96, text: "Sway through the fruit trail. Big feet, gentle steering.", cues: ["fruit"] },
      { localStart: 96, localEnd: 116, text: "Leap the log. Keep the shadow clear.", cues: ["log"] },
      { localStart: 116, localEnd: 142, text: "Reach the high fruit with a BIG Bounce.", cues: ["fruit"] },
      { localStart: 142, localEnd: 162, text: "Belly-Slide low before the branch.", cues: ["branch"] },
      { localStart: 162, localEnd: 192, text: "Trunk-Smash the crate with Z as it enters reach.", cues: ["crate"] },
      { localStart: 192, localEnd: 224, text: "Crocodile creek again. Stop, read, then stampede.", cues: ["river"] },
      { localStart: 224, localEnd: 245, text: "Sugar cane ahead. Gather your elephant energy.", cues: ["health"] },
    ]),
  }),
  Object.freeze({
    sectionLabel: "Stampede Hollow",
    prompts: Object.freeze([
      { localStart: 0, localEnd: 42, text: "Stampede Hollow: build a braver Elephant Charge.", cues: ["start"] },
      { localStart: 42, localEnd: 64, text: "Monkey patrol returning — tap E to Spin Attack.", cues: ["monkey"] },
      { localStart: 64, localEnd: 96, text: "Sway through the fruit trail. Big feet, gentle steering.", cues: ["fruit"] },
      { localStart: 96, localEnd: 116, text: "Leap the log. Keep the shadow clear.", cues: ["log"] },
      { localStart: 116, localEnd: 142, text: "Reach the high fruit with a BIG Bounce.", cues: ["fruit"] },
      { localStart: 142, localEnd: 162, text: "Belly-Slide low before the branch.", cues: ["branch"] },
      { localStart: 162, localEnd: 192, text: "Trunk-Smash the crate with Z as it enters reach.", cues: ["crate"] },
      { localStart: 192, localEnd: 224, text: "Crocodile creek again. Stop, read, then stampede.", cues: ["river"] },
      { localStart: 224, localEnd: 245, text: "Sugar cane ahead. Gather your elephant energy.", cues: ["health"] },
    ]),
  }),
]);

function loopPromptToWorldPrompt(loopIndex, prompt) {
  const loopStartZ = -loopIndex * LOOP_LENGTH;
  const promptStartZ = loopIndex === 0 && prompt.localStart === 0 ? COURSE_START_Z : loopStartZ - prompt.localStart;
  return Object.freeze({
    startZ: promptStartZ,
    endZ: loopStartZ - prompt.localEnd,
    text: prompt.text,
    cues: Object.freeze([...prompt.cues]),
  });
}

export const LEVEL_PROMPTS = Object.freeze([
  ...LOOP_PROMPT_PLANS.flatMap((loopPlan, loopIndex) => loopPlan.prompts.map((prompt) => loopPromptToWorldPrompt(loopIndex, prompt))),
  Object.freeze({
    startZ: -735,
    endZ: -760,
    text: "Final stretch. Trumpet proudly towards the Jungle Gate!",
    cues: Object.freeze(["finish"]),
  }),
]);

export function isZInPromptRange(z, prompt) {
  return z <= prompt.startZ && z > prompt.endZ;
}

export function promptForZ(z, prompts = LEVEL_PROMPTS) {
  return prompts.find((prompt) => isZInPromptRange(z, prompt))?.text || "";
}
