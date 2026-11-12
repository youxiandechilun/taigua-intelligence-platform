/*
 * 中文导读：通用组件：unauthenticated.ts。相关类型、配置或辅助实现集中在本文件。
 */
import CustomApiError from "./customApiError.js";
import { StatusCodes } from "http-status-codes";

export class UnauthenticatedError extends CustomApiError {
    constructor(message: string) {
        super(message, StatusCodes.UNAUTHORIZED);
    }
}