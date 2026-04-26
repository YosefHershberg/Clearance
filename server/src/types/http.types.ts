import type { Request } from 'express';

// REQUESTS -----------------------------------

export type CustomRequest = Request;

// RESPONSES -----------------------------------

export type MessageResponse = {
    message: string;
};

export type ValidationErrorDetail = {
    message: string;
};

export type ErrorResponse =
    | (MessageResponse & { stack?: string })
    | { error: string; details?: ValidationErrorDetail[] };
