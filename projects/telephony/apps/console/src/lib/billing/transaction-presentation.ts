/*
 * 中文导读：用量与费用：transaction-presentation.ts。相关类型、配置或辅助实现集中在本文件。
 */
import type { BillingTransaction, MoneyMicros } from "@/src/lib/api/resources/billing";
import { uiLabel } from "@/src/lib/locale";

export type TransactionTone =
  | "credit"
  | "debit"
  | "danger"
  | "hold"
  | "release"
  | "neutral";

export interface TransactionPresentation {
  label: string;
  detail: string;
  statusLabel: string;
  amountMicros: number;
  amountPrefix: string;
  tone: TransactionTone;
}

function asMicros(value: MoneyMicros | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function typeOf(transaction: BillingTransaction) {
  return String(transaction.type ?? transaction.kind ?? "").toUpperCase();
}

function withDescription(transaction: BillingTransaction, fallback: string) {
  const description = transaction.description?.trim();
  if (!description) return fallback;
  const translated = uiLabel(description);
  return /[\u4e00-\u9fff]/.test(translated) ? translated : fallback;
}

export function getTransactionPresentation(
  transaction: BillingTransaction,
): TransactionPresentation {
  const type = typeOf(transaction);
  const reservedDelta =
    asMicros(transaction.reservedPaidDeltaMicros) +
    asMicros(transaction.reservedPromotionalDeltaMicros);
  const financialDelta =
    asMicros(transaction.paidBalanceDeltaMicros) +
    asMicros(transaction.promotionalBalanceDeltaMicros) -
    asMicros(transaction.debtDeltaMicros);
  const grossAmount = asMicros(
    transaction.grossAmountMicros ?? transaction.amountMicros,
  );
  const magnitude = grossAmount || Math.abs(financialDelta) || Math.abs(reservedDelta);
  const isNumberPurchase = type === "NUMBER_PURCHASE";
  const isNumberRenewal = type === "NUMBER_RENEWAL";

  if (
    type === "CALL_RESERVATION" ||
    ((isNumberPurchase || isNumberRenewal) && reservedDelta > 0)
  ) {
    return {
      label:
        type === "CALL_RESERVATION"
          ? "通话额度预留"
          : isNumberPurchase
            ? "号码购买金额预留"
            : "号码续费金额预留",
      detail: `${withDescription(transaction, "处理前预留额度")}· 临时预留，并非最终扣费`,
      statusLabel: "临时预留",
      amountMicros: magnitude,
      amountPrefix: "预留",
      tone: "hold",
    };
  }

  if (type === "RESERVATION_RELEASE") {
    const description = withDescription(transaction, "未使用的预留额度已退回");
    const originalDescription = transaction.description?.toLowerCase() ?? "";
    const context = originalDescription.includes("number")
      ? "号码预留金额已退回"
      : originalDescription.includes("call")
        ? "通话预留额度已退回"
        : "预留额度已退回";
    return {
      label: context,
      detail: `${description}· 原预留金额已恢复可用，并非新增充值`,
      statusLabel: "已退回",
      amountMicros: magnitude,
      amountPrefix: "退回",
      tone: "release",
    };
  }

  if (type === "CALL_SETTLEMENT" || isNumberPurchase || isNumberRenewal) {
    return {
      label:
        type === "CALL_SETTLEMENT"
          ? "通话用量已结算"
          : isNumberPurchase
            ? "电话号码已购买"
            : "电话号码已续费",
      detail: `${withDescription(transaction, "实际用量已结算")}· 最终结算费用`,
      statusLabel: "已结算",
      amountMicros: magnitude,
      amountPrefix: "−",
      tone: "debit",
    };
  }

  if (type === "PROMOTIONAL_GRANT") {
    return {
      label: "赠送通话额度",
      detail: withDescription(transaction, "一次性赠送额度"),
      statusLabel: "已入账",
      amountMicros: magnitude,
      amountPrefix: "+",
      tone: "credit",
    };
  }

  if (type === "TOP_UP") {
    const repaidDebt = asMicros(transaction.debtDeltaMicros) < 0;
    return {
      label: "余额充值",
      detail: repaidDebt
        ? "先结清欠费，再将剩余金额计入可用余额"
        : withDescription(transaction, "充值金额已计入余额"),
      statusLabel: repaidDebt ? "已入账 · 欠费已结清" : "已入账",
      amountMicros: magnitude,
      amountPrefix: "+",
      tone: "credit",
    };
  }

  if (type === "REFUND" || type === "DISPUTE") {
    return {
      label: type === "REFUND" ? "充值已退款" : "支付争议",
      detail:
        type === "REFUND"
          ? "退款金额已从充值余额扣除"
          : "争议付款已从充值余额冲回",
      statusLabel: "已冲回",
      amountMicros: magnitude,
      amountPrefix: "−",
      tone: "danger",
    };
  }

  if (type === "DEBT_INCURRED") {
    return {
      label: "待结清用量欠费",
      detail: withDescription(
        transaction,
        "服务商费用核对金额超过可用通话预留金额",
      ),
      statusLabel: "待支付金额",
      amountMicros: magnitude,
      amountPrefix: "待支付",
      tone: "danger",
    };
  }

  if (type === "DEBT_REPAYMENT") {
    return {
      label: "欠费已结清",
      detail: withDescription(transaction, "余额已用于偿还欠费"),
      statusLabel: "已用于偿还欠费",
      amountMicros: magnitude,
      amountPrefix: "已使用",
      tone: "release",
    };
  }

  if (type === "ADJUSTMENT") {
    const isCredit = financialDelta >= 0;
    return {
      label: withDescription(transaction, "余额调整"),
      detail: isCredit
        ? "用量修正后，额度已退回余额"
        : "计费调整后，余额已扣减",
      statusLabel: "已调整",
      amountMicros: magnitude,
      amountPrefix: isCredit ? "+" : "−",
      tone: isCredit ? "credit" : "debit",
    };
  }

  const isCredit = financialDelta >= 0;
  return {
    label: withDescription(transaction, "余额调整"),
    detail: "余额记录",
    statusLabel: uiLabel(transaction.status?.trim() || "recorded"),
    amountMicros: magnitude,
    amountPrefix: isCredit ? "+" : "−",
    tone: financialDelta === 0 ? "neutral" : isCredit ? "credit" : "debit",
  };
}
