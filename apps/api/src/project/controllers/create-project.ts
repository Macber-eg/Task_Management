import db from "../../database";
import { insertProject } from "./insert-project";

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  userId: string,
  startDate?: string | null,
  endDate?: string | null,
) {
  return db.transaction((tx) =>
    insertProject(tx, {
      workspaceId,
      name,
      icon,
      slug,
      userId,
      startDate,
      endDate,
    }),
  );
}

export default createProject;
