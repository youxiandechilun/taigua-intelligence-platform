/*
 * 中文导读：HTTP 请求中间件：validate.middleware。在业务处理前后执行本文件定义的公共规则。
 */
// ================================
// src/middlewares/validate.middleware.ts
// ================================

import { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

const validate = (schema: ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
};
export default validate;
