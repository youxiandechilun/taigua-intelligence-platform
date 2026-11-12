/*
 * 中文导读：通用组件：customApiError.ts。相关类型、配置或辅助实现集中在本文件。
 */
class CustomApiError extends Error {
    statusCode: number;
    code?: string;
    details?: unknown;

    constructor(
        message: string,
        statusCode: number,
        options: { code?: string; details?: unknown } = {},
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = options.code;
        this.details = options.details;
    }
}

export default CustomApiError;
