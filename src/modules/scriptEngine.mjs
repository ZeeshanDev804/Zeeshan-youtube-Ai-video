export async function generateScript(topic) {
  console.log(`[ScriptEngine] Generating script for topic: ${topic}`);
  return {
    title: `Amazing Facts about ${topic}`,
    scriptText: "Did you know this mind-blowing fact? Stay tuned till the end to find out more incredible secrets!",
    durationEstimate: 30,
    prompts: [`${topic} high quality footage`, `cinematic ${topic} background`]
  };
}
