/*
 * 中文导读：HTTP 请求中间件：notFound.middleware。在业务处理前后执行本文件定义的公共规则。
 */
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { createErrorEnvelope, getRequestId } from "./error-envelope.js";

const notFoundMiddleware = (req: Request, res: Response) => {
  res.status(StatusCodes.NOT_FOUND).json(
    createErrorEnvelope({
      code: "NOT_FOUND",
      message: "Route not found",
      requestId: getRequestId(req),
    })
  );
};

export default notFoundMiddleware;
