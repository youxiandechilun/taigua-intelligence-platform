/*
 * 中文导读：通用组件：paymentRequired.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { StatusCodes } from "http-status-codes";
import CustomApiError from "./customApiError.js";

export class PaymentRequiredError extends CustomApiError {
  constructor(
    message = "Insufficient prepaid credit",
    details: Record<string, unknown> = {},
  ) {
    super(message, StatusCodes.PAYMENT_REQUIRED, {
      code: "INSUFFICIENT_CREDIT",
      details,
    });
  }
}
