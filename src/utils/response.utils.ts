import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export function successResponse<T>(res: Response, data: T, message?: string, statusCode: number = 200): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  
  return res.status(statusCode).json(response);
}

export function errorResponse(res: Response, error: string | Error, statusCode: number = 500): Response {
  const response: ApiResponse = {
    success: false,
    error: typeof error === 'string' ? error : error.message,
    timestamp: new Date().toISOString(),
  };
  
  return res.status(statusCode).json(response);
}