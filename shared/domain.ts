export const organizationTypes = [
  "vendor",
  "supplier",
  "client",
  "recruitment",
  "staffing",
  "service_provider",
  "technology_partner",
  "business_partner",
  "other",
] as const;
export type OrganizationType = (typeof organizationTypes)[number];
export const organizationLabels: Record<OrganizationType, string> = {
  vendor: "Vendor",
  supplier: "Supplier",
  client: "Client / Buyer",
  recruitment: "Recruitment Company",
  staffing: "Staffing Company",
  service_provider: "Service Provider",
  technology_partner: "Technology Partner",
  business_partner: "Business Partner",
  other: "Other",
};
export const organizationDescriptions: Record<OrganizationType, string> = {
  vendor: "Showcase capabilities. Respond to opportunities.",
  supplier: "Connect your catalog to new demand.",
  client: "Discover partners. Source with confidence.",
  recruitment: "Connect exceptional people to opportunities.",
  staffing: "Manage talent, engagements and deployments.",
  service_provider: "Turn your expertise into lasting partnerships.",
  technology_partner: "Bring your products and integrations to market.",
  business_partner: "Build a stronger business ecosystem.",
  other: "Find the right space for your organization.",
};
export const modules = [
  "requirements",
  "rfqs",
  "quotations",
  "orders",
  "deliveries",
  "contracts",
  "invoices",
  "payments",
  "catalog",
  "candidates",
  "interviews",
  "engagements",
  "timesheets",
  "milestones",
  "demos",
  "performance",
  "tickets",
] as const;
export type Module = (typeof modules)[number];
export type Action = "view" | "create" | "edit" | "review" | "manage";
export type Permissions = Record<string, Action[]>;
export interface ModuleDefinition {
  label: string;
  singular: string;
  prefix: string;
  description: string;
  statuses: string[];
  group: "procurement" | "finance" | "recruitment" | "workspace" | "support";
}
export const moduleDefinitions: Record<Module, ModuleDefinition> = {
  requirements: {
    label: "Requirements",
    singular: "Requirement",
    prefix: "REQ",
    description: "Give every business need a clear starting point.",
    statuses: ["draft", "open", "closed"],
    group: "procurement",
  },
  rfqs: {
    label: "RFQs & RFPs",
    singular: "RFQ",
    prefix: "RFQ",
    description: "The right requirements. The right partners.",
    statuses: ["draft", "published", "evaluation", "awarded", "closed"],
    group: "procurement",
  },
  quotations: {
    label: "Quotations",
    singular: "Quotation",
    prefix: "QUO",
    description: "Clear commercial proposals. Confident decisions.",
    statuses: [
      "draft",
      "submitted",
      "under_review",
      "clarification",
      "approved",
      "rejected",
    ],
    group: "procurement",
  },
  orders: {
    label: "Purchase orders",
    singular: "Purchase order",
    prefix: "PO",
    description: "Keep every commitment moving forward.",
    statuses: [
      "draft",
      "pending_approval",
      "approved",
      "sent",
      "acknowledged",
      "fulfilled",
      "closed",
    ],
    group: "procurement",
  },
  deliveries: {
    label: "Deliveries",
    singular: "Delivery",
    prefix: "DEL",
    description: "Follow your orders from dispatch to receipt.",
    statuses: ["pending", "dispatched", "in_transit", "delivered", "confirmed"],
    group: "procurement",
  },
  contracts: {
    label: "Contracts",
    singular: "Contract",
    prefix: "CTR",
    description: "Every agreement, version and renewal in one place.",
    statuses: [
      "draft",
      "review",
      "approved",
      "active",
      "renewed",
      "expired",
      "terminated",
    ],
    group: "procurement",
  },
  invoices: {
    label: "Invoices",
    singular: "Invoice",
    prefix: "INV",
    description: "From submission to approval, with complete clarity.",
    statuses: [
      "draft",
      "submitted",
      "under_review",
      "approved",
      "paid",
      "rejected",
    ],
    group: "finance",
  },
  payments: {
    label: "Payments",
    singular: "Payment",
    prefix: "PAY",
    description: "Recorded payments, references and outstanding balances.",
    statuses: ["pending", "processing", "completed", "failed"],
    group: "finance",
  },
  catalog: {
    label: "Products & services",
    singular: "Catalog item",
    prefix: "CAT",
    description: "Put your products, services and expertise on display.",
    statuses: ["draft", "active", "unavailable", "archived"],
    group: "workspace",
  },
  candidates: {
    label: "Candidates",
    singular: "Candidate",
    prefix: "CAN",
    description: "A thoughtful journey from introduction to joining.",
    statuses: [
      "submitted",
      "screening",
      "shortlisted",
      "interview",
      "selected",
      "offer",
      "bgv",
      "onboarding",
      "joined",
      "closed",
    ],
    group: "recruitment",
  },
  interviews: {
    label: "Interviews",
    singular: "Interview",
    prefix: "INT",
    description: "Keep interview schedules and feedback connected.",
    statuses: ["scheduled", "completed", "cancelled"],
    group: "recruitment",
  },
  engagements: {
    label: "Staffing engagements",
    singular: "Engagement",
    prefix: "ENG",
    description: "Manage your people, assignments and deployments.",
    statuses: ["planned", "active", "completed", "cancelled"],
    group: "recruitment",
  },
  timesheets: {
    label: "Timesheets",
    singular: "Timesheet",
    prefix: "TS",
    description: "Review and approve time against active engagements.",
    statuses: ["draft", "submitted", "approved", "rejected"],
    group: "recruitment",
  },
  milestones: {
    label: "Service milestones",
    singular: "Milestone",
    prefix: "MIL",
    description: "Turn every scope of work into measurable progress.",
    statuses: ["planned", "in_progress", "submitted", "approved", "revision"],
    group: "workspace",
  },
  demos: {
    label: "Demo requests",
    singular: "Demo request",
    prefix: "DEM",
    description: "Connect buyers with your technology in action.",
    statuses: ["requested", "scheduled", "completed", "cancelled"],
    group: "workspace",
  },
  performance: {
    label: "Partner performance",
    singular: "Performance review",
    prefix: "REV",
    description: "Make each partnership better than the last.",
    statuses: ["draft", "published"],
    group: "workspace",
  },
  tickets: {
    label: "Support",
    singular: "Support ticket",
    prefix: "TKT",
    description: "A little help to keep your business moving.",
    statuses: [
      "open",
      "assigned",
      "in_progress",
      "waiting_for_user",
      "resolved",
      "closed",
    ],
    group: "support",
  },
};
export const transitions: Record<Module, Record<string, string[]>> = {
  requirements: { draft: ["open"], open: ["closed"], closed: ["open"] },
  rfqs: {
    draft: ["published"],
    published: ["evaluation", "closed"],
    evaluation: ["closed"],
    awarded: ["closed"],
  },
  quotations: {
    draft: ["submitted"],
    submitted: ["under_review", "clarification", "approved", "rejected"],
    under_review: ["clarification", "approved", "rejected"],
    clarification: ["submitted"],
    rejected: [],
  },
  orders: {
    draft: ["pending_approval"],
    pending_approval: ["approved", "draft"],
    approved: ["sent"],
    sent: ["acknowledged"],
    acknowledged: ["fulfilled"],
    fulfilled: ["closed"],
  },
  deliveries: {
    pending: ["dispatched"],
    dispatched: ["in_transit", "delivered"],
    in_transit: ["delivered"],
    delivered: ["confirmed"],
  },
  contracts: {
    draft: ["review"],
    review: ["approved", "draft"],
    approved: ["active"],
    active: ["terminated"],
    renewed: ["terminated"],
    expired: [],
    terminated: [],
  },
  invoices: {
    draft: ["submitted"],
    submitted: ["under_review", "approved", "rejected"],
    under_review: ["approved", "rejected"],
    rejected: ["draft"],
  },
  payments: {
    pending: ["processing", "completed", "failed"],
    processing: ["completed", "failed"],
    failed: ["pending"],
  },
  catalog: {
    draft: ["active"],
    active: ["unavailable", "archived"],
    unavailable: ["active", "archived"],
  },
  candidates: {
    submitted: ["screening", "closed"],
    screening: ["shortlisted", "closed"],
    shortlisted: ["interview", "closed"],
    interview: ["selected", "closed"],
    selected: ["offer", "closed"],
    offer: ["bgv", "closed"],
    bgv: ["onboarding", "closed"],
    onboarding: ["joined", "closed"],
  },
  interviews: { scheduled: ["completed", "cancelled"] },
  engagements: {
    planned: ["active", "cancelled"],
    active: ["completed", "cancelled"],
  },
  timesheets: {
    draft: ["submitted"],
    submitted: ["approved", "rejected"],
    rejected: ["draft"],
  },
  milestones: {
    planned: ["in_progress"],
    in_progress: ["submitted"],
    submitted: ["approved", "revision"],
    revision: ["in_progress"],
  },
  demos: {
    requested: ["scheduled", "cancelled"],
    scheduled: ["completed", "cancelled"],
  },
  performance: { draft: ["published"] },
  tickets: {
    open: ["assigned", "in_progress", "resolved"],
    assigned: ["in_progress", "waiting_for_user", "resolved"],
    in_progress: ["waiting_for_user", "resolved"],
    waiting_for_user: ["in_progress", "resolved"],
    resolved: ["closed", "open"],
    closed: ["open"],
  },
};
export const externalModules: Record<OrganizationType, Module[]> = {
  vendor: [
    "rfqs",
    "quotations",
    "orders",
    "deliveries",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "milestones",
    "performance",
    "tickets",
  ],
  supplier: [
    "rfqs",
    "quotations",
    "orders",
    "deliveries",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "performance",
    "tickets",
  ],
  client: [...modules].filter((m) => m !== "catalog"),
  recruitment: [
    "requirements",
    "candidates",
    "interviews",
    "contracts",
    "invoices",
    "payments",
    "performance",
    "tickets",
  ],
  staffing: [
    "requirements",
    "candidates",
    "interviews",
    "engagements",
    "timesheets",
    "contracts",
    "invoices",
    "payments",
    "tickets",
  ],
  service_provider: [
    "rfqs",
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "milestones",
    "performance",
    "tickets",
  ],
  technology_partner: [
    "rfqs",
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "demos",
    "milestones",
    "performance",
    "tickets",
  ],
  business_partner: [
    "rfqs",
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "milestones",
    "tickets",
  ],
  other: [
    "rfqs",
    "quotations",
    "orders",
    "contracts",
    "invoices",
    "payments",
    "catalog",
    "tickets",
  ],
};
export const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  verification: "Verification & Compliance",
  procurement: "Procurement Team",
  finance: "Finance Team",
  hr: "HR & Recruitment",
  management: "Management / CEO",
  support: "Support Team",
  org_admin: "Organization Admin",
  org_procurement: "Procurement",
  org_finance: "Finance",
  org_recruiter: "Recruiter",
  org_member: "Member",
};
const full: Action[] = ["view", "create", "edit", "review", "manage"];
const perm = (names: string[], actions: Action[] = full): Permissions =>
  Object.fromEntries(names.map((n) => [n, [...actions]]));
