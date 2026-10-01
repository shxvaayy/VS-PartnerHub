import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";

export function advancedProcurementCases(h: any) {
  const {
    clients,
    post,
    patch,
    get,
    input,
    line,
    org,
    rid,
    future,
    transition,
  } = h;
  const item = (price = 100, quantity = 10) => ({
    ...line(price, quantity),
    tax: 0,
    discount: 0,
  });
  async function makeOrder(buyer = "buyer", seller = "vendor", quantity = 10) {
    let rfq = await post(
      buyer,
      "/records/rfqs",
      input(
        "Advanced control acceptance RFQ",
        {
          deadline: future(10),
          required_date: future(30),
          delivery_address: "Buyer receiving facility",
        },
        { invitations: [org(seller)], items: [item(0, quantity)] },
      ),
      201,
    );
    rfq = await transition(buyer, rfq, "published");
    let quote = await post(
      seller,
      "/records/quotations",
      input(
        "Advanced control quotation",
        {
          delivery_date: future(20),
          validity: future(30),
          payment_terms: "Net 30",
        },
        { parent_id: rfq.id, items: [item(100, quantity)] },
      ),
      201,
    );
    quote = await transition(seller, quote, "submitted");
    quote = await transition(buyer, quote, "approved");
    let order = await post(
      buyer,
      "/records/orders",
      input(
        "Advanced control purchase order",
        {
          delivery_date: future(20),
          delivery_address: "Buyer receiving facility",
          payment_terms: "Net 30",
        },
        { parent_id: quote.id },
      ),
      201,
    );
    for (const status of ["pending_approval", "approved", "sent"])
      order = await transition(buyer, order, status);
    return transition(seller, order, "acknowledged");
  }
  async function deliveryFor(order: any, seller = "vendor") {
    let delivery = await post(
      seller,
      "/records/deliveries",
      input(
        "Acceptance test shipment",
        {
          carrier: "Acceptance logistics",
          tracking_number: randomUUID(),
          expected_date: future(3),
        },
        { parent_id: order.id },
      ),
      201,
    );
    for (const status of ["dispatched", "in_transit", "delivered"])
      delivery = await transition(seller, delivery, status);
    return delivery;
  }
  const receipt = (order: any, quantity: number, rejected = 0) => ({
    reference: "QA-GRN-" + randomUUID().slice(0, 8),
    received_date: future(0),
    lines: [
      {
        order_item_id: order.items[0].id,
        accepted_quantity: quantity,
        rejected_quantity: rejected,
      },
    ],
  });
  const accept = (
    order: any,
    delivery: any,
    quantity: number,
    expected = 200,
    key = "buyer",
    rejected = 0,
  ) =>
    post(
      key,
      `/records/deliveries/${delivery.id}/transition`,
      {
        status: "confirmed",
        version: delivery.version,
        note: "Inspected against the agreed order and delivery evidence.",
        receipt: receipt(order, quantity, rejected),
      },
      expected,
    );
  const invoiceBody = (order: any, price = 100, quantity = 10) =>
    input(
      "Independently entered supplier invoice",
      {
        invoice_number: "QA-3WM-" + randomUUID().slice(0, 8),
        invoice_date: future(0),
        due_date: future(30),
      },
      {
        parent_id: order.id,
        items: [
          { ...item(price, quantity), source_item_id: order.items[0].id },
        ],
      },
    );

  describe("advanced procurement controls", () => {
    let order: any,
      invoice: any,
      firstDelivery: any,
      payment1: any,
      payment2: any;
    let account: any,
      accountUsd: any,
      accountInternal: any,
      bankA: any,
      bankB: any,
      credit: any;
    const header =
      "date,transaction_id,reference,description,debit,credit,currency\n";
    const statement = (rows: string[], name = "statement.csv") => ({
      file_name: name,
      csv: header + rows.join("\n") + "\n",
    });
    const bankRow = (
      id: string,
      debit: number,
      credit = 0,
      currency = "INR",
      description = "Bank entry",
    ) =>
      [
        future(0),
        id,
        id,
        description,
        debit || "",
        credit || "",
        currency,
      ].join(",");
    beforeAll(async () => {
      for (const key of [
        "buyer",
        "vendor",
        "supplier",
        "service",
        "finance",
        "admin",
        "verification",
        "support",
      ])
        await h.login(key);
    });

    it("records partial and rejected quantities without fulfilling the whole PO", async () => {
      order = await makeOrder();
      firstDelivery = await deliveryFor(order);
      await transition("buyer", firstDelivery, "confirmed", 422);
      await accept(order, firstDelivery, 4, 403, "vendor");
      firstDelivery = await accept(order, firstDelivery, 4, 200, "buyer", 2);
      const received = await get(
        "buyer",
        `/records/orders/${order.id}/receiving`,
      );
      expect(received.lines[0]).toMatchObject({
        accepted_quantity: 4,
        rejected_quantity: 2,
        remaining_quantity: 6,
      });
      expect(received.complete).toBe(false);
      expect(received.receipts[0].accepted_by).toBe(clients.buyer.user.id);
      expect((await get("buyer", `/records/orders/${order.id}`)).status).toBe(
        "acknowledged",
      );
      await transition("buyer", order, "fulfilled", 422);
      await get("supplier", `/records/orders/${order.id}/receiving`, 404);
    });

    it("rejects foreign lines, duplicate lines, future dates and over-receipts atomically", async () => {
      const delivery = await deliveryFor(order),
        base = receipt(order, 6);
      for (const invalid of [
        { ...base, lines: [{ ...base.lines[0], order_item_id: randomUUID() }] },
        { ...base, lines: [base.lines[0], base.lines[0]] },
        { ...base, received_date: future(1) },
        { ...base, lines: [{ ...base.lines[0], accepted_quantity: 7 }] },
        { ...base, lines: [{ ...base.lines[0], accepted_quantity: -1 }] },
        { ...base, lines: [{ ...base.lines[0], accepted_quantity: 0.0001 }] },
      ])
        await post(
          "buyer",
          `/records/deliveries/${delivery.id}/transition`,
          { status: "confirmed", version: delivery.version, receipt: invalid },
          422,
        );
      expect(
        (await get("buyer", `/records/orders/${order.id}/receiving`)).receipts,
      ).toHaveLength(1);
      expect(
        (await get("buyer", `/records/deliveries/${delivery.id}`)).status,
      ).toBe("delivered");
    });

    it("serializes concurrent receipts against the same remaining PO quantity", async () => {
      const left = await deliveryFor(order),
        right = await deliveryFor(order);
      const requests = [left, right].map((delivery) =>
        clients.buyer.agent
          .post(`/api/records/deliveries/${delivery.id}/transition`)
          .set("X-CSRF-Token", clients.buyer.token)
          .send({
            status: "confirmed",
            version: delivery.version,
            receipt: receipt(order, 6),
            note: "Concurrent receiving acceptance.",
          }),
      );
      const responses = await Promise.all(requests);
      expect(responses.map((r: any) => r.status).sort()).toEqual([200, 422]);
      const received = await get(
        "buyer",
        `/records/orders/${order.id}/receiving`,
      );
      expect(received.lines[0].accepted_quantity).toBe(10);
      expect(received.receipts).toHaveLength(2);
      expect(received.complete).toBe(true);
      order = await get("buyer", `/records/orders/${order.id}`);
      expect(order.status).toBe("fulfilled");
    });

    it("retains an older selected invoice source beyond the lookup limit without exposing another buyer's PO", async () => {
      const source = await h.db("records").where({ id: order.id }).first();
      const extra = Array.from({ length: 201 }, (_, index) => ({
        ...source,
        id: randomUUID(),
        number: "QA-LOOKUP-" + randomUUID(),
        title: "Recent purchase order lookup fixture " + index,
        parent_id: null,
        external_key: null,
        relationship_key: null,
        created_at: new Date(Date.now() + 1000 + index).toISOString(),
      }));
      try {
        for (let offset = 0; offset < extra.length; offset += 25)
          await h.db("records").insert(extra.slice(offset, offset + 25));
        const recent = await get("vendor", "/lookups?kind=invoices");
        expect(
          recent.parents.some((parent: any) => parent.id === order.id),
        ).toBe(false);
        const selected = await get(
          "vendor",
          `/lookups?kind=invoices&parent_id=${order.id}`,
        );
        expect(selected.parents[0].id).toBe(order.id);
        expect(selected.parents[0].items[0].id).toBe(order.items[0].id);
        const unrelated = await get(
          "supplier",
          `/lookups?kind=invoices&parent_id=${order.id}`,
        );
        expect(
          unrelated.parents.some((parent: any) => parent.id === order.id),
        ).toBe(false);
      } finally {
        await h
          .db("records")
          .whereIn(
            "id",
            extra.map((row) => row.id),
          )
          .delete();
      }
    });

    it("stores actual invoice amounts and blocks approval on price and quantity exceptions", async () => {
      await post(
        "vendor",
        "/records/invoices",
        { ...invoiceBody(order), items: [] },
        422,
      );
      const foreign = invoiceBody(order);
      foreign.items[0].source_item_id = randomUUID();
      await post("vendor", "/records/invoices", foreign, 422);
      invoice = await post(
        "vendor",
        "/records/invoices",
        invoiceBody(order, 110),
        201,
      );
      expect(invoice.amount_minor).toBe(110000);
      expect(order.amount_minor).toBe(100000);
      let match = await get(
        "finance",
        `/records/invoices/${invoice.id}/matching`,
      );
      expect(match.status).toBe("exception");
      expect(match.lines[0].issues).toContain("Unit price differs from PO");
      invoice = await transition("vendor", invoice, "submitted");
      invoice = await transition("finance", invoice, "under_review");
      await transition("finance", invoice, "approved", 422);
      invoice = await transition("finance", invoice, "rejected");
      invoice = await patch("vendor", `/records/invoices/${invoice.id}`, {
        ...invoice,
        items: [{ ...item(200, 5), source_item_id: order.items[0].id }],
      });
      expect(invoice.amount_minor).toBe(order.amount_minor);
      match = await get("buyer", `/records/invoices/${invoice.id}/matching`);
      expect(match.status).toBe("exception");
      expect(match.lines[0].issues).toContain(
        "Invoice quantity differs from PO",
      );
      expect(match.variance_minor).toBe(0);
      await get("supplier", `/records/invoices/${invoice.id}/matching`, 404);
    });

    it("approves a corrected invoice only after a full factual three-way match", async () => {
      invoice = await patch("vendor", `/records/invoices/${invoice.id}`, {
        ...invoice,
        items: [{ ...item(), source_item_id: order.items[0].id }],
      });
      expect(
        (await get("finance", `/records/invoices/${invoice.id}/matching`))
          .status,
      ).toBe("matched");
      invoice = await transition("vendor", invoice, "draft");
      invoice = await transition("vendor", invoice, "submitted");
      await transition("vendor", invoice, "approved", 403);
      invoice = await transition("finance", invoice, "approved");
      expect(invoice.status).toBe("approved");
      expect(
        (
          await get(
            "finance",
            `/records/invoices/${rid("invoice:chairs")}/matching`,
          )
        ).status,
      ).toBe("missing_receipt");
    });

    it("keeps contract-backed invoices in their contractual review workflow", async () => {
      let contract = await post(
        "buyer",
        "/records/contracts",
        input(
          "Contract-only invoice acceptance",
          {
            start_date: future(0),
            end_date: future(180),
            payment_terms: "Net 30",
          },
          { partner_org_id: org("vendor"), items: [item(100, 1)] },
        ),
        201,
      );
      for (const status of ["review", "approved", "active"])
        contract = await transition("buyer", contract, status);
      const contractInvoice = await post(
        "vendor",
        "/records/invoices",
        input(
          "Contract invoice without a goods PO",
          {
            invoice_number: "QA-CONTRACT-MATCH",
            invoice_date: future(0),
            due_date: future(30),
          },
          { parent_id: contract.id },
        ),
        201,
      );
      expect(
        (
          await get(
            "finance",
            `/records/invoices/${contractInvoice.id}/matching`,
          )
        ).status,
      ).toBe("not_applicable");
      expect(contractInvoice.amount_minor).toBe(contract.amount_minor);
    });

    it("allows buyer-reviewed historical evidence without inventing legacy invoice matches", async () => {
      const legacy = await get("buyer", `/records/orders/${rid("po:chairs")}`);
      expect(
        (await get("buyer", `/records/orders/${legacy.id}/receiving`))
          .can_record_evidence,
      ).toBe(true);
      const data = {
        version: legacy.version,
        type: "goods",
        note: "Historical receipt checked against the original acceptance evidence.",
        receipt: {
          reference: "QA-HISTORICAL-GRN",
          received_date: future(0),
          lines: legacy.items.map((line: any) => ({
            order_item_id: line.id,
            accepted_quantity: line.quantity,
            rejected_quantity: 0,
          })),
        },
      };
      await post(
        "supplier",
        `/records/orders/${legacy.id}/receiving`,
        data,
        403,
      );
      const recorded = await post(
        "buyer",
        `/records/orders/${legacy.id}/receiving`,
        data,
        201,
      );
      expect(recorded.complete).toBe(true);
      expect(recorded.receipts[0].source_record_id).toBeNull();
      expect((await get("buyer", `/records/orders/${legacy.id}`)).status).toBe(
        legacy.status,
      );
      expect(
        (
          await get(
            "finance",
            `/records/invoices/${rid("invoice:chairs")}/matching`,
          )
        ).status,
      ).toBe("exception");
      await post("buyer", `/records/orders/${legacy.id}/receiving`, data, 409);
    });

    it("supports explicit service acceptance against order quantities", async () => {
      const serviceOrder = await makeOrder("buyer", "service", 1);
      let milestone = await post(
        "service",
        "/records/milestones",
        input(
          "Service acceptance evidence",
          {
            due_date: future(10),
            deliverable: "Configured service verified by client",
            completion_notes: "Acceptance criteria and deliverable provided.",
            amount: 100,
          },
          { parent_id: serviceOrder.id },
        ),
        201,
      );
      milestone = await transition("service", milestone, "in_progress");
      milestone = await transition("service", milestone, "submitted");
      await transition("buyer", milestone, "approved", 422);
      await post("buyer", `/records/milestones/${milestone.id}/transition`, {
        status: "approved",
        version: milestone.version,
        note: "Service completion inspected by buyer.",
        receipt: receipt(serviceOrder, 1),
      });
      const received = await get(
        "buyer",
        `/records/orders/${serviceOrder.id}/receiving`,
      );
      expect(received.receipts[0].type).toBe("service");
      expect(received.complete).toBe(true);
      expect(
        (await get("buyer", `/records/orders/${serviceOrder.id}`)).status,
      ).toBe("fulfilled");
    });

    it("publishes RFPs with explicit criteria and requires a real proposal response", async () => {
      let rfp = await post(
        "buyer",
        "/records/rfqs",
        input(
          "Enterprise RFP evaluation acceptance",
          {
            solicitation_type: "RFP",
            deadline: future(10),
            required_date: future(30),
            delivery_address: "Buyer delivery location",
            technical_weight: 70,
          },
          { invitations: [org("vendor")], items: [item()] },
        ),
        201,
      );
      expect(rfp.number).toMatch(/^RFP-/);
      await transition("buyer", rfp, "published", 422);
      rfp = await patch("buyer", `/records/rfqs/${rfp.id}`, {
        ...rfp,
        payload: {
          ...rfp.payload,
          scope_of_work:
            "Provide the proposed solution, delivery milestones and implementation evidence.",
          evaluation_criteria:
            "Technical fit, capability and implementation quality; commercial value and terms.",
        },
      });
      rfp = await transition("buyer", rfp, "published");
      expect(
        (await get("buyer", "/records/rfqs?solicitation_type=RFP")).items.some(
          (row: any) => row.id === rfp.id,
        ),
      ).toBe(true);
      expect(
        (
          await get("buyer", "/records/rfqs?solicitation_type=RFQ&limit=100")
        ).items.some((row: any) => row.id === rfp.id),
      ).toBe(false);
      let quote = await post(
        "vendor",
        "/records/quotations",
        input(
          "RFP technical and commercial proposal",
          {
            delivery_date: future(20),
            validity: future(30),
            payment_terms: "Net 30",
          },
          { parent_id: rfp.id, items: [item()] },
        ),
        201,
      );
      await transition("vendor", quote, "submitted", 422);
      quote = await patch("vendor", `/records/quotations/${quote.id}`, {
        ...quote,
        payload: {
          ...quote.payload,
          technical_proposal:
            "A technical solution mapped to each stated requirement and expected outcome.",
          implementation_plan:
            "Discovery, implementation, verification and buyer acceptance over four weeks.",
          compliance_response:
            "All mandatory requirements addressed with documented evidence.",
        },
      });
      quote = await transition("vendor", quote, "submitted");
      await transition("buyer", quote, "approved", 422);
      await get("vendor", `/records/quotations/${quote.id}/evaluation`, 403);
      let assessment = await post(
        "buyer",
        `/records/quotations/${quote.id}/evaluation`,
        {
          quotation_version: quote.version,
          version: 0,
          technical_score: 80,
          commercial_score: 60,
          notes:
            "Scored using the published fit and commercial value criteria.",
        },
      );
      expect(assessment.evaluation.weighted_score).toBe(74);
      expect(assessment.evaluation.current).toBe(true);
      expect((await get("buyer", `/records/rfqs/${rfp.id}`)).status).toBe(
        "published",
      );
      expect(
        (
          await get("vendor", `/records/quotations/${quote.id}/history`)
        ).events.some((event: any) => event.action === "proposal_evaluated"),
      ).toBe(false);
      quote = await transition("buyer", quote, "under_review");
      expect(
        (await get("buyer", `/records/quotations/${quote.id}/evaluation`))
          .evaluation.current,
      ).toBe(true);
      quote = await transition("buyer", quote, "clarification");
      quote = await patch("vendor", `/records/quotations/${quote.id}`, {
        ...quote,
        payload: {
          ...quote.payload,
          implementation_plan:
            "Revised implementation using five weeks and a different deployment phase.",
        },
      });
      quote = await transition("vendor", quote, "submitted");
      expect(
        (await get("buyer", `/records/quotations/${quote.id}/evaluation`))
          .evaluation.current,
      ).toBe(false);
      await transition("buyer", quote, "approved", 422);
      assessment = await post(
        "buyer",
        `/records/quotations/${quote.id}/evaluation`,
        {
          quotation_version: quote.version,
          version: 1,
          technical_score: 75,
          commercial_score: 60,
          notes:
            "The revised implementation has been assessed against published criteria.",
        },
      );
      expect(assessment.evaluation.current).toBe(true);
      const comparison = await get("buyer", `/records/rfqs/${rfp.id}/compare`);
      expect(
        comparison.quotations[0].proposal_evaluation.evaluation.weighted_score,
      ).toBe(70.5);
      await transition("buyer", quote, "approved");
      expect((await get("buyer", `/records/rfqs/${rfp.id}`)).status).toBe(
        "awarded",
      );
    });

    it("restricts bank accounts to authorized buyer finance users and currency", async () => {
      await get("vendor", "/reconciliation/accounts", 403);
      await get("support", "/reconciliation/accounts", 403);
      await post(
        "buyer",
        "/reconciliation/accounts",
        {
          organization_id: org("vendor"),
          name: "Invalid supplier bank",
          bank_name: "Test bank",
          last4: "1001",
          currency: "INR",
        },
        403,
      );
      account = await post(
        "buyer",
        "/reconciliation/accounts",
        {
          organization_id: org("buyer"),
          name: "Acceptance INR account",
          bank_name: "Test bank",
          last4: "1001",
          currency: "INR",
        },
        201,
      );
      accountUsd = await post(
        "buyer",
        "/reconciliation/accounts",
        {
          organization_id: org("buyer"),
          name: "Acceptance USD account",
          bank_name: "Test bank",
          last4: "1002",
          currency: "USD",
        },
        201,
      );
      const { INTERNAL_ORG_ID } = await import("../server/config.js");
      accountInternal = await post(
        "admin",
        "/reconciliation/accounts",
        {
          organization_id: INTERNAL_ORG_ID,
          name: "Internal buyer account",
          bank_name: "Test bank",
          last4: "1003",
          currency: "INR",
        },
        201,
      );
      await get(
        "buyer",
        `/reconciliation/accounts/${accountInternal.id}/transactions`,
        404,
      );
      expect(
        (await get("buyer", "/reconciliation/accounts")).items.some(
          (row: any) => row.id === accountInternal.id,
        ),
      ).toBe(false);
      payment1 = await post(
        "buyer",
        "/records/payments",
        input(
          "First actual payment record",
          {
            amount: 500,
            reference: "QA-BANK-A",
            transaction_id: "QA-BANK-A",
            payment_date: future(0),
          },
          { parent_id: invoice.id },
        ),
        201,
      );
      payment2 = await post(
        "buyer",
        "/records/payments",
        input(
          "Second actual payment record",
          {
            amount: 500,
            reference: "QA-BANK-B",
            transaction_id: "QA-BANK-B",
            payment_date: future(0),
          },
          { parent_id: invoice.id },
        ),
        201,
      );
    });

    it("previews statements, deduplicates re-imports and rejects conflicting evidence", async () => {
      const file = statement([
        bankRow("QA-BANK-A", 600),
        bankRow("QA-BANK-B", 400),
        bankRow("QA-BANK-CREDIT", 0, 50),
        bankRow("QA-BANK-FEE", 10, 0, "INR", "=2+2"),
      ]);
      const preview = await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import-preview`,
        file,
      );
      expect(preview).toMatchObject({
        valid: true,
        new_rows: 4,
        duplicate_rows: 0,
      });
      expect(
        await h
          .db("bank_transactions")
          .where({ account_id: account.id })
          .count({ n: "*" })
          .first(),
      ).toMatchObject({ n: h.db.client.config.client === "pg" ? "0" : 0 });
      const imported = await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import`,
        file,
        201,
      );
      expect(imported.imported_rows).toBe(4);
      const repeated = await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import`,
        file,
        201,
      );
      expect(repeated.repeated).toBe(true);
      expect(
        (
          await post(
            "buyer",
            `/reconciliation/accounts/${account.id}/import-preview`,
            file,
          )
        ).duplicate_rows,
      ).toBe(4);
      const conflict = statement([bankRow("QA-BANK-A", 601)]);
      expect(
        (
          await post(
            "buyer",
            `/reconciliation/accounts/${account.id}/import-preview`,
            conflict,
          )
        ).valid,
      ).toBe(false);
      await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import`,
        conflict,
        422,
      );
      const list = await get(
        "buyer",
        `/reconciliation/accounts/${account.id}/transactions`,
      );
      expect(list.total).toBe(4);
      bankA = list.items.find((row: any) => row.transaction_id === "QA-BANK-A");
      bankB = list.items.find((row: any) => row.transaction_id === "QA-BANK-B");
      credit = list.items.find(
        (row: any) => row.transaction_id === "QA-BANK-CREDIT",
      );
    });

    it("rejects malformed, negative, duplicate, mixed-currency and future statement rows", async () => {
      for (const rows of [
        [bankRow("NEGATIVE", -1)],
        [bankRow("BOTH", 10, 5)],
        [bankRow("ZERO", 0)],
        [bankRow("PRECISION", 1.001)],
        [bankRow("DUPLICATE", 10), bankRow("DUPLICATE", 10)],
        [bankRow("CURRENCY", 10, 0, "USD")],
        [bankRow("FUTURE", 10).replace(future(0), future(1))],
        [bankRow("BAD-DATE", 10).replace(future(0), "2026-02-30")],
      ]) {
        const file = statement(rows);
        expect(
          (
            await post(
              "buyer",
              `/reconciliation/accounts/${account.id}/import-preview`,
              file,
            )
          ).valid,
        ).toBe(false);
        await post(
          "buyer",
          `/reconciliation/accounts/${account.id}/import`,
          file,
          422,
        );
      }
      await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import-preview`,
        { file_name: "invalid.csv", csv: "date,debit\n2026-01-01,10" },
        422,
      );
      expect(
        (
          await get(
            "buyer",
            `/reconciliation/accounts/${account.id}/transactions`,
          )
        ).total,
      ).toBe(4);
    });

    it("matches completed payments only and enforces bank and payment balances", async () => {
      const match = (allocations: any[]) => ({
        version: bankA.version,
        note: "Reviewed bank references and payment evidence.",
        allocations,
      });
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([{ payment_id: payment1.id, amount: 100 }]),
        422,
      );
      expect(
        (
          await get("buyer", `/reconciliation/transactions/${bankA.id}`)
        ).candidates.some((row: any) => row.id === payment1.id),
      ).toBe(false);
      payment1 = await transition("finance", payment1, "completed");
      payment2 = await transition("finance", payment2, "completed");
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([{ payment_id: payment1.id, amount: 501 }]),
        422,
      );
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([
          { payment_id: payment1.id, amount: 500 },
          { payment_id: payment2.id, amount: 101 },
        ]),
        422,
      );
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([
          { payment_id: payment1.id, amount: 100 },
          { payment_id: payment1.id, amount: 100 },
        ]),
        422,
      );
      await post(
        "buyer",
        `/reconciliation/transactions/${credit.id}/allocations`,
        {
          version: credit.version,
          note: "A credit cannot clear an outgoing payment.",
          allocations: [{ payment_id: payment1.id, amount: 10 }],
        },
        422,
      );
      const matched = await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([{ payment_id: payment1.id, amount: 400 }]),
      );
      expect(matched.transaction).toMatchObject({
        status: "partial",
        matched_minor: 40000,
        remaining_minor: 20000,
      });
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        match([{ payment_id: payment1.id, amount: 1 }]),
        409,
      );
      bankA = matched.transaction;
    });

    it("supports split statement matches across multiple payments without changing payment status", async () => {
      const result = await post(
        "finance",
        `/reconciliation/transactions/${bankB.id}/allocations`,
        {
          version: bankB.version,
          note: "The bank debit covers two invoice payments.",
          allocations: [
            { payment_id: payment1.id, amount: 100 },
            { payment_id: payment2.id, amount: 300 },
          ],
        },
      );
      bankB = result.transaction;
      expect(bankB.status).toBe("matched");
      const finish = await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/allocations`,
        {
          version: bankA.version,
          note: "Remaining payment supported by this bank debit.",
          allocations: [{ payment_id: payment2.id, amount: 200 }],
        },
      );
      bankA = finish.transaction;
      expect(bankA.status).toBe("matched");
      for (const payment of [payment1, payment2])
        expect(
          (await get("buyer", `/reconciliation/payments/${payment.id}`))
            .remaining_minor,
        ).toBe(0);
      expect(
        (await get("buyer", `/records/invoices/${invoice.id}`)).status,
      ).toBe("paid");
      expect(
        (await get("buyer", `/records/payments/${payment1.id}`)).status,
      ).toBe("completed");
      expect(
        (
          await get(
            "buyer",
            `/reconciliation/accounts/${account.id}/transactions?status=matched`,
          )
        ).total,
      ).toBe(2);
      await get("vendor", `/reconciliation/transactions/${bankA.id}`, 403);
      await get("vendor", `/reconciliation/payments/${payment1.id}`, 403);
    });

    it("keeps classified fees and credits separate and exports safe filtered ledger rows", async () => {
      const list = await get(
        "buyer",
        `/reconciliation/accounts/${account.id}/transactions`,
      );
      const fee = list.items.find(
        (row: any) => row.transaction_id === "QA-BANK-FEE",
      );
      await post(
        "buyer",
        `/reconciliation/transactions/${bankA.id}/exception`,
        {
          version: bankA.version,
          category: "other",
          note: "Cannot hide an actively matched debit.",
        },
        422,
      );
      await post("buyer", `/reconciliation/transactions/${fee.id}/exception`, {
        version: fee.version,
        category: "bank_fee",
        note: "Bank service fee confirmed against the statement.",
      });
      const classified = await post(
        "buyer",
        `/reconciliation/transactions/${credit.id}/exception`,
        {
          version: credit.version,
          category: "refund",
          note: "Incoming supplier refund to be handled separately.",
        },
      );
      expect(classified.transaction.status).toBe("exception");
      expect(
        classified.events.some(
          (event: any) =>
            event.action === "bank_exception_reviewed" &&
            event.new_status === "refund",
        ),
      ).toBe(true);
      const totals = (
        await get(
          "buyer",
          `/reconciliation/accounts/${account.id}/transactions`,
        )
      ).summary;
      expect(totals).toMatchObject({
        matched_minor: 100000,
        unmatched_minor: 0,
        exception_minor: 6000,
        credit_minor: 5000,
      });
      const exported = await clients.buyer.agent.get(
        `/api/reconciliation/accounts/${account.id}/export?status=exception`,
      );
      expect(exported.status).toBe(200);
      const rows = parseCsv(exported.text, { bom: true, columns: true });
      expect(rows).toHaveLength(2);
      expect(
        rows.find((row: any) => row["Transaction ID"] === "QA-BANK-FEE")
          .Description,
      ).toBe("'=2+2");
      await post(
        "buyer",
        `/reconciliation/transactions/${credit.id}/exception`,
        {
          version: classified.transaction.version,
          category: "open",
          note: "Reopened for an updated finance review.",
        },
      );
      expect(
        (
          await get(
            "buyer",
            `/reconciliation/accounts/${account.id}/transactions?status=credit`,
          )
        ).total,
      ).toBe(1);
    });

    it("rejects cross-currency and cross-organization allocations even for internal reviewers", async () => {
      for (const [target, currency] of [
        [accountUsd, "USD"],
        [accountInternal, "INR"],
      ]) {
        await post(
          "admin",
          `/reconciliation/accounts/${target.id}/import`,
          statement([bankRow("SCOPED-" + target.id, 500, 0, currency)]),
          201,
        );
        const transaction = (
          await get(
            "admin",
            `/reconciliation/accounts/${target.id}/transactions`,
          )
        ).items[0];
        await post(
          "finance",
          `/reconciliation/transactions/${transaction.id}/allocations`,
          {
            version: transaction.version,
            note: "Cross-scope allocation must never be accepted.",
            allocations: [{ payment_id: payment1.id, amount: 100 }],
          },
          422,
        );
        if (target.id === accountInternal.id)
          await get(
            "buyer",
            `/reconciliation/transactions/${transaction.id}`,
            404,
          );
      }
    });

    it("retains reversal evidence and serializes competing matches for the same payment balance", async () => {
      const detail = await get(
          "buyer",
          `/reconciliation/transactions/${bankA.id}`,
        ),
        allocation = detail.allocations.find(
          (row: any) => row.payment_id === payment1.id,
        );
      await post(
        "buyer",
        `/reconciliation/allocations/${allocation.id}/reverse`,
        { version: bankA.version, note: "" },
        422,
      );
      const reversed = await post(
        "buyer",
        `/reconciliation/allocations/${allocation.id}/reverse`,
        {
          version: bankA.version,
          note: "Correcting the statement evidence allocation.",
        },
      );
      bankA = reversed.transaction;
      expect(
        reversed.allocations.find((row: any) => row.id === allocation.id)
          .reversed_by,
      ).toBe(clients.buyer.user.id);
      expect(
        (await get("buyer", `/reconciliation/payments/${payment1.id}`))
          .remaining_minor,
      ).toBe(40000);
      await post(
        "buyer",
        `/reconciliation/accounts/${account.id}/import`,
        statement([bankRow("CONCURRENT-RECON", 400)]),
        201,
      );
      const alternate = (
        await get(
          "buyer",
          `/reconciliation/accounts/${account.id}/transactions?q=CONCURRENT-RECON`,
        )
      ).items[0];
      const results = await Promise.all(
        [bankA, alternate].map((transaction) =>
          clients.buyer.agent
            .post(
              `/api/reconciliation/transactions/${transaction.id}/allocations`,
            )
            .set("X-CSRF-Token", clients.buyer.token)
            .send({
              version: transaction.version,
              note: "Concurrent match cannot allocate this payment twice.",
              allocations: [{ payment_id: payment1.id, amount: 400 }],
            }),
        ),
      );
      expect(results.map((response: any) => response.status).sort()).toEqual([
        200, 422,
      ]);
      expect(
        (await get("buyer", `/reconciliation/payments/${payment1.id}`))
          .matched_minor,
      ).toBe(50000);
      expect(
        (await get("buyer", `/records/invoices/${invoice.id}`)).status,
      ).toBe("paid");
      const audit = await h
        .db("audit_logs")
        .where({ module: "reconciliation", action: "bank_match_reversed" })
        .first();
      expect(audit.user_id).toBe(clients.buyer.user.id);
      expect(JSON.parse(audit.remarks).allocation_id).toBe(allocation.id);
    });

    it("builds Partner 360 from authorized relationships without leaking other clients or private KYC", async () => {
      const foreignOrder = await makeOrder("admin", "vendor", 2);
      const view = await get("buyer", `/organizations/${org("vendor")}/360`);
      expect(view.compliance.private).toBe(true);
      expect(view.organization.details.pan).toBeUndefined();
      expect(view.activity.some((row: any) => row.id === foreignOrder.id)).toBe(
        false,
      );
      expect(view.module_counts.orders).toBeGreaterThan(0);
      expect(
        view.finances.find((row: any) => row.currency === "INR").order_minor,
      ).toBeGreaterThanOrEqual(order.amount_minor);
      const records = await get(
        "buyer",
        `/records/orders?organization_id=${org("vendor")}&limit=100`,
      );
      expect(records.items.some((row: any) => row.id === foreignOrder.id)).toBe(
        false,
      );
      expect(records.items.some((row: any) => row.id === order.id)).toBe(true);
      const own = await get("vendor", `/organizations/${org("vendor")}/360`);
      expect(own.compliance.private).toBe(false);
      const restricted = await get(
        "verification",
        `/organizations/${org("vendor")}/360`,
      );
      expect(restricted.finances).toEqual([]);
      expect(restricted.module_counts.payments).toBeUndefined();
      expect(restricted.compliance.private).toBe(false);
      await get("supplier", `/organizations/${org("vendor")}/360`, 404);
    });
  });
}
