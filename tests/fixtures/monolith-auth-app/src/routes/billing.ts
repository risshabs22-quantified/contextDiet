/**
 * UNRELATED to the auth flow.
 *
 * Billing/invoice routes. This module depends on `pdfGenerator` but has ZERO
 * structural connection to jwtUtils/crypto/authMiddleware. It forms its own
 * isolated subgraph:
 *
 *   index -> billing -> pdfGenerator
 *
 * A pruner focused on "Fix JWT verification" should slice this entire subgraph.
 */

import { Router, type Request, type Response } from "express";
import { renderPdf, type PdfDocument } from "../utils/pdfGenerator";

interface LineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

interface Invoice {
  id: string;
  customer: string;
  items: LineItem[];
  createdAt: number;
}

const invoices = new Map<string, Invoice>();

export const billingRouter = Router();

billingRouter.post("/invoices", (req: Request, res: Response) => {
  const { customer, items } = req.body ?? {};
  if (typeof customer !== "string" || !Array.isArray(items)) {
    return res.status(400).json({ error: "Invalid invoice payload" });
  }

  const invoice: Invoice = {
    id: `inv_${Date.now().toString(36)}`,
    customer,
    items,
    createdAt: Date.now(),
  };
  invoices.set(invoice.id, invoice);

  return res.status(201).json({
    id: invoice.id,
    total: formatCents(computeTotalCents(invoice)),
  });
});

billingRouter.get("/invoices/:id/pdf", (req: Request, res: Response) => {
  const invoice = invoices.get(req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  const doc: PdfDocument = {
    title: `Invoice ${invoice.id}`,
    author: "ContextDiet Billing",
    sections: [
      {
        heading: `Bill to: ${invoice.customer}`,
        lines: invoice.items.map(
          (item) =>
            `${item.quantity} x ${item.description} @ ${formatCents(item.unitPriceCents)}`
        ),
      },
      {
        heading: "Total",
        lines: [formatCents(computeTotalCents(invoice))],
      },
    ],
  };

  res.type("application/pdf").send(renderPdf(doc));
});

function computeTotalCents(invoice: Invoice): number {
  return invoice.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCents,
    0
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
