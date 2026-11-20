import type { Metadata } from "next";
import { BillingCheck } from "@/components/BillingCheck";

export const metadata: Metadata = { title: "Billing check · CV Assessments" };

export default function BillingPage() {
  return <BillingCheck />;
}
