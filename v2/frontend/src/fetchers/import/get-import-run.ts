import { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type GetImportRunResponse = InferResponseType<
  (typeof client)["import"]["runs"][":workspaceId"][":runId"]["$get"],
  200
>;

export type ImportRun = GetImportRunResponse["run"];

export type ImportRunProject = ImportRun["projects"][number];

async function getImportRun(
  workspaceId: string,
  runId: string,
): Promise<GetImportRunResponse> {
  const response = await client.import.runs[":workspaceId"][":runId"].$get({
    param: { workspaceId, runId },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default getImportRun;
