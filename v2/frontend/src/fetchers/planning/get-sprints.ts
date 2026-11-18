import { fetchSprints } from "./planning-api";

async function getSprints(projectId: string) {
  return fetchSprints(projectId);
}

export default getSprints;
