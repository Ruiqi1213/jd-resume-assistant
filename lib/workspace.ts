export type DocumentItem = { id: string; name: string; text: string };
export type SavedFact = { id: string; question: string; answer: string };
export type Materials = { resumes: DocumentItem[]; facts: SavedFact[] };
export const MATERIALS_KEY = "jd-assistant-materials-v1";

export function restoreMaterials(raw: string | null): Materials {
  try {
    const data = JSON.parse(raw || "{}");
    const resumes = Array.isArray(data.resumes)
      ? data.resumes.filter(
          (x: DocumentItem) =>
            x &&
            typeof x.id === "string" &&
            typeof x.name === "string" &&
            typeof x.text === "string",
        )
      : [];
    const facts = Array.isArray(data.facts)
      ? data.facts.filter(
          (x: SavedFact) =>
            x &&
            typeof x.id === "string" &&
            typeof x.question === "string" &&
            typeof x.answer === "string",
        )
      : [];
    return { resumes: resumes.slice(0, 20), facts: facts.slice(0, 60) };
  } catch {
    return { resumes: [], facts: [] };
  }
}

// Reserve room for each source rather than letting the first resume fill the
// entire model context. Originals remain editable in the materials drawer.
export function materialContext(materials: Materials, selectedId = ""): string {
  const chosen = materials.resumes.find((item) => item.id === selectedId);
  const resumes = chosen ? [chosen] : materials.resumes;
  const perResume = Math.max(
    1,
    Math.floor(6000 / Math.max(1, resumes.length)) - 90,
  );
  const sources = resumes.map(
    (item) =>
      `【简历：${item.name.slice(0, 70)}】\n${item.text.slice(0, perResume)}`,
  );
  const facts = materials.facts
    .map((fact) => `${fact.question}\n${fact.answer}`)
    .join("\n\n")
    .slice(0, 1600);
  return [sources.join("\n\n"), facts && `【本人确认的补充经历】\n${facts}`]
    .filter(Boolean)
    .join("\n\n");
}

export function splitJobs(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*(?:-{3,}|={3,})\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function jobTitle(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 36) || "新岗位"
  );
}