const base = [
  "dashboard",
  "profile",
  "documents",
  "notifications",
  "tickets",
  "settings",
];
export const defaultPermissions: Record<string, Permissions> = {
  super_admin: perm([
    ...modules,
    ...base,
    "organizations",
    "verification",
    "team",
    "roles",
    "reports",
    "audit",
    "discovery",
  ]),
  verification: {
    ...perm([
      "dashboard",
      "organizations",
      "verification",
      "documents",
      "notifications",
      "tickets",
      "profile",
      "settings",
    ]),
    ...perm(["reports", "audit"], ["view"]),
  },
  procurement: {
    ...perm([
      "dashboard",
      "requirements",
      "rfqs",
      "quotations",
      "orders",
      "deliveries",
      "contracts",
      "discovery",
      "performance",
      "milestones",
      "demos",
      "notifications",
      "tickets",
      "profile",
      "settings",
    ]),
    ...perm(
      ["organizations", "reports", "catalog", "invoices", "payments"],
      ["view"],
    ),
  },
  finance: {
    ...perm([
      "dashboard",
      "invoices",
      "payments",
      "notifications",
      "tickets",
      "profile",
      "settings",
    ]),
    ...perm(
      ["organizations", "orders", "contracts", "reports", "documents"],
      ["view"],
    ),
  },
  hr: {
    ...perm([
      "dashboard",
      "requirements",
      "candidates",
      "interviews",
      "engagements",
      "timesheets",
      "discovery",
      "notifications",
      "tickets",
      "profile",
      "settings",
    ]),
    ...perm(["organizations", "contracts", "reports"], ["view"]),
  },
  management: {
    ...perm(
      [
        ...modules,
        "organizations",
        "reports",
        "audit",
        "dashboard",
        "discovery",
      ],
      ["view"],
    ),
    ...perm(["notifications", "profile", "settings", "tickets"]),
  },
  support: {
    ...perm(["dashboard", "tickets", "notifications", "profile", "settings"]),
    ...perm(["organizations"], ["view"]),
  },
  org_admin: perm([...modules, ...base, "team", "discovery", "reports"]),
  org_procurement: {
    ...perm([
      "requirements",
      "rfqs",
      "quotations",
      "orders",
      "deliveries",
      "contracts",
      "catalog",
      "milestones",
      "demos",
      "performance",
      "discovery",
      "tickets",
    ]),
    ...perm(base, ["view"]),
    ...perm(["notifications"], full),
  },
  org_finance: {
    ...perm(["invoices", "payments", "tickets", "notifications"]),
    ...perm([...base, "orders", "contracts", "reports"], ["view"]),
  },
  org_recruiter: {
    ...perm([
      "requirements",
      "candidates",
      "interviews",
      "engagements",
      "timesheets",
      "tickets",
      "notifications",
    ]),
    ...perm(base, ["view"]),
  },
  org_member: {
    ...perm([...modules, ...base], ["view"]),
    ...perm(["tickets", "notifications"]),
  },
};
for (const [role, permissions] of Object.entries(defaultPermissions)) {
  permissions.ai = ["view", "create"];
  permissions.contacts = ["super_admin", "org_admin", "verification"].includes(
    role,
  )
    ? [...full]
    : ["view"];
  if (["super_admin", "hr", "procurement", "org_admin"].includes(role))
    permissions.resources = [...full];
  if (
    ["management", "org_member", "org_recruiter", "org_procurement"].includes(
      role,
    )
  )
    permissions.resources = ["view"];
  if (["super_admin", "org_admin"].includes(role))
    permissions.integrations = [...full];
  if (
    [
      "super_admin",
      "org_admin",
      "procurement",
      "finance",
      "org_procurement",
      "org_finance",
    ].includes(role)
  )
    permissions.approvals = [
      "view",
      ...(["super_admin", "org_admin"].includes(role)
        ? ["manage" as Action]
        : []),
    ];
  if (role === "super_admin") permissions["master-data"] = [...full];
}
export const contactRoles = [
  "Founder / CEO / Director",
  "Proprietor / Partner",
  "Procurement / Purchase",
  "HR / Recruiter",
  "Finance",
  "Sales / Business Development",
  "Authorized Representative",
  "Other",
];
export const documentCategories = [
  "PAN",
  "GST",
  "Incorporation",
  "Udyam / MSME",
  "Bank document",
  "Certification",
  "Insurance",
  "Company deck",
  "Capability statement",
  "Rate card",
  "Recruitment agreement",
  "Product specification",
  "Contract",
  "Resume",
  "Invoice attachment",
  "Other",
];
export const categories = [
  "Information Technology",
  "Office & Infrastructure",
  "Professional Services",
  "Human Resources",
  "Marketing & Creative",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Healthcare",
  "Financial Services",
  "Other",
];
export interface LineItem {
  id?: string;
  source_item_id?: string | null;
  catalog_item_id?: string | null;
  name: string;
  specification?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  tax: number;
  discount: number;
}
export interface Organization {
  id: string;
  number: string;
  type: OrganizationType;
  legal_name: string;
  trade_name: string;
  industry: string;
  city: string;
  country: string;
  website: string;
  logo_url?: string | null;
  marketplace_visible?: boolean;
  status: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  details: Record<string, any>;
  created_at: string;
  updated_at: string;
}
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  internal: boolean;
  email_verified: boolean;
  organization_id: string | null;
  organization: Organization | null;
  permissions: Permissions;
}
export interface WorkRecord {
  id: string;
  kind: Module;
  number: string;
  title: string;
  status: string;
  owner_org_id: string | null;
  buyer_org_id: string | null;
  partner_org_id: string | null;
  parent_id: string | null;
  amount_minor: number;
  currency: string;
  payload: Record<string, any>;
  version: number;
  created_at: string;
  updated_at: string;
  owner_name?: string;
  buyer_name?: string;
  partner_name?: string;
  parent_number?: string;
  parent_kind?: Module;
  parent_solicitation_type?: "RFQ" | "RFP";
  items?: LineItem[];
  invitations?: string[];
  allowed_transitions?: string[];
  can_edit?: boolean;
  outstanding_minor?: number;
}
export function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (s) => s.toUpperCase());
}
