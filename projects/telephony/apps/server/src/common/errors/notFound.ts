/*
 * 中文导读：通用组件：notFound.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { StatusCodes } from "http-status-codes";
import CustomApiError from "./customApiError.js";

export class NotFoundError extends CustomApiError {
    constructor(message: string) {
        super(message, StatusCodes.NOT_FOUND);
    }
}