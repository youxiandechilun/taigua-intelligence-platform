/*
 * 中文导读：通用组件：badRequest.ts。相关类型、配置或辅助实现集中在本文件。
 */
import CustomApiError from "./customApiError.js";
import { StatusCodes } from "http-status-codes";

export class BadRequestError extends CustomApiError {
    constructor(message: string) {
        super(message, StatusCodes.BAD_REQUEST);
    }
}