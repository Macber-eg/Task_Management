import { fetchPhases } from "./planning-api";

async function getPhases(projectId: string) {
  return fetchPhases(projectId);
}

export default getPhases;
