export type TimeEntry = {
  duration: number | null;
  id: string;
  createdAt: string;
  updatedAt?: string;
  description: string | null;
  userId: string | null;
  userName?: string | null;
  taskId: string;
  startTime: string;
  endTime: string | null;
};
