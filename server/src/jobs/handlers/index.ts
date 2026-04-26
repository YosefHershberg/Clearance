import type { JobType, Job } from '../../generated/prisma/client';

export type JobHandler = (job: Job) => Promise<void>;

export const handlers: Partial<Record<JobType, JobHandler>> = {};

export function registerHandler(type: JobType, handler: JobHandler): void {
    handlers[type] = handler;
}
