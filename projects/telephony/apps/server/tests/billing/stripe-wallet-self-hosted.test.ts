/*
 * 中文导读：既有验证代码：stripe-wallet-self-hosted.test 的输入、输出及边界场景。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type Stripe from "stripe";

process.env.QUICKVOICE_BILLING_MODE = "self_hosted";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@localhost:5432/quickvoice";

const { processStripeWalletEvent } =
  await import("../../src/modules/billing/stripe-wallet.service.js");

test("direct wallet event processing is a no-op in self-hosted mode", async () => {
  const event = {
    id: "evt_self_hosted_direct",
    type: "checkout.session.completed",
    livemode: false,
  } as Stripe.Event;

  await assert.doesNotReject(processStripeWalletEvent(event));
});
