import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import type { APIResponse } from '@cloud-clipboard/shared';

export const validateBody = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response<APIResponse>, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          data: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    }
  };
};

export const validateQuery = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response<APIResponse>, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Query validation error',
          data: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    }
  };
};

export const validateParams = <T>(schema: ZodSchema<T>) => {
  return (req: Request, res: Response<APIResponse>, next: NextFunction): void => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: 'Parameter validation error',
          data: error.errors,
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Internal server error',
        });
      }
    }
  };
};