import { api } from "../api/api"

export const GVCN_WEEKLY_SUMMARY_TASK = "weekly-summary"

export type GvcnAiReport = {
  content: string
  cached: boolean
  generatedAt: string
  updatedAt: string
}

type GvcnAiReportRequest = {
  task: string
  weekId: number
  classId?: number
  force?: boolean
}

export async function requestGvcnAiReport({
  task,
  weekId,
  classId,
  force = false,
}: GvcnAiReportRequest): Promise<GvcnAiReport> {
  const response = await api.post<GvcnAiReport>("/v1/gvcn/ai/tasks", {
    task,
    weekId,
    ...(classId ? { classId } : {}),
    ...(force ? { force: true } : {}),
  })
  return response.data
}
