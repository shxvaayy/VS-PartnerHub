import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, now, nextNumber, commercialKeys, type Database } from "./db.js";
import { config, INTERNAL_ORG_ID } from "./config.js";
import { hashPassword } from "./security.js";
import { demoAccounts, demoPassword } from "../shared/demo.js";
import { calculate } from "./money.js";
import { audit, notifyOrganizations } from "./events.js";
import {
  moduleDefinitions,
  type Module,
  type LineItem,
} from "../shared/domain.js";

export function demoId(key: string) {
  const hex = createHash("sha256").update(`vs-partnerhub:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export const day = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const when = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString();
export async function ensureInternalOrganization() {
  if (!(await db("organizations").where({ id: INTERNAL_ORG_ID }).first()))
    await db("organizations").insert({
      id: INTERNAL_ORG_ID,
      number: "VS-INTERNAL",
      type: "client",
      legal_name: "Vijay Software Solutions Pvt. Ltd.",
      trade_name: "VS Solutions",
      industry: "Information Technology",
      city: "Hyderabad",
      country: "India",
      website: "",
      status: "active",
      contact_name: "VS Team",
      contact_email: config.production
        ? process.env.ADMIN_EMAIL || "admin@example.com"
        : "admin@vs.example",
      contact_phone: "+91 4000000000",
      details: JSON.stringify({
        description: "The VS PartnerHub platform organization.",
      }),
      created_at: now(),
      updated_at: now(),
    });
}
export function samplePdf(company: string, title: string) {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9 .,/-]/g, "");
  const stream = `BT /F1 22 Tf 55 760 Td (VS PartnerHub) Tj 0 -40 Td /F1 14 Tf (${safe(title)}) Tj 0 -30 Td (${safe(company)}) Tj 0 -45 Td /F1 10 Tf (SAMPLE DOCUMENT - FOR LOCAL DEMONSTRATION ONLY) Tj 0 -20 Td (This fictional document has no legal or commercial validity.) Tj ET`;
  const parts = [
    "%PDF-1.4\n",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj\n`,
  ];
  let length = parts[0].length;
  const offsets = [0];
  for (let i = 1; i < parts.length; i++) {
    offsets.push(length);
    length += Buffer.byteLength(parts[i]);
  }
  return Buffer.from(
    `${parts.join("")}xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
  );
}
export async function seed() {
  if (config.production)
    throw new Error("Demo data cannot be seeded in production.");
  if (await db("settings").where({ key: "demo_seeded" }).first()) return;
  await ensureInternalOrganization();
  await mkdir(config.uploadDir, { recursive: true });
  const hash = await hashPassword(demoPassword);
  const orgs: [string, string, string, string, string, string][] = [
    [
      "buyer",
      "Acme Industries Pvt. Ltd.",
      "client",
      "Manufacturing",
      "Mumbai",
      "active",
    ],
    [
      "vendor",
      "Nexora Technologies",
      "vendor",
      "Information Technology",
      "Bengaluru",
      "active",
    ],
    [
      "supplier",
      "Meridian Office Supplies",
      "supplier",
      "Office & Infrastructure",
      "Hyderabad",
      "active",
    ],
    [
      "recruiter",
      "TalentBridge Partners",
      "recruitment",
      "Human Resources",
      "Pune",
      "active",
    ],
    [
      "staffing",
      "Flexforce Solutions",
      "staffing",
      "Human Resources",
      "Hyderabad",
      "active",
    ],
    [
      "service",
      "Aster Consulting",
      "service_provider",
      "Professional Services",
      "Gurugram",
      "active",
    ],
    [
      "technology",
      "CloudCraft Systems",
      "technology_partner",
      "Information Technology",
      "Bengaluru",
      "active",
    ],
    [
      "business",
      "BridgeWorks Advisory",
      "business_partner",
      "Professional Services",
      "Chennai",
      "active",
    ],
    [
      "other",
      "Horizon Ventures",
      "other",
      "Professional Services",
      "New Delhi",
      "active",
    ],
    [
      "v2",
      "Atlas Digital Solutions",
      "vendor",
      "Information Technology",
      "Pune",
      "active",
    ],
    [
      "s2",
      "Oakwood Furnishings",
      "supplier",
      "Office & Infrastructure",
      "Mumbai",
      "active",
    ],
    [
      "r2",
      "PeopleFirst Consulting",
      "recruitment",
      "Human Resources",
      "Bengaluru",
      "under_review",
    ],
    [
      "p1",
      "Vertex Automation",
      "vendor",
      "Manufacturing",
      "Ahmedabad",
      "under_review",
    ],
    [
      "p2",
      "Greenline Logistics",
      "service_provider",
      "Logistics & Supply Chain",
      "Chennai",
      "under_review",
    ],
    [
      "p3",
      "Stratum Infotech",
      "technology_partner",
      "Information Technology",
      "Hyderabad",
      "clarification",
    ],
    [
      "p4",
      "BluePeak Enterprises",
      "supplier",
      "Manufacturing",
      "Jaipur",
      "under_review",
    ],
    [
      "p5",
      "BrightPath Learning",
      "service_provider",
      "Professional Services",
      "Pune",
      "active",
    ],
    [
      "p6",
      "Summit Infrastructure",
      "vendor",
      "Office & Infrastructure",
      "New Delhi",
      "suspended",
    ],
    ["p7", "Northstar Health", "client", "Healthcare", "Bengaluru", "active"],
    [
      "p8",
      "Prism Creative Studio",
      "service_provider",
      "Marketing & Creative",
      "Mumbai",
      "active",
    ],
    [
      "p9",
      "SecureGrid Networks",
      "technology_partner",
      "Information Technology",
      "Hyderabad",
      "active",
    ],
    [
      "p10",
      "Orbit Industrial Supply",
      "supplier",
      "Manufacturing",
      "Pune",
      "active",
    ],
    [
      "p11",
      "Elevate Staffing",
      "staffing",
      "Human Resources",
      "Noida",
      "active",
    ],
    [
      "p12",
      "Cedar Business Services",
      "business_partner",
      "Professional Services",
      "Kochi",
      "active",
    ],
  ];
  const org = (key: string) =>
    key === "vs" ? INTERNAL_ORG_ID : demoId(`org:${key}`);
  const user = (key: string) => demoId(`user:${key}`);
  await db.transaction(async (k) => {
    for (let i = 0; i < orgs.length; i++) {
      const [key, name, type, industry, city, status] = orgs[i];
      const account = demoAccounts.find((a) => a.key === key);
      const details: Record<string, any> = {
        company_type: "Private Limited",
        contact_role: "Authorized Representative",
        description: `${name} brings reliable ${industry.toLowerCase()} expertise to growing businesses. Built on transparent communication, quality delivery and long-term relationships.`,
        capabilities:
          industry === "Information Technology"
            ? "Enterprise software development, cloud infrastructure, data engineering and managed services."
            : `End-to-end ${industry.toLowerCase()} solutions, dedicated account management and nationwide delivery.`,
        locations: `${city}, Bengaluru, Hyderabad, Mumbai`,
        certifications: i % 3 === 0 ? "ISO 9001, ISO 27001" : "ISO 9001",
        address: `${10 + i}, Business Park, ${city}`,
        pan: "ABCDE1234F",
        gst: "29ABCDE1234F1Z5",
        cin: `U72200KA2020PTC${String(120000 + i)}`,
        experience: 8 + (i % 9),
        products: "Enterprise solutions and business essentials",
        services: "Consulting, implementation, support",
        naics: "541512",
        sic: "7372",
        logo_color: ["#e8ecfe", "#eaf3d4", "#fcead8", "#f6e9ef"][i % 4],
      };
      if (["recruitment", "staffing"].includes(type))
        Object.assign(details, {
          domains: "Technology, Finance, Healthcare, Leadership",
          hiring_types: [
            "Permanent Hiring",
            "Contract Staffing",
            "Executive Hiring",
          ],
          recruiters: "Dedicated team of 12 recruiters",
        });
      if (type === "supplier")
        Object.assign(details, {
          moq: 10,
          lead_time: "7–14 business days",
          delivery_locations: "Pan India",
          warehouse: `${city} distribution center`,
        });
      if (type === "technology_partner")
        Object.assign(details, {
          technologies: "Cloud, AI / ML, Cybersecurity, SaaS",
          integrations: "REST APIs, SSO, Microsoft 365",
          documentation_url: "https://example.com",
        });
      if (status === "clarification")
        details.verification_note =
          "Please upload a current GST certificate with the registered business address.";
      await k("organizations").insert({
        id: org(key),
        number: await nextNumber(k, "ORG"),
        type,
        legal_name: name,
        trade_name: name.split(" ")[0],
        industry,
        city,
        country: "India",
        website: "https://example.com",
        status,
        contact_name: account?.name || `${name.split(" ")[0]} Team`,
        contact_email: account?.email || `${key}@partners.example`,
        contact_phone: "+91 90000 00000",
        details: JSON.stringify(details),
        created_at: when(
          ["under_review", "clarification"].includes(status)
            ? -i % 5
            : -170 + i * 6,
        ),
        updated_at: when(-i % 4),
      });
    }
    for (const account of demoAccounts)
      await k("users").insert({
        id: user(account.key),
        organization_id: "type" in account ? org(account.key) : null,
        name: account.name,
        email: account.email,
        password_hash: hash,
        role: account.role,
        email_verified: true,
        active: true,
        created_at: when(-180),
        updated_at: now(),
      });
    for (const [key, name, type, , , status] of orgs) {
      if (!demoAccounts.some((a) => a.key === key))
        await k("users").insert({
          id: user(key),
          organization_id: org(key),
          name: `${name.split(" ")[0]} Admin`,
          email: `${key}@partners.example`,
          password_hash: hash,
          role: "org_admin",
          email_verified: true,
          active: true,
          created_at: when(-60),
          updated_at: now(),
        });
      for (const category of [
        "PAN",
        "Incorporation",
        ...(type === "supplier" || type === "vendor" ? ["Certification"] : []),
      ]) {
        const id = demoId(`doc:${key}:${category}`),
          data = samplePdf(name, category),
          storageKey = `${id}.pdf`;
        await writeFile(path.join(config.uploadDir, storageKey), data, {
          mode: 0o600,
        });
        await k("documents").insert({
          id,
          organization_id: org(key),
          category,
          name: `${name.split(" ")[0]}-${category.toLowerCase()}.pdf`,
          storage_key: storageKey,
          mime_type: "application/pdf",
          size: data.length,
          status: status === "active" ? "approved" : "uploaded",
          expires_at:
            category === "Certification"
              ? day(key === "vendor" ? 24 : 75)
              : null,
          version: 1,
          uploaded_by: user(key),
          reviewed_by: status === "active" ? user("verification") : null,
          review_note:
            status === "active" ? "Sample document verified for demo." : "",
          created_at: when(-15),
          updated_at: when(-5),
        });
      }
    }
    const item = (
      name: string,
      quantity: number,
      price: number,
      unit = "units",
    ): LineItem => ({
      name,
      specification: "As per agreed technical and quality specifications.",
      quantity,
      unit,
      unit_price: price,
      tax: 18,
      discount: 0,
    });
    const make = async (
      key: string,
      kind: Module,
      title: string,
      status: string,
      buyer: string | null,
      partner: string | null,
      payload: Record<string, any>,
      options: {
        parent?: string;
        owner?: string;
        actor?: string;
        items?: LineItem[];
        invitations?: string[];
        offset?: number;
        amount?: number;
      } = {},
    ) => {
      const id = demoId(`record:${key}`),
        items = options.items || [],
        actorKey =
          options.actor ||
          (partner &&
          ![
            "orders",
            "requirements",
            "rfqs",
            "payments",
            "interviews",
            "demos",
            "performance",
          ].includes(kind)
            ? partner
            : buyer === "buyer"
              ? "buyer"
              : "admin");
      const owner =
        options.owner ||
        ([
          "quotations",
          "catalog",
          "invoices",
          "deliveries",
          "candidates",
          "timesheets",
          "milestones",
        ].includes(kind)
          ? partner
          : buyer) ||
        "vs";
      const data = {
        id,
        kind,
        number: await nextNumber(k, moduleDefinitions[kind].prefix),
        title,
        status,
        owner_org_id: org(owner),
        buyer_org_id: buyer ? org(buyer) : null,
        partner_org_id: partner ? org(partner) : null,
        parent_id: options.parent ? demoId(`record:${options.parent}`) : null,
        amount_minor:
          options.amount ??
          calculate(items, payload.delivery_charges || 0).total,
        currency: "INR",
        payload: JSON.stringify({
          description: "",
          category: "Information Technology",
          location: "Hyderabad",
          remarks: "",
          ...payload,
        }),
        version: 1,
        created_by: user(actorKey),
        created_at: when(options.offset ?? -5),
        updated_at: when(options.offset ? Math.max(options.offset, -3) : -1),
      };
      await k("records").insert({
        ...data,
        ...commercialKeys(
          kind,
          data.owner_org_id,
          data.partner_org_id,
          data.buyer_org_id,
          data.parent_id,
          payload,
        ),
      });
      if (items.length)
        await k("line_items").insert(
          items.map((v, position) => ({
            id: randomUUID(),
            record_id: id,
            name: v.name,
            specification: v.specification,
            quantity: v.quantity,
            unit: v.unit,
            unit_price_minor: Math.round(v.unit_price * 100),
            tax_bps: v.tax * 100,
            discount_bps: v.discount * 100,
            position,
          })),
        );
      if (options.invitations?.length)
        await k("record_invitations").insert(
          options.invitations.map((key) => ({
            record_id: id,
            organization_id: org(key),
          })),
        );
      const actor = demoAccounts.find((a) => a.key === actorKey);
      await audit(
        k,
        {
          id: user(actorKey),
          name: actor?.name || "Partner Admin",
          role: actor?.role || "org_admin",
          organization_id: owner === "vs" ? null : org(owner),
        },
        "created",
        kind,
        data,
        status,
        "Demo workspace record",
      );
      return id;
    };
    const orderSpecs = [
      {
        key: "workstations",
        title: "Engineering workstations · Q4 expansion",
        partner: "vendor",
        buyer: "buyer",
        items: [
          item("Developer workstation", 12, 72000),
          item("27-inch IPS monitor", 12, 18500),
        ],
        status: "acknowledged",
        rfq: "awarded",
      },
      {
        key: "chairs",
        title: "Ergonomic chairs for Hyderabad office",
        partner: "supplier",
        buyer: "buyer",
        items: [item("Ergonomic task chair", 40, 7800)],
        status: "fulfilled",
        rfq: "awarded",
      },
      {
        key: "cloud",
        title: "Cloud infrastructure & migration",
        partner: "technology",
        buyer: "vs",
        items: [item("Cloud migration package", 1, 280000, "project")],
        status: "sent",
        rfq: "awarded",
      },
      {
        key: "consulting",
        title: "Process improvement consulting",
        partner: "service",
        buyer: "buyer",
        items: [item("Consulting engagement", 1, 185000, "project")],
        status: "fulfilled",
        rfq: "awarded",
      },
      {
        key: "network",
        title: "Network security upgrade",
        partner: "vendor",
        buyer: "vs",
        items: [item("Firewall appliance with setup", 2, 95000)],
        status: "fulfilled",
        rfq: "awarded",
      },
      {
        key: "supplies",
        title: "Monthly office essentials",
        partner: "supplier",
        buyer: "vs",
        items: [item("Office essentials pack", 20, 1850, "packs")],
        status: "pending_approval",
        rfq: "awarded",
      },
    ];
    for (let i = 0; i < orderSpecs.length; i++) {
      const s = orderSpecs[i],
        base = {
          category:
            s.partner === "supplier"
              ? "Office & Infrastructure"
              : "Information Technology",
          description: `Procurement for ${s.title.toLowerCase()}. Include delivery, warranty and implementation where applicable.`,
          location: "Hyderabad",
        };
      await make(
        `req:${s.key}`,
        "requirements",
        s.title,
        "open",
        s.buyer,
        null,
        {
          ...base,
          requirement_type: "procurement",
          required_date: day(20),
          deadline: day(-5),
          budget: 1500000,
          quantity: 1,
          skills: "",
          experience: "",
          positions: 1,
          employment_type: "Permanent",
          criteria: "ISO certified, verified partners",
        },
        { items: s.items, offset: -160 + i * 25 },
      );
      await make(
        `rfq:${s.key}`,
        "rfqs",
        s.title,
        s.rfq,
        s.buyer,
        null,
        {
          ...base,
          deadline: day(-5),
          required_date: day(20),
          delivery_address: "VS Business Park, HITEC City, Hyderabad",
          payment_terms: "Net 30",
          terms: "Delivery to the specified location. GST invoice required.",
          eligibility: "Verified partners only",
        },
        {
          parent: `req:${s.key}`,
          items: s.items,
          invitations: [s.partner],
          offset: -150 + i * 25,
        },
      );
      await make(
        `quote:${s.key}`,
        "quotations",
        `${s.title} — commercial proposal`,
        "approved",
        s.buyer,
        s.partner,
        {
          ...base,
          delivery_date: day(15),
          validity: day(30),
          payment_terms: "Net 30",
          warranty: "12 months",
          delivery_charges: 0,
          terms: "Prices inclusive of installation.",
        },
        { parent: `rfq:${s.key}`, items: s.items, offset: -148 + i * 25 },
      );
      await make(
        `po:${s.key}`,
        "orders",
        s.title,
        s.status,
        s.buyer,
        s.partner,
        {
          ...base,
          delivery_date: day(s.status === "fulfilled" ? -5 : 15),
          delivery_address: "VS Business Park, HITEC City, Hyderabad",
          payment_terms: "Net 30",
          terms: "As per approved quotation.",
          delivery_charges: 0,
        },
        { parent: `quote:${s.key}`, items: s.items, offset: -140 + i * 25 },
      );
      if (["acknowledged", "fulfilled"].includes(s.status))
        await make(
          `delivery:${s.key}`,
          "deliveries",
          `Delivery · ${s.title}`,
          s.status === "fulfilled" ? "confirmed" : "in_transit",
          s.buyer,
          s.partner,
          {
            ...base,
            carrier: "BlueDart Business",
            tracking_number: `BD${2026000 + i}`,
            expected_date: day(s.status === "fulfilled" ? -6 : 5),
            dispatched_date: day(-8),
            received_by: s.status === "fulfilled" ? "Facilities Team" : "",
            proof_of_delivery:
              s.status === "fulfilled" ? "Received in good condition" : "",
          },
          { parent: `po:${s.key}`, offset: -10 + i },
        );
      if (s.status === "fulfilled") {
        const total = calculate(s.items).total;
        await make(
          `invoice:${s.key}`,
          "invoices",
          s.title,
          s.key === "network" ? "paid" : "approved",
          s.buyer,
          s.partner,
          {
            ...base,
            invoice_number: `SUP-2026-${1041 + i}`,
            invoice_date: day(-8),
            due_date: day(22),
            payment_terms: "Net 30",
            bank_name: "Sample Business Bank",
            bank_account_last4: "4821",
            bank_ifsc: "DEMO0000001",
            delivery_charges: 0,
          },
          { parent: `po:${s.key}`, items: s.items, offset: -8 },
        );
        if (s.key === "network" || s.key === "chairs")
          await make(
            `payment:${s.key}`,
            "payments",
            `Payment · ${s.title}`,
            "completed",
            s.buyer,
            s.partner,
            {
              amount: (s.key === "network" ? total : total / 2) / 100,
              reference: `REF-${8041 + i}`,
              transaction_id: `DEMO-TXN-${3041 + i}`,
              payment_date: day(-3),
              method: "Bank transfer",
            },
            {
              parent: `invoice:${s.key}`,
              amount: s.key === "network" ? total : total / 2,
              offset: -3,
            },
          );
      }
    }
    const openSpecs = [
      {
        key: "laptops",
        title: "Business laptops for the product team",
        buyer: "buyer",
        partners: ["vendor", "v2", "technology"],
        items: [
          item("Business laptop · 16GB / 512GB", 15, 0),
          item("USB-C docking station", 15, 0),
        ],
        price: [68500, 72000, 69900],
      },
      {
        key: "furniture",
        title: "Workspace furniture · Bengaluru",
        buyer: "buyer",
        partners: ["supplier", "s2"],
        items: [
          item("Sit-stand desk", 20, 0),
          item("Ergonomic office chair", 20, 0),
        ],
        price: [14500, 15200],
      },
      {
        key: "security",
        title: "Managed cybersecurity services",
        buyer: "vs",
        partners: ["vendor", "technology"],
        items: [item("Managed security operations", 12, 0, "months")],
        price: [42000, 45000],
      },
    ];
    for (const s of openSpecs) {
      await make(
        `open:${s.key}`,
        "rfqs",
        s.title,
        "published",
        s.buyer,
        null,
        {
          description:
            "We are looking for a verified partner with reliable delivery and dedicated support.",
          category:
            s.key === "furniture"
              ? "Office & Infrastructure"
              : "Information Technology",
          deadline: day(9),
          required_date: day(28),
          delivery_address: "Acme Innovation Campus, Bengaluru",
          payment_terms: "Net 30",
          terms:
            "Quote all line items. Attach relevant product specifications.",
          eligibility: "Active, verified partner",
        },
        { items: s.items, invitations: s.partners, offset: -4 },
      );
      for (let i = 0; i < s.partners.length; i++)
        await make(
          `openquote:${s.key}:${i}`,
          "quotations",
          `${s.title} — ${orgs.find((o) => o[0] === s.partners[i])?.[1]}`,
          "submitted",
          s.buyer,
          s.partners[i],
          {
            description:
              "Complete commercial response with delivery and support.",
            category: "Information Technology",
            delivery_date: day(18 + i * 2),
            validity: day(30),
            payment_terms: i === 1 ? "50% advance, 50% on delivery" : "Net 30",
            warranty: i === 2 ? "36 months onsite" : "12 months onsite",
            delivery_charges: i === 0 ? 0 : 1500,
            terms: "Standard support included.",
          },
          {
            parent: `open:${s.key}`,
            items: s.items.map((it, j) => ({
              ...it,
              unit_price:
                j === 1 ? (s.key === "furniture" ? 6500 : 6500) : s.price[i],
            })),
            offset: -2 + i * 0.2,
          },
        );
    }
    for (const [key, title, type, price] of [
      ["supplier", "ErgoPro mesh task chair", "Product", 7800],
      ["supplier", "Premium office essentials pack", "Product", 1850],
      ["vendor", "Enterprise software development", "Service", 8500],
      ["technology", "CloudCraft One · Cloud management", "Technology", 14999],
      ["technology", "SecureEdge · Threat monitoring", "Technology", 24999],
      ["service", "Business process consulting", "Service", 185000],
    ] as const)
      await make(
        `catalog:${title}`,
        "catalog",
        title,
        "active",
        null,
        key,
        {
          description:
            "Built for growing teams that value reliability, thoughtful design and great support.",
          category:
            type === "Product"
              ? "Office & Infrastructure"
              : "Information Technology",
          item_type: type,
          sku: `SKU-${title.slice(0, 3).toUpperCase()}-${Math.round(price)}`,
          specifications: "Enterprise grade. Dedicated support included.",
          unit: type === "Product" ? "units" : "month",
          price,
          tax: 18,
          moq: 1,
          lead_time: "7 business days",
          availability: 120,
          warranty: "12 months",
          delivery_locations: "Pan India",
          technologies:
            type === "Technology" ? "AWS, Azure, REST API, SSO" : "",
          integrations:
            type === "Technology" ? "Microsoft 365, Slack, REST API" : "",
          documentation_url: "https://example.com",
          demo_url: "",
          certifications: "ISO 9001",
        },
        { amount: price * 100, offset: -20 },
      );
    for (const [key, partner, title, amount] of [
      ["staffing", "staffing", "Technology staffing · FY 2026–27", 480000],
      ["recruitment", "recruiter", "Permanent hiring partnership", 250000],
      ["services", "service", "Strategy & operations engagement", 185000],
      ["technology", "technology", "CloudCraft annual subscription", 179988],
    ] as const)
      await make(
        `contract:${key}`,
        "contracts",
        title,
        "active",
        "buyer",
        partner,
        {
          description:
            "A framework for a transparent and productive partnership.",
          contract_type:
            key === "recruitment"
              ? "Recruitment agreement"
              : "Master service agreement",
          start_date: day(-120),
          end_date: day(key === "services" ? 22 : 245),
          renewal_notice_days: 30,
          auto_renew: false,
          payment_terms: "Net 30",
          terms:
            "Confidentiality, service levels, data protection and commercial terms apply.",
          delivery_charges: 0,
          amendment: "",
        },
        { items: [item(title, 1, amount, "engagement")], offset: -120 },
      );
    await make(
      "hiring:fullstack",
      "requirements",
      "Senior Full Stack Engineer",
      "open",
      "buyer",
      null,
      {
        description:
          "Help build thoughtful enterprise products with React, Node.js and PostgreSQL.",
        category: "Human Resources",
        location: "Bengaluru · Hybrid",
        requirement_type: "hiring",
        required_date: day(35),
        deadline: day(20),
        budget: 2800000,
        quantity: 3,
        skills: "React, TypeScript, Node.js, PostgreSQL",
        experience: "5–8 years",
        positions: 3,
        employment_type: "Permanent",
        criteria: "Strong product engineering background",
      },
      { invitations: ["recruiter", "staffing"], offset: -14 },
    );
    await make(
      "hiring:analyst",
      "requirements",
      "Business Analyst · Enterprise Solutions",
      "open",
      "vs",
      null,
      {
        description:
          "Translate customer needs into clear product and delivery requirements.",
        category: "Human Resources",
        location: "Hyderabad",
        requirement_type: "hiring",
        required_date: day(40),
        deadline: day(20),
        budget: 1800000,
        quantity: 2,
        skills: "Business analysis, SQL, stakeholder management",
        experience: "3–5 years",
        positions: 2,
        employment_type: "Contract",
        criteria: "Enterprise delivery experience",
      },
      { invitations: ["recruiter", "staffing"], offset: -10 },
    );
    const candidateNames = [
      "Aarav Sharma",
      "Meera Krishnan",
      "Ishaan Gupta",
      "Sara Thomas",
      "Vihaan Reddy",
      "Aditi Joshi",
      "Rohan Verma",
      "Kavya Nair",
    ];
    const stages = [
      "submitted",
      "screening",
      "shortlisted",
      "interview",
      "selected",
      "offer",
      "bgv",
      "joined",
    ];
    for (let i = 0; i < candidateNames.length; i++) {
      const id = await make(
        `candidate:${i}`,
        "candidates",
        candidateNames[i],
        stages[i],
        "buyer",
        "recruiter",
        {
          description: "",
          category: "Human Resources",
          location: i % 2 ? "Hyderabad" : "Bengaluru",
          email: `candidate${i + 1}@talent.example`,
          phone: "+91 90000 00000",
          skills: "React, TypeScript, Node.js, PostgreSQL",
          experience: 5 + (i % 4),
          notice_period: "30 days",
          current_compensation: 1800000,
          expected_compensation: 2400000,
          availability: day(30),
          recruiter_notes:
            "Strong communication and relevant enterprise experience.",
          consent: true,
          consent_recorded_at: when(-7),
          retention_until: when(365),
          bgv_status: i >= 6 ? "Clear" : "Not started",
          ...(i >= 5
            ? { offer_date: day(-3), offer_compensation: 2400000 }
            : {}),
          ...(i === 7 ? { joining_date: day(-1) } : {}),
        },
        { parent: "hiring:fullstack", offset: -9 + i },
      );
      const resumeId = demoId(`resume:${i}`),
        data = samplePdf(candidateNames[i], "Sample resume");
      await writeFile(path.join(config.uploadDir, `${resumeId}.pdf`), data, {
        mode: 0o600,
      });
      await k("documents").insert({
        id: resumeId,
        organization_id: org("recruiter"),
        record_id: id,
        category: "Resume",
        name: `${candidateNames[i].replaceAll(" ", "-")}-resume.pdf`,
        storage_key: `${resumeId}.pdf`,
        mime_type: "application/pdf",
        size: data.length,
        status: "uploaded",
        version: 1,
        uploaded_by: user("recruiter"),
        created_at: when(-7),
        updated_at: when(-7),
      });
      if (i >= 3)
        await make(
          `interview:${i}`,
          "interviews",
          `Technical discussion · ${candidateNames[i]}`,
          i === 3 ? "scheduled" : "completed",
          "buyer",
          "recruiter",
          {
            description: "Engineering depth, architecture and collaboration.",
            category: "Human Resources",
            location: "Video meeting",
            scheduled_at: when(i === 3 ? 1 : -3),
            duration: 60,
            interviewer: "Ananya Rao",
            meeting_link: "https://example.com",
            feedback:
              i === 3
                ? ""
                : "Strong problem solving and clear communication. Recommended for the next stage.",
            recommendation: i === 3 ? "Pending" : "Proceed",
          },
          { parent: `candidate:${i}`, actor: "hr", offset: -3 },
        );
    }
    await make(
      "engagement:1",
      "engagements",
      "Frontend engineering · Acme Digital",
      "active",
      "buyer",
      "staffing",
      {
        resource_name: "Ankit Sinha",
        designation: "Frontend Engineer",
        start_date: day(-25),
        end_date: day(155),
        rate: 160000,
        rate_unit: "month",
        manager: "Priya Sharma",
        description: "Product engineering support for the Acme digital team.",
      },
      { parent: "contract:staffing", offset: -25 },
    );
    await make(
      "timesheet:1",
      "timesheets",
      "Ankit Sinha · weekly timesheet",
      "submitted",
      "buyer",
      "staffing",
      {
        period_start: day(-7),
        period_end: day(-1),
        hours: 40,
        work_summary:
          "Delivered dashboard components, integration fixes and accessibility improvements.",
      },
      { parent: "engagement:1", offset: -1 },
    );
    await make(
      "milestone:1",
      "milestones",
      "Discovery & process mapping",
      "in_progress",
      "buyer",
      "service",
      {
        due_date: day(8),
        deliverable:
          "Current-state process maps, findings and opportunity assessment.",
        amount: 45000,
        completion_notes: "",
        description: "Stakeholder interviews and process review.",
      },
      { parent: "contract:services", offset: -6 },
    );
    await make(
      "demo:1",
      "demos",
      "CloudCraft One · product walkthrough",
      "requested",
      "buyer",
      "technology",
      {
        contact_name: "Priya Sharma",
        contact_email: "buyer@acme.example",
        preferred_date: day(4),
        scheduled_at: "",
        meeting_link: "",
        use_case:
          "Consolidate visibility across our AWS and Azure environments.",
        description:
          "30-minute product demonstration for the infrastructure team.",
      },
      { parent: "catalog:CloudCraft One · Cloud management", offset: -1 },
    );
    await make(
      "performance:1",
      "performance",
      "Meridian · office furniture delivery",
      "published",
      "buyer",
      "supplier",
      {
        quality: 5,
        delivery: 4,
        communication: 5,
        value: 4,
        feedback:
          "Good quality and clear communication throughout the delivery. One item arrived a day later than planned.",
        review_date: day(-2),
      },
      { parent: "po:chairs", offset: -2 },
    );
    await make(
      "ticket:1",
      "tickets",
      "Help updating our registered address",
      "in_progress",
      null,
      null,
      {
        category: "Verification",
        priority: "normal",
        description:
          "Our company has moved to a new office. Please help us update the registered address and identify the documents needed.",
        assigned_team: "Verification",
        resolution: "",
      },
      { owner: "vendor", actor: "vendor", offset: -2 },
    );
    await make(
      "ticket:2",
      "tickets",
      "Clarification on invoice approval",
      "open",
      null,
      null,
      {
        category: "Finance",
        priority: "high",
        description:
          "Please confirm whether any additional supporting documents are needed for our latest invoice.",
        assigned_team: "Finance",
        resolution: "",
      },
      { owner: "supplier", actor: "supplier", offset: -1 },
    );
    await k("comments").insert({
      id: randomUUID(),
      record_id: demoId("record:ticket:1"),
      user_id: user("support"),
      body: "Thanks for reaching out. Update the address under Company Profile and upload a current registration document. Our verification team will review it.",
      created_at: when(-1),
    });
    for (const account of demoAccounts) {
      await k("notifications").insert({
        id: randomUUID(),
        user_id: user(account.key),
        title: "Welcome to your connected workspace",
        body: "Your partner network, business activity and next steps are together in one place.",
        href: "/app",
        category: "registration",
        read_at: when(-2),
        created_at: when(-3),
      });
      await k("notifications").insert({
        id: randomUUID(),
        user_id: user(account.key),
        title: "Your workspace is ready",
        body: "Review your dashboard to see what needs attention today.",
        href: "/app",
        category: "activity",
        created_at: when(-0.1),
      });
    }
    await notifyOrganizations(
      k,
      [org("vendor")],
      "New RFQ invitation",
      "Acme Industries invited you to quote for business laptops.",
      `/app/rfqs/${demoId("record:open:laptops")}`,
      "rfqs",
    );
    await k("settings").insert({
      key: "demo_seeded",
      value: "true",
      updated_at: now(),
    });
  });
}
